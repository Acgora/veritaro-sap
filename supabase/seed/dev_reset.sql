-- DEVELOPMENT-ONLY: removes everything created by dev_seed.sql (and only that).
\if :{?allow_dev_seed}
\else
  \echo 'Refusing to reset: pass -v allow_dev_seed=on (development databases only).'
  \quit
\endif
begin;
delete from public.organisations where id in ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002');
delete from auth.users where email like '%@seed.veritaro.test';
commit;
\echo 'Dev seed removed.'
