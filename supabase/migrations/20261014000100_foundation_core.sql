-- =============================================================================
-- Phase 001 · Migration 1: Core tenancy foundation
--   profiles, roles/permissions, organisations, organisation_members,
--   organisation_settings + shared utilities.
-- Rollback: see supabase/rollbacks/20261014000100_foundation_core.down.sql
-- =============================================================================

-- Private schema for security-definer helpers. NOT exposed through the Data API.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Utility: updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  first_name    text check (char_length(first_name) <= 100),
  last_name     text check (char_length(last_name) <= 100),
  display_name  text check (char_length(display_name) <= 200),
  avatar_url    text check (char_length(avatar_url) <= 2048),
  phone         text check (char_length(phone) <= 40),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.profiles is 'Per-user profile, 1:1 with auth.users. Not tenant-owned.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function app_private.set_updated_at();

-- Auto-create a profile when an auth user is created.
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first text := nullif(trim(new.raw_user_meta_data ->> 'first_name'), '');
  v_last  text := nullif(trim(new.raw_user_meta_data ->> 'last_name'), '');
begin
  insert into public.profiles (id, first_name, last_name, display_name)
  values (
    new.id,
    left(v_first, 100),
    left(v_last, 100),
    left(nullif(trim(concat_ws(' ', v_first, v_last)), ''), 200)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Roles & permissions (lookup tables, not enums → extensible without ALTER TYPE)
-- -----------------------------------------------------------------------------
create table public.roles (
  key          text primary key check (key ~ '^[a-z][a-z_]{1,39}$'),
  label        text not null,
  description  text,
  rank         smallint not null unique,   -- lower = more privileged (display/ordering only)
  is_system    boolean not null default true
);
comment on table public.roles is 'Organisation roles. Reference data; read-only to clients.';

create table public.permissions (
  key          text primary key check (key ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  description  text not null
);
comment on table public.permissions is 'Permission keys (domain.action). Reference data; read-only to clients.';

create table public.role_permissions (
  role        text not null references public.roles (key) on update cascade on delete cascade,
  permission  text not null references public.permissions (key) on update cascade on delete cascade,
  primary key (role, permission)
);
create index role_permissions_permission_idx on public.role_permissions (permission);

-- -----------------------------------------------------------------------------
-- organisations (the tenant)
-- -----------------------------------------------------------------------------
create table public.organisations (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null check (char_length(trim(name)) between 1 and 200),
  legal_name                text check (char_length(legal_name) <= 200),
  registration_number       text check (char_length(registration_number) <= 60),
  tax_number                text check (char_length(tax_number) <= 60),
  vat_number                text check (char_length(vat_number) <= 60),
  email                     text check (char_length(email) <= 320),
  phone                     text check (char_length(phone) <= 40),
  website                   text check (char_length(website) <= 2048),
  logo_url                  text check (char_length(logo_url) <= 2048),
  country                   text not null default 'ZA' check (country ~ '^[A-Z]{2}$'),          -- ISO 3166-1 alpha-2
  currency                  text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),        -- ISO 4217
  timezone                  text not null default 'Africa/Johannesburg' check (char_length(timezone) between 1 and 64),
  financial_year_end_month  smallint not null default 2 check (financial_year_end_month between 1 and 12), -- SA default: Feb
  created_by                uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
comment on table public.organisations is 'Tenant root. Every business-owned record references an organisation.';
comment on column public.organisations.currency is 'Base/functional currency. Changing it once financial records exist must be blocked (future phase).';

create index organisations_created_by_idx on public.organisations (created_by);

create trigger organisations_set_updated_at
  before update on public.organisations
  for each row execute function app_private.set_updated_at();

-- Validate timezone against the server's tz database.
create or replace function app_private.validate_org_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger organisations_validate_timezone
  before insert or update of timezone on public.organisations
  for each row execute function app_private.validate_org_timezone();

-- -----------------------------------------------------------------------------
-- organisation_members (membership + role)
-- -----------------------------------------------------------------------------
create table public.organisation_members (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             text not null references public.roles (key) on update cascade,
  status           text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint organisation_members_org_user_key unique (organisation_id, user_id)
);
comment on table public.organisation_members is 'Source of truth for tenant membership. Only status=active grants access.';

create index organisation_members_user_idx on public.organisation_members (user_id) where status = 'active';
create index organisation_members_org_role_idx on public.organisation_members (organisation_id, role);
create index organisation_members_role_idx on public.organisation_members (role);

create trigger organisation_members_set_updated_at
  before update on public.organisation_members
  for each row execute function app_private.set_updated_at();

-- -----------------------------------------------------------------------------
-- organisation_settings (non-critical preferences only)
-- -----------------------------------------------------------------------------
create table public.organisation_settings (
  organisation_id  uuid primary key references public.organisations (id) on delete cascade,
  settings         jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.organisation_settings is 'Non-critical configurable preferences. Never store relational business data or secrets here.';

create trigger organisation_settings_set_updated_at
  before update on public.organisation_settings
  for each row execute function app_private.set_updated_at();
