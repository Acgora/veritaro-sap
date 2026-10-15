-- =============================================================================
-- Phase 002 · Migration 2: AI gateway — routes, prices, plans, metering, limits,
-- conversations and actions.
--
-- Trust model:
--   * Provider credentials live ONLY in Vercel env vars. Nothing here holds a secret.
--   * ai_model_routes may choose WHICH approved model is active; the server-side
--     allowlist (src/lib/ai/gateway/allowlist.ts) decides what is approved. A DB row
--     naming an unlisted provider/model is ignored by the app.
--   * Metering functions are callable ONLY by service_role (server), so a user cannot
--     forge, delete or under-report usage through the public API.
--   * All cost maths happens here, in numeric, from the effective-dated price table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Platform configuration (no tenant data)
-- -----------------------------------------------------------------------------
create table public.ai_model_routes (
  tier               text primary key check (tier in ('primary', 'fallback', 'premium')),
  provider           text check (provider ~ '^[a-z][a-z0-9_-]{1,39}$'),
  model              text check (model ~ '^[a-zA-Z0-9._:-]{1,100}$'),
  enabled            boolean not null default false,
  max_output_tokens  integer not null default 1024 check (max_output_tokens between 64 and 8192),
  timeout_ms         integer not null default 20000 check (timeout_ms between 1000 and 120000),
  updated_at         timestamptz not null default now(),
  constraint ai_model_routes_enabled_needs_model check (not enabled or (provider is not null and model is not null))
);
comment on table public.ai_model_routes is 'Which APPROVED model serves each tier. Server allowlist is authoritative; an unlisted provider/model here is refused.';

create table public.ai_model_prices (
  id                             uuid primary key default gen_random_uuid(),
  provider                       text not null,
  model                          text not null,
  input_usd_per_mtok             numeric(12, 6) not null check (input_usd_per_mtok >= 0),
  output_usd_per_mtok            numeric(12, 6) not null check (output_usd_per_mtok >= 0),
  long_context_threshold_tokens  integer check (long_context_threshold_tokens > 0),
  long_input_usd_per_mtok        numeric(12, 6) check (long_input_usd_per_mtok >= 0),
  long_output_usd_per_mtok       numeric(12, 6) check (long_output_usd_per_mtok >= 0),
  effective_from                 timestamptz not null default now(),
  effective_to                   timestamptz,
  source_note                    text,
  constraint ai_model_prices_window check (effective_to is null or effective_to > effective_from),
  constraint ai_model_prices_long_tier check (
    (long_context_threshold_tokens is null) = (long_input_usd_per_mtok is null)
    and (long_input_usd_per_mtok is null) = (long_output_usd_per_mtok is null))
);
create index ai_model_prices_lookup_idx on public.ai_model_prices (provider, model, effective_from desc);

create table public.ai_plans (
  key                       text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label                     text not null,
  soft_budget_usd           numeric(12, 4) not null check (soft_budget_usd >= 0),
  hard_budget_usd           numeric(12, 4) not null check (hard_budget_usd >= 0),
  monthly_request_limit     integer not null check (monthly_request_limit >= 0),
  user_rate_limit           integer not null check (user_rate_limit > 0),
  user_rate_window_seconds  integer not null check (user_rate_window_seconds between 10 and 86400),
  premium_allowed           boolean not null default false,
  constraint ai_plans_hard_gte_soft check (hard_budget_usd >= soft_budget_usd)
);

-- Per-organisation overrides (NULL = use the plan value). Only the platform operator changes these.
create table public.ai_org_limits (
  organisation_id           uuid primary key references public.organisations (id) on delete cascade,
  plan_key                  text not null default 'default' references public.ai_plans (key),
  ai_enabled                boolean not null default true,
  soft_budget_usd           numeric(12, 4) check (soft_budget_usd >= 0),
  hard_budget_usd           numeric(12, 4) check (hard_budget_usd >= 0),
  monthly_request_limit     integer check (monthly_request_limit >= 0),
  user_rate_limit           integer check (user_rate_limit > 0),
  user_rate_window_seconds  integer check (user_rate_window_seconds between 10 and 86400),
  premium_allowed           boolean,
  updated_at                timestamptz not null default now()
);
create index ai_org_limits_plan_idx on public.ai_org_limits (plan_key);

-- -----------------------------------------------------------------------------
-- Metering
-- -----------------------------------------------------------------------------
create table public.ai_usage_monthly (
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  month            date not null check (extract(day from month) = 1),
  request_count    integer not null default 0 check (request_count >= 0),
  cost_usd         numeric(14, 8) not null default 0 check (cost_usd >= 0),
  reserved_usd     numeric(14, 8) not null default 0 check (reserved_usd >= 0),
  soft_flagged_at  timestamptz,
  hard_blocked_at  timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (organisation_id, month)
);

create table public.ai_requests (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  user_id          uuid references public.profiles (id) on delete set null,
  category         text not null check (category ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  status           text not null check (status in ('reserved', 'completed', 'failed', 'blocked')),
  block_reason     text check (block_reason in ('disabled', 'not_permitted', 'rate_limited', 'request_limit', 'hard_limit', 'unknown_price')),
  reserved_usd     numeric(14, 8) not null default 0,
  actual_cost_usd  numeric(14, 8) not null default 0,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index ai_requests_rate_idx on public.ai_requests (organisation_id, user_id, created_at desc) where status <> 'blocked';
create index ai_requests_user_idx on public.ai_requests (user_id);

create table public.ai_usage_events (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.ai_requests (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  user_id          uuid references public.profiles (id) on delete set null,
  provider         text not null,
  model            text not null,
  tier             text not null check (tier in ('primary', 'fallback', 'premium')),
  category         text not null,
  tool_name        text,
  input_tokens     integer not null check (input_tokens >= 0),
  output_tokens    integer not null check (output_tokens >= 0),
  cost_usd         numeric(14, 8) not null check (cost_usd >= 0),
  latency_ms       integer check (latency_ms >= 0),
  outcome          text not null check (outcome in ('ok', 'error', 'timeout', 'provider_unavailable')),
  created_at       timestamptz not null default now()
);
comment on table public.ai_usage_events is 'One row per model call. Append-only. Cost computed in DB from ai_model_prices.';
create index ai_usage_events_org_created_idx on public.ai_usage_events (organisation_id, created_at desc);
create index ai_usage_events_request_idx on public.ai_usage_events (request_id);
create index ai_usage_events_user_idx on public.ai_usage_events (user_id);
create index ai_usage_events_model_idx on public.ai_usage_events (provider, model, created_at desc);

-- Append-only, except anonymising user_id when a profile is deleted (FK SET NULL).
create or replace function app_private.ai_usage_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is null and old.user_id is not null
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  raise exception 'ai_usage_events is append-only' using errcode = '42501';
end;
$$;

create trigger ai_usage_events_no_update
  before update on public.ai_usage_events
  for each row execute function app_private.ai_usage_events_immutable();

-- -----------------------------------------------------------------------------
-- Conversations & actions (per user, per organisation)
-- -----------------------------------------------------------------------------
create table public.ai_conversations (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  title            text check (char_length(title) <= 200),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ai_conversations_id_org_user_key unique (id, organisation_id, user_id)
);
create index ai_conversations_user_idx on public.ai_conversations (user_id, organisation_id, updated_at desc);
create index ai_conversations_org_idx on public.ai_conversations (organisation_id);

create table public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  user_id          uuid not null,
  conversation_id  uuid not null,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null check (char_length(content) <= 8000),
  created_at       timestamptz not null default now(),
  constraint ai_messages_conversation_fk foreign key (conversation_id, organisation_id, user_id)
    references public.ai_conversations (id, organisation_id, user_id) on delete cascade
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, organisation_id, user_id, created_at);
create index ai_messages_org_created_idx on public.ai_messages (organisation_id, created_at);

create table public.ai_actions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  user_id          uuid not null,
  conversation_id  uuid not null,
  tool_name        text not null check (tool_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  action_class     text not null check (action_class in ('read', 'draft', 'consequential')),
  input            jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  summary          text check (char_length(summary) <= 500),
  status           text not null check (status in ('executed', 'needs_confirmation', 'confirmed', 'cancelled', 'denied', 'failed')),
  result           jsonb,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  constraint ai_actions_conversation_fk foreign key (conversation_id, organisation_id, user_id)
    references public.ai_conversations (id, organisation_id, user_id) on delete cascade
);
create index ai_actions_conversation_idx on public.ai_actions (conversation_id, organisation_id, user_id);
create index ai_actions_pending_idx on public.ai_actions (user_id, organisation_id) where status = 'needs_confirmation';

create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row execute function app_private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Seed reference data
-- -----------------------------------------------------------------------------
insert into public.ai_model_routes (tier, provider, model, enabled, max_output_tokens, timeout_ms) values
  ('primary',  'anthropic', 'claude-haiku-5-5', true, 1024, 20000),
  ('fallback', null, null, false, 1024, 20000),   -- V1: disabled and unconfigured (approved D9)
  ('premium',  null, null, false, 2048, 45000);   -- off by default

-- Claude Haiku 5.5 list prices (USD per million tokens), Oct 2026.
insert into public.ai_model_prices (provider, model, input_usd_per_mtok, output_usd_per_mtok,
  long_context_threshold_tokens, long_input_usd_per_mtok, long_output_usd_per_mtok, effective_from, source_note) values
  ('anthropic', 'claude-haiku-5-5', 0.10, 0.50, 100000, 0.50, 2.50, '2026-10-01T00:00:00Z',
   'Anthropic list price, <=100K prompt tier / >100K tier. Verify against provider invoice monthly.');

insert into public.ai_plans (key, label, soft_budget_usd, hard_budget_usd, monthly_request_limit,
  user_rate_limit, user_rate_window_seconds, premium_allowed) values
  ('default', 'Default / development', 1.00, 2.00, 1000, 30, 600, false);

-- -----------------------------------------------------------------------------
-- Functions (SECURITY DEFINER; EXECUTE for service_role only)
-- -----------------------------------------------------------------------------
create or replace function app_private.ai_cost_usd(p_provider text, p_model text, p_input integer, p_output integer)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.long_context_threshold_tokens is not null and p_input > p.long_context_threshold_tokens then
      round((p_input::numeric * p.long_input_usd_per_mtok + p_output::numeric * p.long_output_usd_per_mtok) / 1000000, 8)
    else
      round((p_input::numeric * p.input_usd_per_mtok + p_output::numeric * p.output_usd_per_mtok) / 1000000, 8)
  end
  from public.ai_model_prices p
  where p.provider = p_provider and p.model = p_model
    and p.effective_from <= now() and (p.effective_to is null or p.effective_to > now())
  order by p.effective_from desc
  limit 1;
$$;

create or replace function public.ai_effective_limits(p_organisation_id uuid)
returns table (
  ai_enabled boolean, plan_key text, soft_budget_usd numeric, hard_budget_usd numeric,
  monthly_request_limit integer, user_rate_limit integer, user_rate_window_seconds integer, premium_allowed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(l.ai_enabled, true),
         p.key,
         coalesce(l.soft_budget_usd, p.soft_budget_usd),
         coalesce(l.hard_budget_usd, p.hard_budget_usd),
         coalesce(l.monthly_request_limit, p.monthly_request_limit),
         coalesce(l.user_rate_limit, p.user_rate_limit),
         coalesce(l.user_rate_window_seconds, p.user_rate_window_seconds),
         coalesce(l.premium_allowed, p.premium_allowed)
  from public.ai_plans p
  left join public.ai_org_limits l on l.organisation_id = p_organisation_id
  where p.key = coalesce(l.plan_key, 'default');
$$;

-- Notify owners/admins (holders of ai.usage_read) once.
create or replace function app_private.ai_notify_usage(p_organisation_id uuid, p_type text, p_title text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (organisation_id, user_id, type, title, message)
  select m.organisation_id, m.user_id, p_type, p_title, p_message
  from public.organisation_members m
  join public.role_permissions rp on rp.role = m.role and rp.permission = 'ai.usage_read'
  where m.organisation_id = p_organisation_id and m.status = 'active' and m.role in ('owner', 'admin');
end;
$$;

-- Reserve budget BEFORE a model call. Serialised per organisation-month (row lock),
-- so concurrent requests cannot jointly break the hard ceiling.
create or replace function public.ai_begin_request(
  p_organisation_id    uuid,
  p_user_id            uuid,
  p_provider           text,
  p_model              text,
  p_category           text,
  p_est_input_tokens   integer,
  p_max_output_tokens  integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month   date := date_trunc('month', now() at time zone 'UTC')::date;
  v_lim     record;
  v_usage   public.ai_usage_monthly;
  v_est     numeric;
  v_recent  integer;
  v_req_id  uuid;
  v_reason  text;
begin
  select * into v_lim from public.ai_effective_limits(p_organisation_id);

  if not exists (
    select 1 from public.organisation_members m
    join public.role_permissions rp on rp.role = m.role and rp.permission = 'ai.use'
    where m.organisation_id = p_organisation_id and m.user_id = p_user_id and m.status = 'active'
  ) then
    v_reason := 'not_permitted';
  elsif not v_lim.ai_enabled then
    v_reason := 'disabled';
  end if;

  v_est := app_private.ai_cost_usd(p_provider, p_model, greatest(p_est_input_tokens, 0), greatest(p_max_output_tokens, 0));
  if v_reason is null and v_est is null then
    v_reason := 'unknown_price';  -- never call a model we cannot price
  end if;

  insert into public.ai_usage_monthly (organisation_id, month) values (p_organisation_id, v_month)
  on conflict do nothing;
  select * into v_usage from public.ai_usage_monthly
   where organisation_id = p_organisation_id and month = v_month
   for update;

  if v_reason is null then
    select count(*) into v_recent from public.ai_requests r
     where r.organisation_id = p_organisation_id and r.user_id = p_user_id and r.status <> 'blocked'
       and r.created_at > now() - make_interval(secs => v_lim.user_rate_window_seconds);
    if v_recent >= v_lim.user_rate_limit then
      v_reason := 'rate_limited';
    elsif v_usage.request_count >= v_lim.monthly_request_limit then
      v_reason := 'request_limit';
    elsif v_usage.cost_usd + v_usage.reserved_usd + v_est > v_lim.hard_budget_usd then
      v_reason := 'hard_limit';
    end if;
  end if;

  if v_reason is not null then
    insert into public.ai_requests (organisation_id, user_id, category, status, block_reason)
    values (p_organisation_id, p_user_id, p_category, 'blocked', v_reason);
    if v_reason = 'hard_limit' and v_usage.hard_blocked_at is null then
      update public.ai_usage_monthly set hard_blocked_at = now(), updated_at = now()
       where organisation_id = p_organisation_id and month = v_month;
      perform app_private.log_activity(p_organisation_id, 'ai_hard_limit_reached', null, null,
        jsonb_build_object('month', v_month, 'hard_budget_usd', v_lim.hard_budget_usd));
      perform app_private.ai_notify_usage(p_organisation_id, 'ai.hard_limit', 'AI paused for this month',
        'Your organisation reached its AI spending ceiling. The rest of the app works normally.');
    end if;
    return jsonb_build_object('allowed', false, 'reason', v_reason);
  end if;

  insert into public.ai_requests (organisation_id, user_id, category, status, reserved_usd)
  values (p_organisation_id, p_user_id, p_category, 'reserved', v_est)
  returning id into v_req_id;

  update public.ai_usage_monthly
     set reserved_usd = reserved_usd + v_est, request_count = request_count + 1, updated_at = now()
   where organisation_id = p_organisation_id and month = v_month;

  return jsonb_build_object('allowed', true, 'request_id', v_req_id, 'reserved_usd', v_est);
end;
$$;

-- Record one model call. Cost is computed HERE from the price table.
create or replace function public.ai_record_usage(
  p_request_id     uuid,
  p_provider       text,
  p_model          text,
  p_tier           text,
  p_tool_name      text,
  p_input_tokens   integer,
  p_output_tokens  integer,
  p_latency_ms     integer,
  p_outcome        text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req   public.ai_requests;
  v_cost  numeric;
begin
  select * into v_req from public.ai_requests where id = p_request_id for update;
  if v_req.id is null or v_req.status <> 'reserved' then
    raise exception 'AI request is not open' using errcode = '55000';
  end if;
  v_cost := coalesce(app_private.ai_cost_usd(p_provider, p_model, greatest(p_input_tokens, 0), greatest(p_output_tokens, 0)), 0);

  insert into public.ai_usage_events (request_id, organisation_id, user_id, provider, model, tier, category, tool_name,
    input_tokens, output_tokens, cost_usd, latency_ms, outcome)
  values (v_req.id, v_req.organisation_id, v_req.user_id, p_provider, p_model, p_tier, v_req.category, p_tool_name,
    greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), v_cost, p_latency_ms, p_outcome);

  update public.ai_requests set actual_cost_usd = actual_cost_usd + v_cost where id = v_req.id;
  update public.ai_usage_monthly set cost_usd = cost_usd + v_cost, updated_at = now()
   where organisation_id = v_req.organisation_id and month = date_trunc('month', v_req.created_at at time zone 'UTC')::date;
  return v_cost;
end;
$$;

-- Release the reservation and apply soft/hard flags on actual spend.
create or replace function public.ai_finish_request(p_request_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req    public.ai_requests;
  v_month  date;
  v_usage  public.ai_usage_monthly;
  v_lim    record;
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  select * into v_req from public.ai_requests where id = p_request_id for update;
  if v_req.id is null or v_req.status <> 'reserved' then
    raise exception 'AI request is not open' using errcode = '55000';
  end if;
  v_month := date_trunc('month', v_req.created_at at time zone 'UTC')::date;

  update public.ai_requests set status = p_status, completed_at = now() where id = v_req.id;
  update public.ai_usage_monthly
     set reserved_usd = greatest(reserved_usd - v_req.reserved_usd, 0), updated_at = now()
   where organisation_id = v_req.organisation_id and month = v_month
   returning * into v_usage;

  select * into v_lim from public.ai_effective_limits(v_req.organisation_id);

  if v_usage.cost_usd >= v_lim.soft_budget_usd and v_usage.soft_flagged_at is null then
    update public.ai_usage_monthly set soft_flagged_at = now()
     where organisation_id = v_req.organisation_id and month = v_month;
    perform app_private.log_activity(v_req.organisation_id, 'ai_soft_budget_exceeded', null, null,
      jsonb_build_object('month', v_month, 'cost_usd', v_usage.cost_usd, 'soft_budget_usd', v_lim.soft_budget_usd));
    perform app_private.ai_notify_usage(v_req.organisation_id, 'ai.soft_budget', 'AI usage above monthly budget',
      'AI usage passed the monthly soft budget. It keeps working until the hard ceiling.');
  end if;

  return jsonb_build_object('cost_usd', v_usage.cost_usd, 'soft_flagged', v_usage.cost_usd >= v_lim.soft_budget_usd);
end;
$$;

-- Releases reservations orphaned by crashed requests (call from a scheduled job; safe to run anytime).
create or replace function public.ai_release_stale_reservations(p_older_than interval default interval '10 minutes')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_id    uuid;
begin
  for v_id in select id from public.ai_requests where status = 'reserved' and created_at < now() - p_older_than loop
    perform public.ai_finish_request(v_id, 'failed');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- POPIA retention: purge conversations older than N days (default 90). Usage events are kept (no content).
create or replace function public.ai_purge_old_conversations(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.ai_conversations where updated_at < now() - make_interval(days => p_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Usage summary for the current month (owners/admins/accountants via ai.usage_read).
create or replace function public.ai_usage_summary(p_organisation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
  v_u     public.ai_usage_monthly;
  v_lim   record;
begin
  if not app_private.has_permission(p_organisation_id, 'ai.usage_read') then
    raise exception 'You do not have permission to view AI usage' using errcode = '42501';
  end if;
  select * into v_u from public.ai_usage_monthly where organisation_id = p_organisation_id and month = v_month;
  select * into v_lim from public.ai_effective_limits(p_organisation_id);
  return jsonb_build_object(
    'month', v_month,
    'request_count', coalesce(v_u.request_count, 0),
    'cost_usd', coalesce(v_u.cost_usd, 0)::text,
    'soft_budget_usd', v_lim.soft_budget_usd::text,
    'hard_budget_usd', v_lim.hard_budget_usd::text,
    'monthly_request_limit', v_lim.monthly_request_limit,
    'user_rate_limit', v_lim.user_rate_limit,
    'user_rate_window_seconds', v_lim.user_rate_window_seconds,
    'soft_flagged', v_u.soft_flagged_at is not null,
    'hard_blocked', v_u.hard_blocked_at is not null,
    'ai_enabled', v_lim.ai_enabled,
    'plan_key', v_lim.plan_key);
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on public.ai_model_routes, public.ai_model_prices, public.ai_plans, public.ai_org_limits,
              public.ai_usage_monthly, public.ai_requests, public.ai_usage_events,
              public.ai_conversations, public.ai_messages, public.ai_actions
  from anon, authenticated;

grant select, insert, update, delete on public.ai_conversations to authenticated;
grant select, insert on public.ai_messages to authenticated;
grant select, insert on public.ai_actions to authenticated;
grant update (status, result, decided_at) on public.ai_actions to authenticated;

revoke execute on function app_private.ai_cost_usd(text, text, integer, integer) from public, anon, authenticated;
revoke execute on function app_private.ai_notify_usage(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.ai_effective_limits(uuid) from public, anon, authenticated;
revoke execute on function public.ai_begin_request(uuid, uuid, text, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.ai_record_usage(uuid, text, text, text, text, integer, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.ai_finish_request(uuid, text) from public, anon, authenticated;
revoke execute on function public.ai_release_stale_reservations(interval) from public, anon, authenticated;
revoke execute on function public.ai_purge_old_conversations(integer) from public, anon, authenticated;
revoke execute on function public.ai_usage_summary(uuid) from public, anon;

grant execute on function public.ai_effective_limits(uuid) to service_role;
grant execute on function public.ai_begin_request(uuid, uuid, text, text, text, integer, integer) to service_role;
grant execute on function public.ai_record_usage(uuid, text, text, text, text, integer, integer, integer, text) to service_role;
grant execute on function public.ai_finish_request(uuid, text) to service_role;
grant execute on function public.ai_release_stale_reservations(interval) to service_role;
grant execute on function public.ai_purge_old_conversations(integer) to service_role;
grant execute on function public.ai_usage_summary(uuid) to authenticated, service_role;
grant execute on function app_private.ai_cost_usd(text, text, integer, integer) to service_role;
grant usage on schema app_private to service_role;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.ai_model_routes   enable row level security;  -- no client policies: server (service_role) only
alter table public.ai_model_prices   enable row level security;
alter table public.ai_plans          enable row level security;
alter table public.ai_org_limits     enable row level security;
alter table public.ai_usage_monthly  enable row level security;
alter table public.ai_requests       enable row level security;
alter table public.ai_usage_events   enable row level security;
alter table public.ai_conversations  enable row level security;
alter table public.ai_messages       enable row level security;
alter table public.ai_actions        enable row level security;

create policy ai_conversations_own on public.ai_conversations for all to authenticated
  using (user_id = (select auth.uid()) and organisation_id in (select app_private.org_ids_with_permission('ai.use')))
  with check (user_id = (select auth.uid()) and organisation_id in (select app_private.org_ids_with_permission('ai.use')));

create policy ai_messages_own_select on public.ai_messages for select to authenticated
  using (user_id = (select auth.uid()) and organisation_id in (select app_private.my_org_ids()));
create policy ai_messages_own_insert on public.ai_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and organisation_id in (select app_private.org_ids_with_permission('ai.use')));

create policy ai_actions_own_select on public.ai_actions for select to authenticated
  using (user_id = (select auth.uid()) and organisation_id in (select app_private.my_org_ids()));
create policy ai_actions_own_insert on public.ai_actions for insert to authenticated
  with check (user_id = (select auth.uid()) and organisation_id in (select app_private.org_ids_with_permission('ai.use')));
create policy ai_actions_own_update on public.ai_actions for update to authenticated
  using (user_id = (select auth.uid()) and organisation_id in (select app_private.org_ids_with_permission('ai.use')))
  with check (user_id = (select auth.uid()) and organisation_id in (select app_private.org_ids_with_permission('ai.use')));

-- Defence in depth: nothing in app_private is callable by anon, ever.
revoke execute on all functions in schema app_private from anon, public;
revoke execute on function app_private.ai_usage_events_immutable() from authenticated;
