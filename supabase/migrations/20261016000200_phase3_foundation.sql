-- =============================================================================
-- Phase 003 · Migration 1: foundation
--   * Phase 002 cleanup: 5,000 AI requests / month on the default plan
--   * Permissions for leads, inbox, quotes, jobs, invoices, payments
--   * Organisation business address + financial settings (tax, numbering, banking,
--     follow-up thresholds) — one row per organisation, created automatically
--   * Concurrency-safe document numbering (row-locked counters, never count(*)+1)
--   * Document register (generated PDFs) + private Storage buckets with tenant policies
--   * Field-agent scope: customer tables are no longer readable through linked tasks
--     (approved Phase 003 decision; field agents see job-scoped info via RPC only)
-- Additive only: no DROP statements.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Phase 002 cleanup
-- -----------------------------------------------------------------------------
update public.ai_plans set monthly_request_limit = 5000 where key = 'default';

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
insert into public.permissions (key, description) values
  ('leads.read',          'View leads'),
  ('leads.write',         'Create, edit, convert and close leads'),
  ('inbox.read',          'View conversations and messages'),
  ('inbox.write',         'Log communications and draft replies'),
  ('quotes.read',         'View quotes'),
  ('quotes.write',        'Create and edit draft quotes'),
  ('quotes.issue',        'Issue, accept, decline and archive quotes'),
  ('jobs.read_all',       'View all jobs'),
  ('jobs.read_assigned',  'View jobs assigned to me'),
  ('jobs.write',          'Create, schedule, assign and cancel jobs'),
  ('jobs.work',           'Start and complete jobs, add notes and photos'),
  ('invoices.read',       'View invoices'),
  ('invoices.write',      'Create and edit draft invoices'),
  ('invoices.issue',      'Issue and void invoices'),
  ('payments.read',       'View payments'),
  ('payments.record',     'Record payments against invoices');

insert into public.role_permissions (role, permission)
select r.role, p.permission
from (values
  ('owner'), ('admin')
) r(role)
cross join (values
  ('leads.read'), ('leads.write'), ('inbox.read'), ('inbox.write'), ('quotes.read'), ('quotes.write'), ('quotes.issue'),
  ('jobs.read_all'), ('jobs.write'), ('jobs.work'), ('invoices.read'), ('invoices.write'), ('invoices.issue'),
  ('payments.read'), ('payments.record')
) p(permission);

insert into public.role_permissions (role, permission) values
  ('accountant', 'leads.read'), ('accountant', 'inbox.read'),
  ('accountant', 'quotes.read'), ('accountant', 'quotes.write'), ('accountant', 'quotes.issue'),
  ('accountant', 'jobs.read_all'),
  ('accountant', 'invoices.read'), ('accountant', 'invoices.write'), ('accountant', 'invoices.issue'),
  ('accountant', 'payments.read'), ('accountant', 'payments.record'),
  ('supervisor', 'leads.read'), ('supervisor', 'leads.write'), ('supervisor', 'inbox.read'), ('supervisor', 'inbox.write'),
  ('supervisor', 'quotes.read'), ('supervisor', 'quotes.write'), ('supervisor', 'quotes.issue'),
  ('supervisor', 'jobs.read_all'), ('supervisor', 'jobs.write'), ('supervisor', 'jobs.work'),
  ('field_agent', 'jobs.read_assigned'), ('field_agent', 'jobs.work'),
  ('viewer', 'leads.read'), ('viewer', 'inbox.read'), ('viewer', 'quotes.read'), ('viewer', 'jobs.read_all'),
  ('viewer', 'invoices.read'), ('viewer', 'payments.read');

-- -----------------------------------------------------------------------------
-- Field-agent scope (Phase 002 limitation fixed). Customer rows are readable only
-- with customers.read. Field agents get job-scoped customer/site/contact fields via
-- public.get_field_job() (Phase 003 jobs migration). customers.read_linked is retired.
-- -----------------------------------------------------------------------------
alter policy customers_select on public.customers
  using (organisation_id in (select app_private.org_ids_with_permission('customers.read')));
update public.permissions set description = 'RETIRED (Phase 003): field access is job-scoped' where key = 'customers.read_linked';

-- -----------------------------------------------------------------------------
-- Organisation business address (seller details on documents)
-- -----------------------------------------------------------------------------
alter table public.organisations
  add column address_line1  text check (char_length(address_line1) <= 200),
  add column address_line2  text check (char_length(address_line2) <= 200),
  add column suburb         text check (char_length(suburb) <= 100),
  add column city           text check (char_length(city) <= 100),
  add column province       text check (char_length(province) <= 100),
  add column postal_code    text check (char_length(postal_code) <= 20);

-- -----------------------------------------------------------------------------
-- Financial settings (one row per organisation)
-- -----------------------------------------------------------------------------
create table public.organisation_financial_settings (
  organisation_id            uuid primary key references public.organisations (id) on delete cascade,
  vat_registered             boolean not null default false,
  tax_label                  text not null default 'VAT' check (char_length(trim(tax_label)) between 1 and 20),
  tax_rate                   numeric(7, 4) not null default 15.0000 check (tax_rate >= 0 and tax_rate < 100),
  prices_include_tax_default boolean not null default false,
  quote_validity_days        integer not null default 30 check (quote_validity_days between 1 and 365),
  invoice_due_days           integer not null default 30 check (invoice_due_days between 0 and 365),
  default_quote_terms        text check (char_length(default_quote_terms) <= 4000),
  default_invoice_terms      text check (char_length(default_invoice_terms) <= 4000),
  bank_name                  text check (char_length(bank_name) <= 100),
  bank_account_holder        text check (char_length(bank_account_holder) <= 200),
  bank_account_number        text check (char_length(bank_account_number) <= 40),
  bank_branch_code           text check (char_length(bank_branch_code) <= 20),
  bank_account_type          text check (char_length(bank_account_type) <= 40),
  lead_followup_days         integer not null default 2 check (lead_followup_days between 1 and 90),
  quote_followup_days        integer not null default 3 check (quote_followup_days between 1 and 90),
  invoice_due_soon_days      integer not null default 3 check (invoice_due_soon_days between 0 and 60),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
comment on table public.organisation_financial_settings is
  'Tax, numbering-adjacent defaults, banking and follow-up thresholds. Documents SNAPSHOT these at issue; later changes never alter issued documents.';

create trigger organisation_financial_settings_set_updated_at
  before update on public.organisation_financial_settings
  for each row execute function app_private.set_updated_at();

-- Every organisation gets a settings row (existing ones now, new ones on creation).
insert into public.organisation_financial_settings (organisation_id, vat_registered)
select o.id, o.vat_number is not null from public.organisations o
on conflict do nothing;

create or replace function app_private.create_financial_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.organisation_financial_settings (organisation_id) values (new.id) on conflict do nothing;
  insert into public.document_sequences (organisation_id, doc_type, prefix)
  values (new.id, 'quote', 'Q-'), (new.id, 'job', 'J-'), (new.id, 'invoice', 'INV-')
  on conflict do nothing;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Document numbering (row-locked counter per organisation + type)
-- -----------------------------------------------------------------------------
create table public.document_sequences (
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  doc_type         text not null check (doc_type in ('quote', 'job', 'invoice')),
  prefix           text not null check (prefix ~ '^[A-Za-z0-9/_-]{0,12}$'),
  next_value       bigint not null default 1 check (next_value >= 1),
  pad              smallint not null default 4 check (pad between 1 and 10),
  updated_at       timestamptz not null default now(),
  primary key (organisation_id, doc_type)
);
-- Called from guards (invoker) and issue RPCs (definer).
comment on table public.document_sequences is
  'Concurrency-safe numbering: next_document_number() takes a row lock (UPDATE … RETURNING). Gaps are possible only when a transaction rolls back after numbering.';

insert into public.document_sequences (organisation_id, doc_type, prefix)
select o.id, t.doc_type, t.prefix
from public.organisations o
cross join (values ('quote', 'Q-'), ('job', 'J-'), ('invoice', 'INV-')) t(doc_type, prefix)
on conflict do nothing;

create trigger organisations_create_financial_settings
  after insert on public.organisations
  for each row execute function app_private.create_financial_settings();

-- Called only from trusted DB functions (never granted to clients).
create or replace function app_private.next_document_number(p_organisation_id uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq public.document_sequences;
begin
  -- app_private is not exposed through the API; this check is defence in depth so a
  -- number can only be consumed by someone allowed to create that document type.
  if auth.uid() is not null and not app_private.has_permission(p_organisation_id,
       case p_doc_type when 'quote' then 'quotes.write' when 'job' then 'jobs.write' else 'invoices.issue' end) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  insert into public.document_sequences (organisation_id, doc_type, prefix)
  values (p_organisation_id, p_doc_type, case p_doc_type when 'quote' then 'Q-' when 'job' then 'J-' else 'INV-' end)
  on conflict do nothing;

  update public.document_sequences
     set next_value = next_value + 1, updated_at = now()
   where organisation_id = p_organisation_id and doc_type = p_doc_type
  returning * into v_seq;

  -- v_seq.next_value is the value AFTER increment; the number issued is one less.
  return v_seq.prefix || lpad((v_seq.next_value - 1)::text, v_seq.pad, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Money helpers (deterministic, exact numeric)
-- -----------------------------------------------------------------------------
-- Round half away from zero to cents. Postgres round(numeric) already does this; the
-- wrapper documents intent and keeps every money calculation on one function.
create or replace function app_private.money(p numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$ select round(coalesce(p, 0), 2) $$;

-- One line's amounts. Per-line VAT rounding (approved Phase 003 decision).
--   gross     = qty × unit price (rounded)
--   discount  = percent of gross or fixed amount, never more than gross
--   net       = gross − discount (in the document's price basis)
--   tax       = exclusive: net × rate ; inclusive: net × rate / (100 + rate)   (rounded)
--   excl      = exclusive: net ; inclusive: net − tax
--   total     = exclusive: net + tax ; inclusive: net
create or replace function app_private.line_amounts(
  p_quantity        numeric,
  p_unit_price      numeric,
  p_discount_type   text,
  p_discount_value  numeric,
  p_taxable         boolean,
  p_tax_rate        numeric,
  p_vat_registered  boolean,
  p_prices_include  boolean
)
returns table (gross numeric, discount numeric, tax numeric, excl numeric, total numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_gross numeric := app_private.money(p_quantity * p_unit_price);
  v_disc  numeric := 0;
  v_net   numeric;
  v_tax   numeric := 0;
  v_rate  numeric := case when p_vat_registered and p_taxable then coalesce(p_tax_rate, 0) else 0 end;
begin
  if p_discount_type = 'percent' then
    v_disc := app_private.money(v_gross * least(greatest(coalesce(p_discount_value, 0), 0), 100) / 100);
  elsif p_discount_type = 'amount' then
    v_disc := least(app_private.money(greatest(coalesce(p_discount_value, 0), 0)), greatest(v_gross, 0));
  end if;
  v_net := v_gross - v_disc;
  if v_rate > 0 then
    if p_prices_include then
      v_tax := app_private.money(v_net * v_rate / (100 + v_rate));
    else
      v_tax := app_private.money(v_net * v_rate / 100);
    end if;
  end if;
  gross := v_gross;
  discount := v_disc;
  tax := v_tax;
  excl := case when p_prices_include then v_net - v_tax else v_net end;
  total := case when p_prices_include then v_net else v_net + v_tax end;
  return next;
end;
$$;

-- -----------------------------------------------------------------------------
-- Generated documents register (PDFs in Storage)
-- -----------------------------------------------------------------------------
create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  entity_type      text not null check (entity_type in ('quote', 'invoice')),
  entity_id        uuid not null,
  kind             text not null check (kind in ('quote_pdf', 'invoice_pdf')),
  storage_bucket   text not null default 'documents' check (storage_bucket = 'documents'),
  storage_path     text not null check (char_length(storage_path) <= 500),
  file_name        text not null check (char_length(file_name) <= 200),
  byte_size        integer check (byte_size >= 0),
  sha256           text check (sha256 ~ '^[0-9a-f]{64}$'),
  version          integer not null default 1 check (version >= 1),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint documents_path_in_org check (storage_path like organisation_id::text || '/%'),
  unique (entity_type, entity_id, kind, version)
);
create index documents_org_idx on public.documents (organisation_id, created_at desc);
create index documents_entity_idx on public.documents (entity_type, entity_id);
create index documents_created_by_idx on public.documents (created_by);
comment on table public.documents is 'Issued PDFs rendered from document snapshots. Immutable; a re-render is a new version.';

create or replace function app_private.documents_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Generated documents cannot be changed' using errcode = '42501';
end;
$$;
create trigger documents_no_update
  before update or delete on public.documents
  for each row execute function app_private.documents_immutable();

-- -----------------------------------------------------------------------------
-- Storage (private buckets). Paths: <organisation_id>/<module>/<entity_id>/<file>
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents',  'documents',  false, 10485760, array['application/pdf']),
  ('job-photos', 'job-photos', false, 8388608,  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Folder 1 = organisation id. Folder 2 = module. Folder 3 = entity id.
create or replace function app_private.storage_org_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := split_part(p_name, '/', 1);
begin
  if v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
end;
$$;

create or replace function app_private.storage_entity_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := split_part(p_name, '/', 3);
begin
  if v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
end;
$$;

-- Documents bucket: read with the module's read permission; write with issue permission.
create policy documents_bucket_read on storage.objects for select to authenticated
  using (
    bucket_id = 'documents' and (
      (split_part(name, '/', 2) = 'quotes'
        and app_private.storage_org_id(name) in (select app_private.org_ids_with_permission('quotes.read')))
      or (split_part(name, '/', 2) = 'invoices'
        and app_private.storage_org_id(name) in (select app_private.org_ids_with_permission('invoices.read')))
    )
  );
create policy documents_bucket_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents' and (
      (split_part(name, '/', 2) = 'quotes'
        and app_private.storage_org_id(name) in (select app_private.org_ids_with_permission('quotes.issue')))
      or (split_part(name, '/', 2) = 'invoices'
        and app_private.storage_org_id(name) in (select app_private.org_ids_with_permission('invoices.issue')))
    )
  );
-- No update/delete policies on the documents bucket: issued PDFs are immutable.

revoke all on public.documents, public.organisation_financial_settings, public.document_sequences from anon, authenticated;
grant select, insert on public.documents to authenticated;
alter table public.documents enable row level security;
alter table public.organisation_financial_settings enable row level security;
alter table public.document_sequences enable row level security;

create policy documents_select on public.documents for select to authenticated
  using (
    (entity_type = 'quote' and organisation_id in (select app_private.org_ids_with_permission('quotes.read')))
    or (entity_type = 'invoice' and organisation_id in (select app_private.org_ids_with_permission('invoices.read')))
  );
create policy documents_insert on public.documents for insert to authenticated
  with check (
    created_by = (select auth.uid()) and (
      (entity_type = 'quote' and organisation_id in (select app_private.org_ids_with_permission('quotes.issue')))
      or (entity_type = 'invoice' and organisation_id in (select app_private.org_ids_with_permission('invoices.issue')))
    )
  );

grant select, update on public.organisation_financial_settings to authenticated;
create policy fin_settings_select on public.organisation_financial_settings for select to authenticated
  using (organisation_id in (select app_private.my_org_ids()));
create policy fin_settings_update on public.organisation_financial_settings for update to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('settings.update')))
  with check (organisation_id in (select app_private.org_ids_with_permission('settings.update')));

-- Sequences: prefixes readable by members; changes go through settings (owner/admin).
grant select, update (prefix, pad) on public.document_sequences to authenticated;
create policy doc_sequences_select on public.document_sequences for select to authenticated
  using (organisation_id in (select app_private.my_org_ids()));
create policy doc_sequences_update on public.document_sequences for update to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('settings.update')))
  with check (organisation_id in (select app_private.org_ids_with_permission('settings.update')));

revoke execute on all functions in schema app_private from anon, public;
grant execute on function app_private.money(numeric), app_private.storage_org_id(text), app_private.storage_entity_id(text),
  app_private.line_amounts(numeric, numeric, text, numeric, boolean, numeric, boolean, boolean) to authenticated;
