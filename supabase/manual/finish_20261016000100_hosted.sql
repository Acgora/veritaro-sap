-- =============================================================================
-- MANUAL FINISH for migration 20261016000100_ai_openai_primary on the HOSTED project.
-- The column changes (part 1) are already applied. Paste this whole file into
-- Supabase → SQL Editor → Run. Safe to run more than once. Runs as one transaction.
-- =============================================================================
begin;

-- GPT-6 Luna price row (skipped if already present)
insert into public.ai_model_prices (provider, model, input_usd_per_mtok, cached_input_usd_per_mtok, output_usd_per_mtok,
  long_context_threshold_tokens, long_input_usd_per_mtok, long_cached_input_usd_per_mtok, long_output_usd_per_mtok,
  effective_from, source_note)
select 'openai', 'gpt-6-luna', 0.10, 0.01, 0.50, 272000, 0.20, 0.02, 0.75, '2026-09-22T00:00:00Z',
  'OpenAI list price (Standard processing), developers.openai.com/api/docs/models/gpt-6-luna, checked 2026-10-15. Verify against invoice monthly.'
where not exists (select 1 from public.ai_model_prices where provider = 'openai' and model = 'gpt-6-luna');

-- -----------------------------------------------------------------------------
-- Cost function: now prices cached tokens. Replaces the 4-argument version.
-- -----------------------------------------------------------------------------
drop function if exists app_private.ai_cost_usd(text, text, integer, integer);

create or replace function app_private.ai_cost_usd(p_provider text, p_model text, p_input integer, p_output integer, p_cached integer default 0)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select greatest(p_input, 0)::numeric as inp,
           least(greatest(coalesce(p_cached, 0), 0), greatest(p_input, 0))::numeric as cached,
           greatest(p_output, 0)::numeric as outp
  )
  select case
    when p.long_context_threshold_tokens is not null and t.inp > p.long_context_threshold_tokens then
      round(((t.inp - t.cached) * p.long_input_usd_per_mtok
             + t.cached * coalesce(p.long_cached_input_usd_per_mtok, p.long_input_usd_per_mtok)
             + t.outp * p.long_output_usd_per_mtok) / 1000000, 8)
    else
      round(((t.inp - t.cached) * p.input_usd_per_mtok
             + t.cached * coalesce(p.cached_input_usd_per_mtok, p.input_usd_per_mtok)
             + t.outp * p.output_usd_per_mtok) / 1000000, 8)
  end
  from public.ai_model_prices p, t
  where p.provider = p_provider and p.model = p_model
    and p.effective_from <= now() and (p.effective_to is null or p.effective_to > now())
  order by p.effective_from desc
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- ai_record_usage: + cached and reasoning tokens. Replaces the 9-argument version.
-- -----------------------------------------------------------------------------
drop function if exists public.ai_record_usage(uuid, text, text, text, text, integer, integer, integer, text);

create or replace function public.ai_record_usage(
  p_request_id           uuid,
  p_provider             text,
  p_model                text,
  p_tier                 text,
  p_tool_name            text,
  p_input_tokens         integer,
  p_output_tokens        integer,
  p_latency_ms           integer,
  p_outcome              text,
  p_cached_input_tokens  integer default 0,
  p_reasoning_tokens     integer default 0
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req     public.ai_requests;
  v_cost    numeric;
  v_in      integer := greatest(coalesce(p_input_tokens, 0), 0);
  v_out     integer := greatest(coalesce(p_output_tokens, 0), 0);
  v_cached  integer;
  v_reason  integer;
begin
  select * into v_req from public.ai_requests where id = p_request_id for update;
  if v_req.id is null or v_req.status <> 'reserved' then
    raise exception 'AI request is not open' using errcode = '55000';
  end if;
  v_cached := least(greatest(coalesce(p_cached_input_tokens, 0), 0), v_in);
  v_reason := least(greatest(coalesce(p_reasoning_tokens, 0), 0), v_out);
  v_cost := coalesce(app_private.ai_cost_usd(p_provider, p_model, v_in, v_out, v_cached), 0);

  insert into public.ai_usage_events (request_id, organisation_id, user_id, provider, model, tier, category, tool_name,
    input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, cost_usd, latency_ms, outcome)
  values (v_req.id, v_req.organisation_id, v_req.user_id, p_provider, p_model, p_tier, v_req.category, p_tool_name,
    v_in, v_out, v_cached, v_reason, v_cost, p_latency_ms, p_outcome);

  update public.ai_requests set actual_cost_usd = actual_cost_usd + v_cost where id = v_req.id;
  update public.ai_usage_monthly set cost_usd = cost_usd + v_cost, updated_at = now()
   where organisation_id = v_req.organisation_id and month = date_trunc('month', v_req.created_at at time zone 'UTC')::date;
  return v_cost;
end;
$$;

-- -----------------------------------------------------------------------------
-- Switch the active primary route. Fallback + premium stay disabled and unconfigured.
-- 2048 output tokens: reasoning tokens count as output; still a fraction of a cent.
-- -----------------------------------------------------------------------------
update public.ai_model_routes
   set provider = 'openai', model = 'gpt-6-luna', enabled = true, reasoning_effort = 'low',
       max_output_tokens = 2048, timeout_ms = 30000, updated_at = now()
 where tier = 'primary';

update public.ai_model_routes
   set provider = null, model = null, enabled = false, reasoning_effort = null, updated_at = now()
 where tier in ('fallback', 'premium');

-- -----------------------------------------------------------------------------
-- Privileges (re-applied for the replaced functions)
-- -----------------------------------------------------------------------------
revoke execute on function app_private.ai_cost_usd(text, text, integer, integer, integer) from public, anon, authenticated;
grant  execute on function app_private.ai_cost_usd(text, text, integer, integer, integer) to service_role;
revoke execute on function public.ai_record_usage(uuid, text, text, text, text, integer, integer, integer, text, integer, integer)
  from public, anon, authenticated;
grant  execute on function public.ai_record_usage(uuid, text, text, text, text, integer, integer, integer, text, integer, integer)
  to service_role;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261016000100', 'ai_openai_primary') on conflict do nothing;
commit;
notify pgrst, 'reload schema';

-- Check (should show openai | gpt-6-luna | low):
select provider, model, reasoning_effort from public.ai_model_routes where tier = 'primary';
