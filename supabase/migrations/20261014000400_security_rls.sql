-- =============================================================================
-- Phase 001 · Migration 4: Security — helpers, guards, audit triggers, RPCs, RLS, grants
--
-- RLS strategy (see docs/RLS_STRATEGY.md):
--   * Every tenant-owned table has RLS enabled and policies that resolve the caller's
--     organisations through app_private helpers (SECURITY DEFINER, search_path='').
--   * Policies use the non-correlated form  organisation_id IN (SELECT app_private.…())
--     so Postgres evaluates membership once per statement (initPlan), not per row.
--   * Clients never write activity_log / notifications / organisations directly;
--     trusted DB functions do.
--   * Guard triggers enforce rules RLS cannot express (role escalation, immutable FKs).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lock down function execution defaults in the private schema
-- -----------------------------------------------------------------------------
alter default privileges in schema app_private revoke execute on functions from public;
revoke execute on all functions in schema app_private from public;

-- -----------------------------------------------------------------------------
-- Membership / permission helpers
-- -----------------------------------------------------------------------------
create or replace function app_private.my_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organisation_id
  from public.organisation_members m
  where m.user_id = auth.uid()
    and m.status = 'active';
$$;

create or replace function app_private.org_ids_with_permission(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organisation_id
  from public.organisation_members m
  join public.role_permissions rp on rp.role = m.role
  where m.user_id = auth.uid()
    and m.status = 'active'
    and rp.permission = p_permission;
$$;

create or replace function app_private.has_permission(p_organisation_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_members m
    join public.role_permissions rp on rp.role = m.role
    where m.organisation_id = p_organisation_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and rp.permission = p_permission
  );
$$;

create or replace function app_private.member_role(p_organisation_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.organisation_members m
  where m.organisation_id = p_organisation_id
    and m.user_id = auth.uid()
    and m.status = 'active';
$$;

create or replace function app_private.is_active_member(p_organisation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organisation_members m
    where m.organisation_id = p_organisation_id
      and m.user_id = p_user_id
      and m.status = 'active'
  );
$$;

-- Profiles visible to the caller: self + anyone sharing an active organisation.
create or replace function app_private.visible_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid()
  union
  select other.user_id
  from public.organisation_members mine
  join public.organisation_members other on other.organisation_id = mine.organisation_id
  where mine.user_id = auth.uid()
    and mine.status = 'active';
$$;

create or replace function app_private.active_owner_count(p_organisation_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.organisation_members m
  where m.organisation_id = p_organisation_id and m.role = 'owner' and m.status = 'active';
$$;

-- True when the current statement is executed by an end-user API role.
-- Trusted paths (SECURITY DEFINER RPCs, service_role, FK cascades, migrations) return false.
create or replace function app_private.is_client_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon');
$$;

grant execute on function
  app_private.my_org_ids(),
  app_private.org_ids_with_permission(text),
  app_private.has_permission(uuid, text),
  app_private.member_role(uuid),
  app_private.is_active_member(uuid, uuid),
  app_private.visible_profile_ids(),
  app_private.active_owner_count(uuid),
  app_private.is_client_role()
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Guard: organisation_members (no self-elevation, owner protection)
-- Runs as the invoking role (NOT security definer) so is_client_role() is meaningful.
-- -----------------------------------------------------------------------------
create or replace function app_private.guard_organisation_members()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := coalesce(new.organisation_id, old.organisation_id);
  v_actor_is_owner boolean;
begin
  if not app_private.is_client_role() then
    return coalesce(new, old);
  end if;

  v_actor_is_owner := app_private.has_permission(v_org, 'organisation.transfer_ownership');

  if tg_op = 'INSERT' then
    if new.user_id = v_uid then
      raise exception 'You cannot add yourself to an organisation' using errcode = '42501';
    end if;
    if new.role = 'owner' and not v_actor_is_owner then
      raise exception 'Only an owner can grant the owner role' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.organisation_id <> old.organisation_id or new.user_id <> old.user_id then
      raise exception 'Membership organisation and user cannot be changed' using errcode = '42501';
    end if;
    if old.user_id = v_uid and (new.role <> old.role or new.status <> old.status) then
      raise exception 'You cannot change your own role or status' using errcode = '42501';
    end if;
    if (old.role = 'owner' or new.role = 'owner') and new.role is distinct from old.role and not v_actor_is_owner then
      raise exception 'Only an owner can grant or remove the owner role' using errcode = '42501';
    end if;
    if old.role = 'owner' and new.status <> old.status and not v_actor_is_owner then
      raise exception 'Only an owner can change another owner''s status' using errcode = '42501';
    end if;
    if old.role = 'owner' and old.status = 'active'
       and (new.role <> 'owner' or new.status <> 'active')
       and app_private.active_owner_count(v_org) <= 1 then
      raise exception 'An organisation must keep at least one active owner' using errcode = '42501';
    end if;
    return new;
  end if;

  -- DELETE
  if old.role = 'owner' then
    if old.user_id <> v_uid and not v_actor_is_owner then
      raise exception 'Only an owner can remove an owner' using errcode = '42501';
    end if;
    if old.status = 'active' and app_private.active_owner_count(v_org) <= 1 then
      raise exception 'An organisation must keep at least one active owner' using errcode = '42501';
    end if;
  end if;
  return old;
end;
$$;
grant execute on function app_private.guard_organisation_members() to authenticated, service_role;

create trigger organisation_members_guard
  before insert or update or delete on public.organisation_members
  for each row execute function app_private.guard_organisation_members();

-- -----------------------------------------------------------------------------
-- Guard: tasks (immutable tenancy, assignment rules, completion bookkeeping)
-- -----------------------------------------------------------------------------
create or replace function app_private.guard_tasks()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if app_private.is_client_role() then
      new.created_by := v_uid;                 -- never trust client-supplied creator
    end if;
  else
    if new.organisation_id <> old.organisation_id then
      raise exception 'A task cannot move between organisations' using errcode = '42501';
    end if;
    new.created_by := old.created_by;          -- immutable
    new.created_at := old.created_at;          -- immutable
  end if;

  -- Assignee must be an active member of the same organisation.
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not app_private.is_active_member(new.organisation_id, new.assigned_to) then
    raise exception 'Assignee is not an active member of this organisation' using errcode = '23514';
  end if;

  -- Without tasks.assign a user may only assign to themselves (or leave unassigned).
  if app_private.is_client_role()
     and new.assigned_to is not null
     and new.assigned_to <> v_uid
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not app_private.has_permission(new.organisation_id, 'tasks.assign') then
    raise exception 'You do not have permission to assign tasks to others' using errcode = '42501';
  end if;

  -- Completion bookkeeping (server-owned).
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := now();
    new.completed_by := v_uid;
  elsif new.status <> 'completed' then
    new.completed_at := null;
    new.completed_by := null;
  else
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;

  return new;
end;
$$;
grant execute on function app_private.guard_tasks() to authenticated, service_role;

create trigger tasks_guard
  before insert or update on public.tasks
  for each row execute function app_private.guard_tasks();

-- -----------------------------------------------------------------------------
-- Audit triggers (SECURITY DEFINER: they write activity_log/notifications)
-- -----------------------------------------------------------------------------
create or replace function app_private.audit_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
  v_action  text;
begin
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.organisation_id, 'task_created', 'task', new.id,
      jsonb_build_object('title', new.title, 'priority', new.priority, 'assigned_to', new.assigned_to,
                         'due_at', new.due_at));
    if new.assigned_to is not null and new.assigned_to is distinct from auth.uid() then
      perform app_private.create_notification(new.organisation_id, new.assigned_to, 'task.assigned',
        'New task assigned to you', new.title, 'task', new.id);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Skip when the whole organisation is being deleted (cascade).
    if exists (select 1 from public.organisations o where o.id = old.organisation_id) then
      perform app_private.log_activity(old.organisation_id, 'task_deleted', 'task', old.id,
        jsonb_build_object('title', old.title));
    end if;
    return old;
  end if;

  -- UPDATE: record which fields changed (names only for free text; never full descriptions).
  select coalesce(array_agg(n.key order by n.key), '{}')
    into v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at', 'completed_at', 'completed_by');

  if cardinality(v_changed) = 0 then
    return new;
  end if;

  v_action := case
    when new.status = 'completed' and old.status <> 'completed' then 'task_completed'
    when new.status = 'archived'  and old.status <> 'archived'  then 'task_archived'
    when old.status in ('completed', 'archived') and new.status in ('open', 'in_progress') then 'task_reopened'
    else 'task_updated'
  end;

  perform app_private.log_activity(new.organisation_id, v_action, 'task', new.id,
    jsonb_build_object('title', new.title, 'changed', to_jsonb(v_changed),
                       'from_status', old.status, 'to_status', new.status));

  if new.assigned_to is not null
     and new.assigned_to is distinct from old.assigned_to
     and new.assigned_to is distinct from auth.uid() then
    perform app_private.create_notification(new.organisation_id, new.assigned_to, 'task.assigned',
      'Task assigned to you', new.title, 'task', new.id);
  end if;

  return new;
end;
$$;

create trigger tasks_audit
  after insert or update or delete on public.tasks
  for each row execute function app_private.audit_tasks();

create or replace function app_private.audit_organisation_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.organisation_id, 'member_added', 'organisation_member', new.id,
      jsonb_build_object('user_id', new.user_id, 'role', new.role, 'status', new.status));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      perform app_private.log_activity(new.organisation_id, 'member_role_changed', 'organisation_member', new.id,
        jsonb_build_object('user_id', new.user_id, 'from_role', old.role, 'to_role', new.role));
    end if;
    if new.status is distinct from old.status then
      perform app_private.log_activity(new.organisation_id, 'member_status_changed', 'organisation_member', new.id,
        jsonb_build_object('user_id', new.user_id, 'from_status', old.status, 'to_status', new.status));
    end if;
    return new;
  else
    if exists (select 1 from public.organisations o where o.id = old.organisation_id) then
      perform app_private.log_activity(old.organisation_id, 'member_removed', 'organisation_member', old.id,
        jsonb_build_object('user_id', old.user_id, 'role', old.role));
    end if;
    return old;
  end if;
end;
$$;

create trigger organisation_members_audit
  after insert or update or delete on public.organisation_members
  for each row execute function app_private.audit_organisation_members();

create or replace function app_private.audit_organisations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  select coalesce(array_agg(n.key order by n.key), '{}')
    into v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value and n.key <> 'updated_at';

  if cardinality(v_changed) > 0 then
    perform app_private.log_activity(new.id, 'organisation_updated', 'organisation', new.id,
      jsonb_build_object('changed', to_jsonb(v_changed)));
  end if;
  return new;
end;
$$;

create trigger organisations_audit
  after update on public.organisations
  for each row execute function app_private.audit_organisations();

create or replace function app_private.audit_organisation_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[];
begin
  select coalesce(array_agg(k order by k), '{}') into v_keys
  from (
    select key as k from jsonb_each(new.settings) n
      where n.value is distinct from (old.settings -> n.key)
    union
    select key from jsonb_each(old.settings) o where not (new.settings ? o.key)
  ) s;

  if cardinality(v_keys) > 0 then
    perform app_private.log_activity(new.organisation_id, 'settings_updated', 'organisation', new.organisation_id,
      jsonb_build_object('keys', to_jsonb(v_keys)));   -- keys only, never values
  end if;
  return new;
end;
$$;

create trigger organisation_settings_audit
  after update on public.organisation_settings
  for each row execute function app_private.audit_organisation_settings();

-- Organisations cannot be repointed to another creator by clients.
create or replace function app_private.guard_organisations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;
grant execute on function app_private.guard_organisations() to authenticated, service_role;

create trigger organisations_guard
  before update on public.organisations
  for each row execute function app_private.guard_organisations();

-- -----------------------------------------------------------------------------
-- Public RPCs
-- -----------------------------------------------------------------------------

-- Onboarding: atomically create organisation + owner membership + settings + audit.
create or replace function public.create_organisation(
  p_name                text,
  p_country             text default 'ZA',
  p_currency            text default 'ZAR',
  p_timezone            text default 'Africa/Johannesburg',
  p_legal_name          text default null,
  p_registration_number text default null,
  p_tax_number          text default null,
  p_vat_number          text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  -- Abuse guard: cap organisations a single user can create.
  if (select count(*) from public.organisations where created_by = v_uid) >= 10 then
    raise exception 'Organisation limit reached' using errcode = '54000';
  end if;

  insert into public.organisations (
    name, legal_name, registration_number, tax_number, vat_number,
    country, currency, timezone, created_by
  ) values (
    trim(p_name),
    nullif(trim(p_legal_name), ''),
    nullif(trim(p_registration_number), ''),
    nullif(trim(p_tax_number), ''),
    nullif(trim(p_vat_number), ''),
    upper(coalesce(nullif(trim(p_country), ''), 'ZA')),
    upper(coalesce(nullif(trim(p_currency), ''), 'ZAR')),
    coalesce(nullif(trim(p_timezone), ''), 'Africa/Johannesburg'),
    v_uid
  )
  returning id into v_org_id;

  insert into public.organisation_settings (organisation_id) values (v_org_id);

  perform app_private.log_activity(v_org_id, 'organisation_created', 'organisation', v_org_id,
    jsonb_build_object('name', trim(p_name)));

  -- Fires member_added via audit trigger.
  insert into public.organisation_members (organisation_id, user_id, role, status)
  values (v_org_id, v_uid, 'owner', 'active');

  return v_org_id;
end;
$$;

-- Effective permission keys for the caller in one organisation (UI gating; RLS still enforces).
create or replace function public.get_my_permissions(p_organisation_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(rp.permission order by rp.permission), '{}')
  from public.organisation_members m
  join public.role_permissions rp on rp.role = m.role
  where m.organisation_id = p_organisation_id
    and m.user_id = auth.uid()
    and m.status = 'active';
$$;

-- Mark notifications read (own only).
create or replace function public.mark_notifications_read(p_organisation_id uuid, p_ids uuid[] default null)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with upd as (
    update public.notifications
       set read_at = now()
     where organisation_id = p_organisation_id
       and user_id = auth.uid()
       and read_at is null
       and (p_ids is null or id = any (p_ids))
    returning 1
  )
  select count(*)::int from upd;
$$;

revoke execute on function public.create_organisation(text, text, text, text, text, text, text, text) from public, anon;
revoke execute on function public.get_my_permissions(uuid) from public, anon;
revoke execute on function public.mark_notifications_read(uuid, uuid[]) from public, anon;
grant execute on function public.create_organisation(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.get_my_permissions(uuid) to authenticated;
grant execute on function public.mark_notifications_read(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Table privileges (defence in depth; RLS is still the final boundary)
-- -----------------------------------------------------------------------------
revoke all on public.profiles, public.roles, public.permissions, public.role_permissions,
              public.organisations, public.organisation_members, public.organisation_settings,
              public.activity_log, public.notifications, public.tasks
  from anon, authenticated;

grant select on public.roles, public.permissions, public.role_permissions to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, update on public.organisations to authenticated;
grant select, insert, update, delete on public.organisation_members to authenticated;
grant select, update on public.organisation_settings to authenticated;
grant select on public.activity_log to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.roles                 enable row level security;
alter table public.permissions           enable row level security;
alter table public.role_permissions      enable row level security;
alter table public.organisations         enable row level security;
alter table public.organisation_members  enable row level security;
alter table public.organisation_settings enable row level security;
alter table public.activity_log          enable row level security;
alter table public.notifications         enable row level security;
alter table public.tasks                 enable row level security;

-- Reference data
create policy roles_read on public.roles for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id in (select app_private.visible_profile_ids()));
create policy profiles_insert_self on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- organisations (insert only via create_organisation; delete not exposed in Phase 001)
create policy organisations_select on public.organisations for select to authenticated
  using (id in (select app_private.my_org_ids()));
create policy organisations_update on public.organisations for update to authenticated
  using (id in (select app_private.org_ids_with_permission('organisation.update')))
  with check (id in (select app_private.org_ids_with_permission('organisation.update')));

-- organisation_members
create policy organisation_members_select on public.organisation_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or organisation_id in (select app_private.org_ids_with_permission('members.read'))
  );
create policy organisation_members_insert on public.organisation_members for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('members.manage')));
create policy organisation_members_update on public.organisation_members for update to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('members.manage')))
  with check (organisation_id in (select app_private.org_ids_with_permission('members.manage')));
create policy organisation_members_delete on public.organisation_members for delete to authenticated
  using (
    organisation_id in (select app_private.org_ids_with_permission('members.manage'))
    or user_id = (select auth.uid())          -- leave an organisation
  );

-- organisation_settings
create policy organisation_settings_select on public.organisation_settings for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('settings.read')));
create policy organisation_settings_update on public.organisation_settings for update to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('settings.update')))
  with check (organisation_id in (select app_private.org_ids_with_permission('settings.update')));

-- activity_log (read-only to clients)
create policy activity_log_select on public.activity_log for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('activity.read')));

-- notifications (own, within active memberships)
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and organisation_id in (select app_private.my_org_ids()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and organisation_id in (select app_private.my_org_ids()))
  with check (user_id = (select auth.uid()) and organisation_id in (select app_private.my_org_ids()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()) and organisation_id in (select app_private.my_org_ids()));

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using (
    organisation_id in (select app_private.org_ids_with_permission('tasks.read_all'))
    or (
      organisation_id in (select app_private.org_ids_with_permission('tasks.read_assigned'))
      and (assigned_to = (select auth.uid()) or created_by = (select auth.uid()))
    )
  );
create policy tasks_insert on public.tasks for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('tasks.create')));
create policy tasks_update on public.tasks for update to authenticated
  using (
    organisation_id in (select app_private.org_ids_with_permission('tasks.update_all'))
    or (
      organisation_id in (select app_private.org_ids_with_permission('tasks.update_assigned'))
      and (assigned_to = (select auth.uid()) or created_by = (select auth.uid()))
    )
  )
  with check (
    organisation_id in (select app_private.org_ids_with_permission('tasks.update_all'))
    or (
      organisation_id in (select app_private.org_ids_with_permission('tasks.update_assigned'))
      and (assigned_to = (select auth.uid()) or created_by = (select auth.uid()))
    )
  );
create policy tasks_delete on public.tasks for delete to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('tasks.delete')));
