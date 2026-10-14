-- =============================================================================
-- Phase 001 · Migration 2: activity_log, notifications, tasks
-- =============================================================================

-- -----------------------------------------------------------------------------
-- activity_log (append-only audit/timeline foundation)
-- -----------------------------------------------------------------------------
create table public.activity_log (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  actor_user_id    uuid references public.profiles (id) on delete set null,
  actor_type       text not null default 'user' check (actor_type in ('user', 'ai', 'system', 'integration')),
  action           text not null check (action ~ '^[a-z][a-z_]{1,63}$'),
  entity_type      text check (entity_type ~ '^[a-z][a-z_]{1,63}$'),
  entity_id        uuid,
  metadata         jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at       timestamptz not null default now(),
  constraint activity_log_entity_pair check ((entity_type is null) = (entity_id is null))
);
comment on table public.activity_log is
  'Append-only activity/audit stream. Written only by trusted DB code (triggers/RPCs). Never store secrets in metadata.';

create index activity_log_org_created_idx on public.activity_log (organisation_id, created_at desc);
create index activity_log_entity_idx on public.activity_log (entity_type, entity_id) where entity_id is not null;
create index activity_log_actor_idx on public.activity_log (actor_user_id);

-- Append-only: block UPDATE except the FK-driven anonymisation (actor -> NULL on profile deletion).
create or replace function app_private.activity_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.actor_user_id is null
     and old.actor_user_id is not null
     and (to_jsonb(new) - 'actor_user_id') = (to_jsonb(old) - 'actor_user_id') then
    return new;
  end if;
  raise exception 'activity_log is append-only' using errcode = '42501';
end;
$$;

create trigger activity_log_no_update
  before update on public.activity_log
  for each row execute function app_private.activity_log_immutable();

-- Central writer. Actor type can be overridden per-transaction by trusted server code:
--   select set_config('app.actor_type', 'ai', true);
create or replace function app_private.log_activity(
  p_organisation_id uuid,
  p_action          text,
  p_entity_type     text default null,
  p_entity_id       uuid default null,
  p_metadata        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_type text := nullif(current_setting('app.actor_type', true), '');
  v_id   uuid;
begin
  if v_type is null or v_type not in ('user', 'ai', 'system', 'integration') then
    v_type := case when v_uid is null then 'system' else 'user' end;
  end if;

  insert into public.activity_log (organisation_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_organisation_id, v_uid, v_type, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- notifications (per-user, per-organisation)
-- -----------------------------------------------------------------------------
create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  type             text not null check (type ~ '^[a-z][a-z_.]{1,63}$'),
  title            text not null check (char_length(title) between 1 and 200),
  message          text check (char_length(message) <= 2000),
  entity_type      text check (entity_type ~ '^[a-z][a-z_]{1,63}$'),
  entity_id        uuid,
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  constraint notifications_entity_pair check ((entity_type is null) = (entity_id is null))
);

create index notifications_user_unread_idx on public.notifications (user_id, organisation_id, created_at desc) where read_at is null;
create index notifications_user_created_idx on public.notifications (user_id, organisation_id, created_at desc);
create index notifications_org_idx on public.notifications (organisation_id);

create or replace function app_private.create_notification(
  p_organisation_id uuid,
  p_user_id         uuid,
  p_type            text,
  p_title           text,
  p_message         text default null,
  p_entity_type     text default null,
  p_entity_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.notifications (organisation_id, user_id, type, title, message, entity_type, entity_id)
  values (p_organisation_id, p_user_id, p_type, left(p_title, 200), left(p_message, 2000), p_entity_type, p_entity_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- tasks (first organisation-owned business feature; the pattern for modules)
-- -----------------------------------------------------------------------------
create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  title                text not null check (char_length(trim(title)) between 1 and 200),
  description          text check (char_length(description) <= 5000),
  status               text not null default 'open'
                         check (status in ('open', 'in_progress', 'completed', 'archived')),
  priority             text not null default 'normal'
                         check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at               timestamptz,
  assigned_to          uuid references public.profiles (id) on delete set null,
  -- Polymorphic link (lead/customer/invoice/job/compliance_item…). Cannot be an FK;
  -- integrity is enforced by app_private.validate_task_relation as modules are added.
  related_entity_type  text check (related_entity_type ~ '^[a-z][a-z_]{1,63}$'),
  related_entity_id    uuid,
  completed_at         timestamptz,
  completed_by         uuid references public.profiles (id) on delete set null,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint tasks_related_pair check ((related_entity_type is null) = (related_entity_id is null)),
  constraint tasks_completed_consistency check ((status = 'completed') = (completed_at is not null))
);

create index tasks_org_status_due_idx on public.tasks (organisation_id, status, due_at);
create index tasks_org_created_idx on public.tasks (organisation_id, created_at desc);
create index tasks_assigned_idx on public.tasks (assigned_to, status) where assigned_to is not null;
create index tasks_created_by_idx on public.tasks (created_by);
create index tasks_completed_by_idx on public.tasks (completed_by);
create index tasks_related_idx on public.tasks (related_entity_type, related_entity_id) where related_entity_id is not null;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function app_private.set_updated_at();
