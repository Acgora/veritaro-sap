-- =============================================================================
-- DEVELOPMENT-ONLY SEED DATA. NEVER RUN AGAINST PRODUCTION.
-- Creates demo users (password: DevPassw0rd!), one organisation with every role,
-- a second isolated organisation, tasks and activity.
-- All demo emails use the reserved .test TLD so they can't collide with real users.
--
-- Run (local stack / branch only):
--   psql "$DEV_DATABASE_URL" -v allow_dev_seed=on -f supabase/seed/dev_seed.sql
-- Reset:
--   psql "$DEV_DATABASE_URL" -v allow_dev_seed=on -f supabase/seed/dev_reset.sql
-- =============================================================================
\if :{?allow_dev_seed}
\else
  \echo 'Refusing to seed: pass -v allow_dev_seed=on (development databases only).'
  \quit
\endif

begin;

do $$ begin
  if exists (select 1 from auth.users where email not like '%@seed.veritaro.test') and current_setting('app.force_seed', true) is distinct from 'on' then
    raise exception 'Database contains non-seed users — refusing to seed. This looks like a real environment.';
  end if;
end $$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
       crypt('DevPassw0rd!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('first_name', u.first_name, 'last_name', 'Demo'), now(), now(), '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000001', 'owner@seed.veritaro.test',      'Olivia'),
  ('d0000000-0000-4000-8000-000000000002', 'admin@seed.veritaro.test',      'Adam'),
  ('d0000000-0000-4000-8000-000000000003', 'accountant@seed.veritaro.test', 'Ann'),
  ('d0000000-0000-4000-8000-000000000004', 'supervisor@seed.veritaro.test', 'Sam'),
  ('d0000000-0000-4000-8000-000000000005', 'field@seed.veritaro.test',      'Fred'),
  ('d0000000-0000-4000-8000-000000000006', 'viewer@seed.veritaro.test',     'Vera'),
  ('d0000000-0000-4000-8000-000000000007', 'other@seed.veritaro.test',      'Otto')
) as u(id, email, first_name)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
from auth.users u where u.email like '%@seed.veritaro.test'
  and not exists (select 1 from auth.identities i where i.user_id = u.id);

insert into public.organisations (id, name, legal_name, country, currency, timezone, created_by) values
  ('d1000000-0000-4000-8000-000000000001', 'Demo Cleaning Co', 'Demo Cleaning Co (Pty) Ltd', 'ZA', 'ZAR', 'Africa/Johannesburg', 'd0000000-0000-4000-8000-000000000001'),
  ('d1000000-0000-4000-8000-000000000002', 'Other Pest Control', null, 'ZA', 'ZAR', 'Africa/Johannesburg', 'd0000000-0000-4000-8000-000000000007')
on conflict (id) do nothing;

insert into public.organisation_settings (organisation_id) values
  ('d1000000-0000-4000-8000-000000000001'), ('d1000000-0000-4000-8000-000000000002')
on conflict do nothing;

insert into public.organisation_members (organisation_id, user_id, role) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'owner'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'admin'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'accountant'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'supervisor'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'field_agent'),
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000006', 'viewer'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000007', 'owner')
on conflict (organisation_id, user_id) do nothing;

-- Tasks are inserted "as" users so triggers write realistic activity.
do $$
declare
  org uuid := 'd1000000-0000-4000-8000-000000000001';
begin
  perform set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000001', true);
  insert into public.tasks (organisation_id, title, priority, due_at, assigned_to, created_by) values
    (org, '[Demo] Follow up office-cleaning quote', 'high', now() + interval '3 hours', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
    (org, '[Demo] Restock chemicals van 2', 'normal', now() + interval '1 day', 'd0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000001'),
    (org, '[Demo] Renew public liability insurance', 'urgent', now() - interval '2 days', 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001');
  perform set_config('request.jwt.claim.sub', 'd0000000-0000-4000-8000-000000000007', true);
  insert into public.tasks (organisation_id, title, created_by) values
    ('d1000000-0000-4000-8000-000000000002', '[Demo] Other org — must never be visible to Demo Cleaning Co', 'd0000000-0000-4000-8000-000000000007');
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

commit;
\echo 'Dev seed loaded. Sign in as owner@seed.veritaro.test / DevPassw0rd! (or admin@, accountant@, supervisor@, field@, viewer@, other@).'
