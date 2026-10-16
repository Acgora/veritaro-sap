-- =============================================================================
-- Security invariants (SECURITY.md §4). Runs after all migrations + other suites.
-- These fail the build when a migration weakens the platform-wide guarantees.
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
select tests.logout();

-- Every table in the API schema has RLS on.
select tests.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
                'every public table has row level security enabled');

-- Signed-out callers can execute nothing in public or app_private, and hold no table privileges.
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname in ('public', 'app_private') and p.prokind = 'f'
                              and has_function_privilege('anon', p.oid, 'execute')),
                'anon cannot execute any public or app_private function');
select tests.ok(not exists (select 1 from information_schema.role_table_grants
                            where grantee = 'anon' and table_schema in ('public', 'app_private')),
                'anon holds no table privileges');

-- Every SECURITY DEFINER function pins search_path (no search_path hijacking).
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname in ('public', 'app_private') and p.prosecdef
                              and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)),
                'every SECURITY DEFINER function sets search_path');

-- Privileged functions reachable by signed-in users = exactly the justified list in SECURITY.md §5.
create temp table expected_privileged (fn text primary key);
insert into expected_privileged values
  ('ai_usage_summary(uuid)'), ('archive_invoice(uuid)'),
  ('create_organisation(text,text,text,text,text,text,text,text)'), ('duplicate_quote(uuid)'),
  ('get_field_job(uuid)'), ('get_job_internal_notes(uuid)'), ('issue_invoice(uuid)'), ('issue_quote(uuid,text)'),
  ('list_my_jobs(uuid,timestamp with time zone,timestamp with time zone)'),
  ('record_payment(uuid,numeric,date,text,text,text,text)'), ('set_job_status(uuid,text,text)'),
  ('set_quote_outcome(uuid,text,text,text)'), ('void_invoice(uuid,text)'), ('void_payment(uuid,text)'),
  ('app_private.active_owner_count(uuid)'), ('app_private.can_access_job(uuid,boolean)'),
  ('app_private.has_permission(uuid,text)'), ('app_private.is_active_member(uuid,uuid)'),
  ('app_private.linked_customer_ids()'), ('app_private.my_assigned_job_ids()'), ('app_private.my_org_ids()'),
  ('app_private.next_document_number(uuid,text)'), ('app_private.org_ids_with_permission(text)'),
  ('app_private.visible_profile_ids()');
select tests.ok(not exists (
  select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private') and p.prosecdef and p.prokind = 'f'
     and has_function_privilege('authenticated', p.oid, 'execute')
  except select fn from expected_privileged),
  'no unreviewed SECURITY DEFINER function is callable by signed-in users (update SECURITY.md §5 to add one)');

-- Storage stays private.
select tests.ok(not exists (select 1 from storage.buckets where public), 'no storage bucket is public');

-- Financial history cannot be rewritten through the API.
select tests.ok(not has_table_privilege('authenticated', 'public.payments', 'update')
            and not has_table_privilege('authenticated', 'public.payments', 'delete')
            and not has_table_privilege('authenticated', 'public.payments', 'insert'),
                'payments are written only through record_payment / void_payment');
select tests.ok(not has_table_privilege('authenticated', 'public.invoices', 'delete')
            and not has_table_privilege('authenticated', 'public.quotes', 'delete')
            and not has_table_privilege('authenticated', 'public.activity_log', 'delete'),
                'invoices, quotes and the activity log cannot be deleted');

select format('%s assertions passed (cumulative)', count(*)) as summary from tests.results;
