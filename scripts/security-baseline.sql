-- Canonical, order-stable snapshot of the security-relevant database configuration.
-- Same output locally and on hosted Supabase = no security drift. Read-only.
with
rls as (
  select 'rls' k, c.relname || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity v
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
pol as (
  select 'policy' k, tablename || '.' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ',') || ' permissive=' || permissive v
  from pg_policies where schemaname in ('public', 'storage') and (schemaname = 'public' or policyname like '%documents%' or policyname like '%photo%')
),
tgrant as (
  select 'table_grant' k, table_name || ' ' || grantee || ' ' || string_agg(privilege_type, ',' order by privilege_type) v
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
  group by table_name, grantee
),
cgrant as (
  select 'column_grant' k, table_name || '.' || column_name || ' ' || grantee || ' ' || privilege_type v
  from information_schema.column_privileges cp
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and not exists (select 1 from information_schema.role_table_grants t
                    where t.table_schema = 'public' and t.table_name = cp.table_name and t.grantee = cp.grantee and t.privilege_type = cp.privilege_type)
),
fexec as (
  select 'function_exec' k, p.oid::regprocedure::text || ' definer=' || p.prosecdef
           || ' anon=' || has_function_privilege('anon', p.oid, 'execute')
           || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
           || ' search_path_set=' || coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false) v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private') and p.prokind = 'f'
),
buckets as (
  select 'bucket' k, id || ' public=' || public || ' limit=' || coalesce(file_size_limit::text, '-') || ' types=' || coalesce(array_to_string(allowed_mime_types, ','), '-') v
  from storage.buckets
)
select k || ' | ' || v as line from (
  select * from rls union all select * from pol union all select * from tgrant union all select * from cgrant
  union all select * from fexec union all select * from buckets
) s order by 1;
