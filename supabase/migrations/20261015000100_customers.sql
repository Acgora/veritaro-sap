-- =============================================================================
-- Phase 002 · Migration 1: Customers, contacts, addresses
-- Pattern: identical to tasks (tenant column, RLS via app_private helpers,
-- invoker guard triggers, definer audit triggers). Archive-only: no DELETE.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
insert into public.permissions (key, description) values
  ('customers.read',        'View all customers'),
  ('customers.read_linked', 'View customers linked to tasks assigned to me'),
  ('customers.create',      'Create customers'),
  ('customers.update',      'Edit customers, contacts and addresses'),
  ('customers.archive',     'Archive and restore customers'),
  ('ai.use',                'Use the AI assistant'),
  ('ai.usage_read',         'View organisation AI usage and limits');

insert into public.role_permissions (role, permission) values
  ('owner', 'customers.read'), ('owner', 'customers.create'), ('owner', 'customers.update'),
  ('owner', 'customers.archive'), ('owner', 'ai.use'), ('owner', 'ai.usage_read'),
  ('admin', 'customers.read'), ('admin', 'customers.create'), ('admin', 'customers.update'),
  ('admin', 'customers.archive'), ('admin', 'ai.use'), ('admin', 'ai.usage_read'),
  ('accountant', 'customers.read'), ('accountant', 'customers.create'), ('accountant', 'customers.update'),
  ('accountant', 'ai.use'), ('accountant', 'ai.usage_read'),
  ('supervisor', 'customers.read'), ('supervisor', 'customers.create'), ('supervisor', 'customers.update'),
  ('supervisor', 'ai.use'),
  ('field_agent', 'customers.read_linked'), ('field_agent', 'ai.use'),
  ('viewer', 'customers.read');

-- -----------------------------------------------------------------------------
-- customers
-- -----------------------------------------------------------------------------
create table public.customers (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  type                 text not null default 'business' check (type in ('business', 'individual')),
  display_name         text not null check (char_length(trim(display_name)) between 1 and 200),
  legal_name           text check (char_length(legal_name) <= 200),
  registration_number  text check (char_length(registration_number) <= 60),
  vat_number           text check (char_length(vat_number) <= 60),
  email                text check (char_length(email) <= 320),
  phone                text check (char_length(phone) <= 40),
  website              text check (char_length(website) <= 2048),
  payment_terms_days   smallint not null default 30 check (payment_terms_days between 0 and 365),
  preferred_channel    text check (preferred_channel in ('email', 'whatsapp', 'phone')),
  notes                text check (char_length(notes) <= 5000),
  status               text not null default 'active' check (status in ('active', 'archived')),
  source               text not null default 'manual' check (source in ('manual', 'ai', 'import')),
  -- Normalised copies for duplicate detection & search (deterministic, DB-computed).
  email_normalized     text generated always as (nullif(lower(trim(email)), '')) stored,
  phone_normalized     text generated always as (nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')) stored,
  vat_normalized       text generated always as (nullif(upper(regexp_replace(coalesce(vat_number, ''), '[^A-Za-z0-9]', '', 'g')), '')) stored,
  archived_at          timestamptz,
  archived_by          uuid references public.profiles (id) on delete set null,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint customers_id_org_key unique (id, organisation_id),
  constraint customers_archived_consistency check ((status = 'archived') = (archived_at is not null))
);
comment on table public.customers is 'Tenant-owned customers. Archive-only (no delete) so future quotes/invoices never lose their customer.';

create index customers_org_status_name_idx on public.customers (organisation_id, status, display_name);
create index customers_org_created_idx on public.customers (organisation_id, created_at desc);
create index customers_name_trgm_idx on public.customers using gin (display_name extensions.gin_trgm_ops);
create index customers_email_idx on public.customers (organisation_id, email_normalized) where email_normalized is not null;
create index customers_phone_idx on public.customers (organisation_id, phone_normalized) where phone_normalized is not null;
create index customers_vat_idx on public.customers (organisation_id, vat_normalized) where vat_normalized is not null;
create index customers_created_by_idx on public.customers (created_by);
create index customers_archived_by_idx on public.customers (archived_by);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function app_private.set_updated_at();

-- -----------------------------------------------------------------------------
-- customer_contacts (composite FK guarantees same organisation as the customer)
-- -----------------------------------------------------------------------------
create table public.customer_contacts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  customer_id      uuid not null,
  first_name       text not null check (char_length(trim(first_name)) between 1 and 100),
  last_name        text check (char_length(last_name) <= 100),
  role             text check (char_length(role) <= 100),
  email            text check (char_length(email) <= 320),
  phone            text check (char_length(phone) <= 40),
  whatsapp_opt_in  boolean not null default false,
  is_primary       boolean not null default false,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint customer_contacts_customer_fk foreign key (customer_id, organisation_id)
    references public.customers (id, organisation_id) on delete cascade
);
create unique index customer_contacts_one_primary_idx on public.customer_contacts (customer_id) where is_primary;
create index customer_contacts_customer_idx on public.customer_contacts (customer_id, organisation_id);
create index customer_contacts_org_idx on public.customer_contacts (organisation_id);
create index customer_contacts_created_by_idx on public.customer_contacts (created_by);

create trigger customer_contacts_set_updated_at
  before update on public.customer_contacts
  for each row execute function app_private.set_updated_at();

-- -----------------------------------------------------------------------------
-- customer_addresses
-- -----------------------------------------------------------------------------
create table public.customer_addresses (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  customer_id         uuid not null,
  kind                text not null default 'site' check (kind in ('billing', 'site')),
  label               text check (char_length(label) <= 100),
  line1               text not null check (char_length(trim(line1)) between 1 and 200),
  line2               text check (char_length(line2) <= 200),
  suburb              text check (char_length(suburb) <= 100),
  city                text check (char_length(city) <= 100),
  province            text check (char_length(province) <= 100),
  postal_code         text check (char_length(postal_code) <= 20),
  country             text not null default 'ZA' check (country ~ '^[A-Z]{2}$'),
  notes               text check (char_length(notes) <= 1000),
  is_default_billing  boolean not null default false,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint customer_addresses_customer_fk foreign key (customer_id, organisation_id)
    references public.customers (id, organisation_id) on delete cascade,
  constraint customer_addresses_default_is_billing check (not is_default_billing or kind = 'billing')
);
create unique index customer_addresses_one_default_billing_idx on public.customer_addresses (customer_id) where is_default_billing;
create index customer_addresses_customer_idx on public.customer_addresses (customer_id, organisation_id);
create index customer_addresses_org_idx on public.customer_addresses (organisation_id);
create index customer_addresses_created_by_idx on public.customer_addresses (created_by);

create trigger customer_addresses_set_updated_at
  before update on public.customer_addresses
  for each row execute function app_private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- Customers linked to open tasks assigned to the caller (field-agent visibility).
create or replace function app_private.linked_customer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct t.related_entity_id
  from public.tasks t
  join public.organisation_members m
    on m.organisation_id = t.organisation_id and m.user_id = auth.uid() and m.status = 'active'
  where t.assigned_to = auth.uid()
    and t.related_entity_type = 'customer'
    and t.status in ('open', 'in_progress');
$$;

-- Actor type for audit rows: trusted server code may tag AI-originated requests
-- with the request header x-veritaro-actor: ai (PostgREST exposes request.headers).
-- A user can only ever label THEIR OWN actions this way; actor_user_id is still them.
create or replace function app_private.request_actor_type()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_actor   text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_actor := lower(coalesce(v_headers ->> 'x-veritaro-actor', ''));
  return case when v_actor = 'ai' then 'ai' else null end;
end;
$$;

-- log_activity now honours the request actor header when no explicit app.actor_type is set.
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
  v_type text := coalesce(nullif(current_setting('app.actor_type', true), ''), app_private.request_actor_type());
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
-- Guards (invoker)
-- -----------------------------------------------------------------------------
create or replace function app_private.guard_customers()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if app_private.is_client_role() then
      new.created_by := v_uid;
      if new.status <> 'active' then
        raise exception 'New customers must be active' using errcode = '23514';
      end if;
      if app_private.request_actor_type() = 'ai' then
        new.source := 'ai';
      elsif new.source = 'ai' then
        new.source := 'manual';
      end if;
    end if;
    new.archived_at := null;
    new.archived_by := null;
    if new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := v_uid;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.organisation_id <> old.organisation_id then
    raise exception 'A customer cannot move between organisations' using errcode = '42501';
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.source := old.source;

  if new.status is distinct from old.status and app_private.is_client_role() then
    -- Archive/restore: customers.archive, or the creator undoing their own record within 15 minutes.
    if not app_private.has_permission(new.organisation_id, 'customers.archive')
       and not (old.created_by = v_uid and old.created_at > now() - interval '15 minutes') then
      raise exception 'You do not have permission to archive or restore customers' using errcode = '42501';
    end if;
  end if;

  if new.status = 'archived' and old.status <> 'archived' then
    new.archived_at := now();
    new.archived_by := v_uid;
  elsif new.status = 'active' then
    new.archived_at := null;
    new.archived_by := null;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  return new;
end;
$$;

create trigger customers_guard
  before insert or update on public.customers
  for each row execute function app_private.guard_customers();

create or replace function app_private.guard_customer_children()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if app_private.is_client_role() then
      new.created_by := auth.uid();
    end if;
  else
    if new.organisation_id <> old.organisation_id or new.customer_id <> old.customer_id then
      raise exception 'A contact or address cannot move to another customer' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger customer_contacts_guard
  before insert or update on public.customer_contacts
  for each row execute function app_private.guard_customer_children();
create trigger customer_addresses_guard
  before insert or update on public.customer_addresses
  for each row execute function app_private.guard_customer_children();

-- Tasks may now link to customers. Validate the polymorphic link (same organisation).
create or replace function app_private.validate_task_relation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.related_entity_type is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.related_entity_type is not distinct from old.related_entity_type
     and new.related_entity_id is not distinct from old.related_entity_id then
    return new;
  end if;
  if new.related_entity_type = 'customer' then
    if not exists (select 1 from public.customers c
                   where c.id = new.related_entity_id and c.organisation_id = new.organisation_id) then
      raise exception 'Linked customer not found in this organisation' using errcode = '23503';
    end if;
    return new;
  end if;
  raise exception 'Unsupported related entity type: %', new.related_entity_type using errcode = '23514';
end;
$$;

create trigger tasks_validate_relation
  before insert or update of related_entity_type, related_entity_id on public.tasks
  for each row execute function app_private.validate_task_relation();

-- -----------------------------------------------------------------------------
-- Audit (definer)
-- -----------------------------------------------------------------------------
create or replace function app_private.audit_customers()
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
    perform app_private.log_activity(new.organisation_id, 'customer_created', 'customer', new.id,
      jsonb_build_object('name', new.display_name, 'type', new.type, 'source', new.source));
    return new;
  end if;

  select coalesce(array_agg(n.key order by n.key), '{}') into v_changed
  from jsonb_each(to_jsonb(new)) n join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at', 'archived_at', 'archived_by', 'email_normalized', 'phone_normalized', 'vat_normalized');

  if cardinality(v_changed) = 0 then
    return new;
  end if;

  v_action := case
    when new.status = 'archived' and old.status <> 'archived' then 'customer_archived'
    when new.status = 'active' and old.status = 'archived' then 'customer_restored'
    else 'customer_updated'
  end;
  perform app_private.log_activity(new.organisation_id, v_action, 'customer', new.id,
    jsonb_build_object('name', new.display_name, 'changed', to_jsonb(v_changed)));
  return new;
end;
$$;

create trigger customers_audit
  after insert or update on public.customers
  for each row execute function app_private.audit_customers();

create or replace function app_private.audit_customer_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     record;
  v_noun    text := case when tg_table_name = 'customer_contacts' then 'contact' else 'address' end;
  v_verb    text := case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'updated' else 'removed' end;
  v_name    text;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.customers c where c.id = old.customer_id) then
    return old;  -- customer/org cascade
  end if;
  select display_name into v_name from public.customers where id = v_row.customer_id;
  perform app_private.log_activity(v_row.organisation_id, v_noun || '_' || v_verb, 'customer', v_row.customer_id,
    jsonb_build_object('name', v_name, v_noun || '_id', v_row.id));
  return coalesce(new, old);
end;
$$;

create trigger customer_contacts_audit
  after insert or update or delete on public.customer_contacts
  for each row execute function app_private.audit_customer_children();
create trigger customer_addresses_audit
  after insert or update or delete on public.customer_addresses
  for each row execute function app_private.audit_customer_children();

-- -----------------------------------------------------------------------------
-- Duplicate detection (invoker: only sees customers the caller may read)
-- -----------------------------------------------------------------------------
create or replace function public.find_customer_duplicates(
  p_organisation_id uuid,
  p_name  text default null,
  p_email text default null,
  p_phone text default null,
  p_vat   text default null,
  p_exclude_id uuid default null
)
returns table (id uuid, display_name text, status text, reason text, score real)
language sql
stable
security invoker
set search_path = ''
as $$
  with input as (
    select nullif(trim(p_name), '') as name,
           nullif(lower(trim(p_email)), '') as email,
           nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '') as phone,
           nullif(upper(regexp_replace(coalesce(p_vat, ''), '[^A-Za-z0-9]', '', 'g')), '') as vat
  ), matches as (
    select c.id, c.display_name, c.status,
      case
        when i.vat is not null and c.vat_normalized = i.vat then 'Same VAT number'
        when i.email is not null and c.email_normalized = i.email then 'Same email'
        when i.phone is not null and length(i.phone) >= 9 and right(c.phone_normalized, 9) = right(i.phone, 9) then 'Same phone number'
        when i.name is not null and extensions.similarity(lower(c.display_name), lower(i.name)) >= 0.45 then 'Similar name'
      end as reason,
      case
        when i.vat is not null and c.vat_normalized = i.vat then 1.0
        when i.email is not null and c.email_normalized = i.email then 0.95
        when i.phone is not null and length(i.phone) >= 9 and right(c.phone_normalized, 9) = right(i.phone, 9) then 0.9
        else coalesce(extensions.similarity(lower(c.display_name), lower(i.name)), 0)
      end::real as score
    from public.customers c, input i
    where c.organisation_id = p_organisation_id
      and (p_exclude_id is null or c.id <> p_exclude_id)
  )
  select id, display_name, status, reason, score from matches
  where reason is not null
  order by score desc, display_name
  limit 5;
$$;

revoke execute on function public.find_customer_duplicates(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.find_customer_duplicates(uuid, text, text, text, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Atomic create: customer + optional primary contact + optional address (invoker → RLS applies)
-- -----------------------------------------------------------------------------
create or replace function public.create_customer(
  p_organisation_id uuid,
  p_customer jsonb,
  p_contact jsonb default null,
  p_address jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.customers (organisation_id, type, display_name, legal_name, registration_number, vat_number,
    email, phone, website, payment_terms_days, preferred_channel, notes)
  values (
    p_organisation_id,
    coalesce(p_customer ->> 'type', 'business'),
    trim(p_customer ->> 'display_name'),
    nullif(trim(p_customer ->> 'legal_name'), ''),
    nullif(trim(p_customer ->> 'registration_number'), ''),
    nullif(trim(p_customer ->> 'vat_number'), ''),
    nullif(trim(p_customer ->> 'email'), ''),
    nullif(trim(p_customer ->> 'phone'), ''),
    nullif(trim(p_customer ->> 'website'), ''),
    coalesce((p_customer ->> 'payment_terms_days')::smallint, 30),
    nullif(p_customer ->> 'preferred_channel', ''),
    nullif(trim(p_customer ->> 'notes'), '')
  )
  returning id into v_id;

  if p_contact is not null and nullif(trim(p_contact ->> 'first_name'), '') is not null then
    insert into public.customer_contacts (organisation_id, customer_id, first_name, last_name, role, email, phone, whatsapp_opt_in, is_primary)
    values (p_organisation_id, v_id, trim(p_contact ->> 'first_name'), nullif(trim(p_contact ->> 'last_name'), ''),
            nullif(trim(p_contact ->> 'role'), ''), nullif(trim(p_contact ->> 'email'), ''), nullif(trim(p_contact ->> 'phone'), ''),
            coalesce((p_contact ->> 'whatsapp_opt_in')::boolean, false), true);
  end if;

  if p_address is not null and nullif(trim(p_address ->> 'line1'), '') is not null then
    insert into public.customer_addresses (organisation_id, customer_id, kind, label, line1, line2, suburb, city, province, postal_code, country, notes, is_default_billing)
    values (p_organisation_id, v_id, coalesce(p_address ->> 'kind', 'site'), nullif(trim(p_address ->> 'label'), ''),
            trim(p_address ->> 'line1'), nullif(trim(p_address ->> 'line2'), ''), nullif(trim(p_address ->> 'suburb'), ''),
            nullif(trim(p_address ->> 'city'), ''), nullif(trim(p_address ->> 'province'), ''), nullif(trim(p_address ->> 'postal_code'), ''),
            coalesce(nullif(upper(trim(p_address ->> 'country')), ''), 'ZA'), nullif(trim(p_address ->> 'notes'), ''),
            coalesce(p_address ->> 'kind', 'site') = 'billing');
  end if;

  return v_id;
end;
$$;

revoke execute on function public.create_customer(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_customer(uuid, jsonb, jsonb, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Grants + RLS
-- -----------------------------------------------------------------------------
revoke all on public.customers, public.customer_contacts, public.customer_addresses from anon, authenticated;
grant select, insert, update on public.customers to authenticated;                         -- no delete: archive only
grant select, insert, update, delete on public.customer_contacts, public.customer_addresses to authenticated;

revoke execute on all functions in schema app_private from anon, authenticated, public;
grant execute on function
  app_private.my_org_ids(),
  app_private.org_ids_with_permission(text),
  app_private.has_permission(uuid, text),
  app_private.is_active_member(uuid, uuid),
  app_private.visible_profile_ids(),
  app_private.active_owner_count(uuid),
  app_private.is_client_role(),
  app_private.linked_customer_ids(),
  app_private.request_actor_type()
to authenticated;

alter table public.customers          enable row level security;
alter table public.customer_contacts  enable row level security;
alter table public.customer_addresses enable row level security;

create policy customers_select on public.customers for select to authenticated
  using (
    organisation_id in (select app_private.org_ids_with_permission('customers.read'))
    or (
      organisation_id in (select app_private.org_ids_with_permission('customers.read_linked'))
      and id in (select app_private.linked_customer_ids())
    )
  );
create policy customers_insert on public.customers for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('customers.create')));
create policy customers_update on public.customers for update to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('customers.update')))
  with check (organisation_id in (select app_private.org_ids_with_permission('customers.update')));

-- Children: readable when the parent customer is readable; writable with customers.update.
create policy customer_contacts_select on public.customer_contacts for select to authenticated
  using (customer_id in (select c.id from public.customers c));
create policy customer_contacts_write on public.customer_contacts for all to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('customers.update')))
  with check (organisation_id in (select app_private.org_ids_with_permission('customers.update')));

create policy customer_addresses_select on public.customer_addresses for select to authenticated
  using (customer_id in (select c.id from public.customers c));
create policy customer_addresses_write on public.customer_addresses for all to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('customers.update')))
  with check (organisation_id in (select app_private.org_ids_with_permission('customers.update')));
