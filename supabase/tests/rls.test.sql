-- =============================================================================
-- Tenancy / RLS / permission test suite (runs on the local shim, never on prod)
-- Every assertion raises on failure, so a clean run == all tests pass.
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create schema tests;
grant usage on schema tests to authenticated, anon;

create table tests.results (n serial, name text, passed boolean);
grant insert, select on tests.results to authenticated, anon;
grant usage on sequence tests.results_n_seq to authenticated, anon;

create function tests.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', false);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
  perform set_config('role', 'authenticated', false);
end $$;

create function tests.logout() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('role', 'postgres', false);
end $$;

create function tests.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'TEST FAILED: %', p_name;
  end if;
  insert into tests.results (name, passed) values (p_name, true);
end $$;

-- Assert a statement raises (any error) — used for privilege/guard checks.
create function tests.throws(p_sql text, p_name text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    insert into tests.results (name, passed) values (p_name, true);
    return;
  end;
  raise exception 'TEST FAILED (expected error): %', p_name;
end $$;

-- Count rows affected by a DML statement (RLS silently filters UPDATE/DELETE).
create function tests.affected(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema tests to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures (as superuser): 7 users. Profiles are created by the auth trigger.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-00000000000a', 'owner.a@test.local',  '{"first_name":"Olivia","last_name":"Owner"}'),
  ('a0000000-0000-0000-0000-0000000000ad', 'admin.a@test.local',  '{"first_name":"Adam"}'),
  ('a0000000-0000-0000-0000-0000000000ac', 'acct.a@test.local',   '{"first_name":"Ann"}'),
  ('a0000000-0000-0000-0000-0000000000a5', 'super.a@test.local',  '{"first_name":"Sam"}'),
  ('a0000000-0000-0000-0000-0000000000af', 'field.a@test.local',  '{"first_name":"Fred"}'),
  ('a0000000-0000-0000-0000-0000000000a7', 'viewer.a@test.local', '{"first_name":"Vera"}'),
  ('b0000000-0000-0000-0000-00000000000b', 'owner.b@test.local',  '{"first_name":"Ben","last_name":"Other"}'),
  ('c0000000-0000-0000-0000-00000000000c', 'loner@test.local',    '{}');

select tests.ok((select count(*) from public.profiles) = 8, 'auth trigger creates a profile per user');
select tests.ok((select display_name from public.profiles where id = 'a0000000-0000-0000-0000-00000000000a') = 'Olivia Owner',
                'profile display_name built from metadata');

-- Keys in TS must match DB (src/lib/permissions/keys.ts). Count guard:
select tests.ok((select count(*) from public.permissions) = 23, 'permission catalogue has expected size (sync with keys.ts)');
select tests.ok((select count(*) from public.roles) = 6, 'six system roles');

-- ---------------------------------------------------------------------------
-- Onboarding
-- ---------------------------------------------------------------------------
select tests.logout();
select tests.throws($$select public.create_organisation('Anon Co')$$, 'anon/unauthenticated cannot create organisation');

select tests.login('a0000000-0000-0000-0000-00000000000a');
select set_config('test.org_a', public.create_organisation('Org A Cleaning', 'za', 'zar', 'Africa/Johannesburg', 'Org A (Pty) Ltd')::text, false);
select tests.ok((select role from public.organisation_members
                 where organisation_id = current_setting('test.org_a')::uuid and user_id = auth.uid()) = 'owner',
                'creator becomes owner');
select tests.ok((select country || currency from public.organisations where id = current_setting('test.org_a')::uuid) = 'ZAZAR',
                'country/currency normalised to upper case');
select tests.ok(exists (select 1 from public.organisation_settings where organisation_id = current_setting('test.org_a')::uuid),
                'settings row created');
select tests.ok((select count(*) from public.activity_log where organisation_id = current_setting('test.org_a')::uuid
                 and action in ('organisation_created', 'member_added')) = 2, 'onboarding writes organisation_created + member_added');
select tests.throws($$select public.create_organisation('')$$, 'empty organisation name rejected');
select tests.throws($$select public.create_organisation('Bad TZ', 'ZA', 'ZAR', 'Mars/Olympus')$$, 'invalid timezone rejected');
select tests.throws($$insert into public.organisations (name) values ('Direct insert')$$, 'direct organisation insert blocked');
select tests.throws($$insert into public.activity_log (organisation_id, action) values (current_setting('test.org_a')::uuid, 'forged')$$,
                    'clients cannot write activity_log');

select tests.login('b0000000-0000-0000-0000-00000000000b');
select set_config('test.org_b', public.create_organisation('Org B Pest Control')::text, false);

-- Owner A adds members (members.manage).
select tests.login('a0000000-0000-0000-0000-00000000000a');
insert into public.organisation_members (organisation_id, user_id, role) values
  (current_setting('test.org_a')::uuid, 'a0000000-0000-0000-0000-0000000000ad', 'admin'),
  (current_setting('test.org_a')::uuid, 'a0000000-0000-0000-0000-0000000000ac', 'accountant'),
  (current_setting('test.org_a')::uuid, 'a0000000-0000-0000-0000-0000000000a5', 'supervisor'),
  (current_setting('test.org_a')::uuid, 'a0000000-0000-0000-0000-0000000000af', 'field_agent'),
  (current_setting('test.org_a')::uuid, 'a0000000-0000-0000-0000-0000000000a7', 'viewer');
select tests.ok((select count(*) from public.organisation_members where organisation_id = current_setting('test.org_a')::uuid) = 6,
                'owner can add members');

-- Owner A tasks
insert into public.tasks (organisation_id, title, priority, assigned_to, created_by)
values (current_setting('test.org_a')::uuid, 'Follow up ABC quote', 'high', 'a0000000-0000-0000-0000-0000000000af',
        'b0000000-0000-0000-0000-00000000000b');   -- forged created_by must be overwritten
select tests.ok((select created_by from public.tasks where title = 'Follow up ABC quote') = 'a0000000-0000-0000-0000-00000000000a',
                'created_by is forced to the caller');
insert into public.tasks (organisation_id, title) values (current_setting('test.org_a')::uuid, 'Owner private task');
select tests.ok((select count(*) from public.activity_log where action = 'task_created'
                 and organisation_id = current_setting('test.org_a')::uuid) = 2, 'task_created logged');

-- Owner B task
select tests.login('b0000000-0000-0000-0000-00000000000b');
insert into public.tasks (organisation_id, title) values (current_setting('test.org_b')::uuid, 'Org B secret task');

-- ---------------------------------------------------------------------------
-- TENANT ISOLATION: User A (any role) must never see/modify Org B and vice versa
-- ---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-00000000000a');
select tests.ok((select count(*) from public.organisations) = 1, 'owner A sees only Org A');
select tests.ok(not exists (select 1 from public.tasks where organisation_id = current_setting('test.org_b')::uuid), 'A cannot read B tasks');
select tests.ok(not exists (select 1 from public.activity_log where organisation_id = current_setting('test.org_b')::uuid), 'A cannot read B activity');
select tests.ok(not exists (select 1 from public.organisation_members where organisation_id = current_setting('test.org_b')::uuid), 'A cannot read B members');
select tests.ok(not exists (select 1 from public.organisation_settings where organisation_id = current_setting('test.org_b')::uuid), 'A cannot read B settings');
select tests.ok(not exists (select 1 from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b'), 'A cannot read B owner profile');
select tests.ok(tests.affected($$update public.tasks set title = 'pwned' where organisation_id = current_setting('test.org_b')::uuid$$) = 0,
                'A cannot update B tasks');
select tests.ok(tests.affected($$delete from public.tasks where organisation_id = current_setting('test.org_b')::uuid$$) = 0,
                'A cannot delete B tasks');
select tests.ok(tests.affected($$update public.organisations set name = 'pwned' where id = current_setting('test.org_b')::uuid$$) = 0,
                'A cannot update Org B');
select tests.throws($$insert into public.tasks (organisation_id, title) values (current_setting('test.org_b')::uuid, 'inject')$$,
                    'A cannot insert task into Org B');
select tests.throws($$insert into public.organisation_members (organisation_id, user_id, role)
                      values (current_setting('test.org_b')::uuid, 'a0000000-0000-0000-0000-0000000000ad', 'owner')$$,
                    'A cannot add members to Org B');
select tests.throws($$update public.tasks set organisation_id = current_setting('test.org_b')::uuid where title = 'Owner private task'$$,
                    'task cannot be moved to another organisation');
select tests.throws($$insert into public.tasks (organisation_id, title, assigned_to)
                      values (current_setting('test.org_a')::uuid, 'x', 'b0000000-0000-0000-0000-00000000000b')$$,
                    'cannot assign a task to a non-member');

select tests.login('b0000000-0000-0000-0000-00000000000b');
select tests.ok((select count(*) from public.tasks) = 1, 'owner B sees only own task');
select tests.ok(not exists (select 1 from public.organisations where id = current_setting('test.org_a')::uuid), 'B cannot read Org A');

-- User with no organisation sees nothing
select tests.login('c0000000-0000-0000-0000-00000000000c');
select tests.ok((select count(*) from public.organisations) = 0, 'loner sees no organisations');
select tests.ok((select count(*) from public.tasks) = 0, 'loner sees no tasks');
select tests.ok((select count(*) from public.profiles) = 1, 'loner sees only own profile');
select tests.throws($$insert into public.organisation_members (organisation_id, user_id, role)
                      values (current_setting('test.org_a')::uuid, 'c0000000-0000-0000-0000-00000000000c', 'owner')$$,
                    'non-member cannot self-join an organisation');

-- Anonymous role sees nothing at all
select tests.logout();
select set_config('role', 'anon', false);
select tests.throws($$select * from public.tasks$$, 'anon has no table access');
select set_config('role', 'postgres', false);

-- ---------------------------------------------------------------------------
-- ROLE / PERMISSION RESTRICTIONS
-- ---------------------------------------------------------------------------
-- Admin
select tests.login('a0000000-0000-0000-0000-0000000000ad');
select tests.throws($$update public.organisation_members set role = 'owner'
                      where user_id = 'a0000000-0000-0000-0000-0000000000ad'$$, 'admin cannot elevate self');
select tests.throws($$update public.organisation_members set role = 'owner'
                      where user_id = 'a0000000-0000-0000-0000-0000000000a7'$$, 'admin cannot grant owner');
select tests.throws($$update public.organisation_members set role = 'viewer'
                      where user_id = 'a0000000-0000-0000-0000-00000000000a'$$, 'admin cannot demote owner');
select tests.throws($$delete from public.organisation_members where user_id = 'a0000000-0000-0000-0000-00000000000a'$$,
                    'admin cannot remove owner');
select tests.ok(tests.affected($$update public.organisation_members set role = 'supervisor'
                 where user_id = 'a0000000-0000-0000-0000-0000000000a7'$$) = 1, 'admin can change non-owner role');
select tests.ok(tests.affected($$update public.organisation_members set role = 'viewer'
                 where user_id = 'a0000000-0000-0000-0000-0000000000a7'$$) = 1, 'admin can change role back');
select tests.ok((select count(*) from public.activity_log where action = 'member_role_changed') = 2, 'member_role_changed logged');
select tests.ok(tests.affected($$update public.organisations set phone = '021 000 0000'
                 where id = current_setting('test.org_a')::uuid$$) = 1, 'admin can update organisation');
select tests.ok('organisation.transfer_ownership' <> all (public.get_my_permissions(current_setting('test.org_a')::uuid)),
                'admin lacks transfer_ownership');

-- Viewer
select tests.login('a0000000-0000-0000-0000-0000000000a7');
select tests.ok((select count(*) from public.tasks) = 2, 'viewer reads all org tasks');
select tests.throws($$insert into public.tasks (organisation_id, title) values (current_setting('test.org_a')::uuid, 'v')$$,
                    'viewer cannot create tasks');
select tests.ok(tests.affected($$update public.tasks set title = 'v'$$) = 0, 'viewer cannot update tasks');
select tests.ok(tests.affected($$update public.organisations set name = 'v'$$) = 0, 'viewer cannot update organisation');
select tests.ok(tests.affected($$update public.organisation_settings set settings = '{"x":1}'$$) = 0, 'viewer cannot update settings');
select tests.ok(tests.affected($$update public.organisation_members set role = 'admin' where user_id = auth.uid()$$) = 0, 'viewer cannot elevate self');
select tests.ok((select role from public.organisation_members where user_id = auth.uid()) = 'viewer', 'viewer role unchanged');

-- Field agent: only assigned/created tasks; cannot assign to others; no activity access
select tests.login('a0000000-0000-0000-0000-0000000000af');
select tests.ok((select count(*) from public.tasks) = 1, 'field agent sees only assigned task');
select tests.ok((select count(*) from public.activity_log) = 0, 'field agent cannot read activity log');
select tests.ok((select count(*) from public.organisation_members) = 1, 'field agent sees only own membership');
select tests.ok(tests.affected($$update public.tasks set status = 'completed' where title = 'Follow up ABC quote'$$) = 1,
                'field agent can complete assigned task');
select tests.ok((select completed_by from public.tasks where title = 'Follow up ABC quote') = auth.uid(), 'completed_by set by server');
select tests.ok(tests.affected($$update public.tasks set title = 'x' where title = 'Owner private task'$$) = 0,
                'field agent cannot edit unassigned task');
select tests.throws($$insert into public.tasks (organisation_id, title, assigned_to)
                      values (current_setting('test.org_a')::uuid, 'fa', 'a0000000-0000-0000-0000-0000000000a5')$$,
                    'field agent cannot assign to others');
insert into public.tasks (organisation_id, title, assigned_to)
  values (current_setting('test.org_a')::uuid, 'Field own task', 'a0000000-0000-0000-0000-0000000000af');
select tests.ok(tests.affected($$delete from public.tasks where title = 'Field own task'$$) = 0, 'field agent cannot hard-delete');
select tests.ok(tests.affected($$update public.tasks set status = 'archived' where title = 'Field own task'$$) = 1,
                'field agent can archive own task');

-- Supervisor: all tasks, can assign
select tests.login('a0000000-0000-0000-0000-0000000000a5');
select tests.ok((select count(*) from public.tasks) = 3, 'supervisor reads all tasks');
insert into public.tasks (organisation_id, title, assigned_to)
  values (current_setting('test.org_a')::uuid, 'Supervisor assigns', 'a0000000-0000-0000-0000-0000000000af');
select tests.ok(tests.affected($$delete from public.tasks where title = 'Supervisor assigns'$$) = 0, 'supervisor cannot hard-delete');

-- Accountant: assigned/created only
select tests.login('a0000000-0000-0000-0000-0000000000ac');
select tests.ok((select count(*) from public.tasks) = 0, 'accountant sees only own/assigned tasks');
select tests.ok((select count(*) from public.activity_log) > 0, 'accountant can read activity');

-- Notifications: field agent got assignment notifications, others cannot see them
select tests.login('a0000000-0000-0000-0000-0000000000af');
select tests.ok((select count(*) from public.notifications where type = 'task.assigned') = 2, 'assignee notified');
select tests.ok(public.mark_notifications_read(current_setting('test.org_a')::uuid) = 2, 'mark_notifications_read marks own');
select tests.throws($$update public.notifications set title = 'x'$$, 'only read_at is updatable on notifications');
select tests.login('a0000000-0000-0000-0000-00000000000a');
select tests.ok((select count(*) from public.notifications) = 0, 'owner cannot see field agent notifications');

-- Owner protections & ownership
select tests.throws($$update public.organisation_members set role = 'admin' where user_id = auth.uid()$$, 'owner cannot change own role');
select tests.throws($$delete from public.organisation_members where user_id = auth.uid()$$, 'last owner cannot leave');
select tests.ok(tests.affected($$update public.organisation_members set role = 'owner'
                 where user_id = 'a0000000-0000-0000-0000-0000000000ad'$$) = 1, 'owner can grant owner role');
select tests.ok(tests.affected($$update public.organisation_members set role = 'admin'
                 where user_id = 'a0000000-0000-0000-0000-0000000000ad'$$) = 1, 'owner can demote co-owner');
select tests.ok(tests.affected($$delete from public.tasks where title = 'Owner private task'$$) = 1, 'owner can delete task');
select tests.ok(exists (select 1 from public.activity_log where action = 'task_deleted'), 'task_deleted logged');
select tests.ok(exists (select 1 from public.activity_log where action = 'task_completed'), 'task_completed logged');
select tests.ok(exists (select 1 from public.activity_log where action = 'task_archived'), 'task_archived logged');

update public.organisation_settings set settings = '{"week_starts_on":"monday"}' where organisation_id = current_setting('test.org_a')::uuid;
select tests.ok(exists (select 1 from public.activity_log where action = 'settings_updated'), 'settings_updated logged');
select tests.ok(not exists (select 1 from public.activity_log where action = 'settings_updated' and metadata::text like '%monday%'),
                'settings audit stores keys, not values');

-- Append-only audit log (even for the superuser path)
select tests.logout();
select tests.throws($$update public.activity_log set action = 'tampered'$$, 'activity_log is append-only (superuser)');

-- Profile deletion anonymises the actor instead of breaking the log
delete from auth.users where id = 'a0000000-0000-0000-0000-0000000000a5';
select tests.ok(exists (select 1 from public.activity_log where actor_user_id is null and actor_type = 'user'),
                'deleted user anonymised in activity log');

-- Organisation deletion cascades cleanly
delete from public.organisations where id = current_setting('test.org_b')::uuid;
select tests.ok(not exists (select 1 from public.tasks where organisation_id = current_setting('test.org_b')::uuid),
                'org delete cascades tasks');

-- Security definer hygiene: every SECURITY DEFINER function pins search_path
select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
), 'all SECURITY DEFINER functions pin search_path');

-- RLS enabled on every public table
select tests.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
), 'RLS enabled on every public table');

select tests.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_private' and has_function_privilege('anon', p.oid, 'execute')
), 'anon cannot execute any app_private function');
select tests.ok(not has_function_privilege('anon', 'public.create_organisation(text,text,text,text,text,text,text,text)', 'execute'),
                'anon cannot execute create_organisation');
select tests.ok(not exists (
  select 1 from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
), 'anon has no table privileges in public');

select format('%s assertions passed', count(*)) as summary from tests.results;
