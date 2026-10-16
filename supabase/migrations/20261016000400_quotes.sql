-- =============================================================================
-- Phase 003 · Migration 3: quotes
--   * All money is numeric(14,2); line maths in app_private.line_amounts (per-line VAT)
--   * Totals are computed ONLY by the database (items trigger → refresh totals)
--   * Drafts are editable; issued quotes are frozen (commercial fields + items)
--   * Issue snapshots seller, customer, contact, site and tax configuration
--   * Transitions via RPCs: issue → (viewed) → accepted | declined; archive; duplicate
--   * Expiry is derived (sent/viewed past expiry_date) — see quote_effective_status
-- =============================================================================

create table public.quotes (
  id                              uuid primary key default gen_random_uuid(),
  organisation_id                 uuid not null references public.organisations (id) on delete cascade,
  quote_number                    text not null check (char_length(quote_number) between 1 and 40),
  customer_id                     uuid not null,
  contact_id                      uuid,
  site_address_id                 uuid,
  lead_id                         uuid,
  revision_of_id                  uuid references public.quotes (id),
  title                           text check (char_length(title) <= 200),
  status                          text not null default 'draft'
                                    check (status in ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'archived')),
  issue_date                      date not null default current_date,
  expiry_date                     date,
  currency                        text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  prices_include_tax              boolean not null default false,
  vat_registered_snapshot         boolean not null default false,
  tax_rate_snapshot               numeric(7, 4) not null default 0 check (tax_rate_snapshot >= 0 and tax_rate_snapshot < 100),
  tax_label_snapshot              text not null default 'VAT' check (char_length(tax_label_snapshot) <= 20),
  subtotal                        numeric(14, 2) not null default 0,
  discount_total                  numeric(14, 2) not null default 0,
  tax_total                       numeric(14, 2) not null default 0,
  total                           numeric(14, 2) not null default 0,
  customer_name_snapshot          text,
  customer_registration_snapshot  text,
  customer_tax_snapshot           text,
  customer_address_snapshot       text,
  site_address_snapshot           text,
  contact_name_snapshot           text,
  contact_email_snapshot          text,
  contact_phone_snapshot          text,
  seller_name_snapshot            text,
  seller_legal_name_snapshot      text,
  seller_registration_snapshot    text,
  seller_tax_snapshot             text,
  seller_address_snapshot         text,
  seller_email_snapshot           text,
  seller_phone_snapshot           text,
  notes                           text check (char_length(notes) <= 4000),
  terms                           text check (char_length(terms) <= 4000),
  sent_method                     text check (sent_method in ('manual', 'download', 'channel')),
  accepted_by                     uuid references public.profiles (id) on delete set null,
  accepted_method                 text check (accepted_method in ('verbal', 'email', 'whatsapp', 'signed', 'other')),
  declined_by                     uuid references public.profiles (id) on delete set null,
  decline_reason                  text check (char_length(decline_reason) <= 500),
  created_by                      uuid references public.profiles (id) on delete set null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  issued_at                       timestamptz,
  viewed_at                       timestamptz,
  accepted_at                     timestamptz,
  declined_at                     timestamptz,
  expired_at                      timestamptz,
  archived_at                     timestamptz,
  constraint quotes_id_org_key unique (id, organisation_id),
  constraint quotes_number_unique unique (organisation_id, quote_number),
  constraint quotes_customer_fk foreign key (customer_id, organisation_id) references public.customers (id, organisation_id),
  constraint quotes_lead_fk foreign key (lead_id, organisation_id) references public.leads (id, organisation_id),
  constraint quotes_expiry_after_issue check (expiry_date is null or expiry_date >= issue_date),
  constraint quotes_totals_consistent check (total = subtotal + tax_total),
  constraint quotes_issued_has_snapshot check (status in ('draft', 'archived') or (issued_at is not null and seller_name_snapshot is not null and customer_name_snapshot is not null))
);
create index quotes_org_status_idx on public.quotes (organisation_id, status);
create index quotes_org_issue_idx on public.quotes (organisation_id, issue_date desc);
create index quotes_org_created_idx on public.quotes (organisation_id, created_at desc);
create index quotes_customer_idx on public.quotes (customer_id);
create index quotes_lead_idx on public.quotes (lead_id);
create index quotes_revision_idx on public.quotes (revision_of_id);
create index quotes_created_by_idx on public.quotes (created_by);
create index quotes_accepted_by_idx on public.quotes (accepted_by);
create index quotes_declined_by_idx on public.quotes (declined_by);
create index quotes_number_trgm_idx on public.quotes using gin (quote_number extensions.gin_trgm_ops);

create table public.quote_items (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  quote_id         uuid not null,
  description      text not null check (char_length(trim(description)) between 1 and 1000),
  quantity         numeric(12, 3) not null default 1 check (quantity > 0 and quantity <= 1000000),
  unit             text check (char_length(unit) <= 20),
  unit_price       numeric(14, 2) not null default 0 check (unit_price >= 0 and unit_price <= 1000000000),
  discount_type    text check (discount_type in ('percent', 'amount')),
  discount_value   numeric(14, 2) check (discount_value >= 0),
  taxable          boolean not null default true,
  line_subtotal    numeric(14, 2) not null default 0,
  line_discount    numeric(14, 2) not null default 0,
  line_tax         numeric(14, 2) not null default 0,
  line_total       numeric(14, 2) not null default 0,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint quote_items_quote_fk foreign key (quote_id, organisation_id) references public.quotes (id, organisation_id) on delete cascade,
  constraint quote_items_discount_pair check ((discount_type is null) = (discount_value is null)),
  constraint quote_items_percent_max check (discount_type <> 'percent' or discount_value <= 100)
);
create index quote_items_quote_idx on public.quote_items (quote_id, organisation_id, sort_order);
create index quote_items_org_idx on public.quote_items (organisation_id);

create trigger quotes_set_updated_at before update on public.quotes
  for each row execute function app_private.set_updated_at();
create trigger quote_items_set_updated_at before update on public.quote_items
  for each row execute function app_private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Effective status (expiry is derived, never trusted from the client)
-- -----------------------------------------------------------------------------
create or replace function public.quote_effective_status(p_status text, p_expiry date, p_tz text default 'Africa/Johannesburg')
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status in ('sent', 'viewed') and p_expiry is not null
         and p_expiry < (now() at time zone coalesce(p_tz, 'Africa/Johannesburg'))::date then 'expired'
    else p_status end
$$;

-- -----------------------------------------------------------------------------
-- Calculation: item rows compute their own amounts; totals roll up in the parent
-- -----------------------------------------------------------------------------
create or replace function app_private.quote_item_compute()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_q   public.quotes;
  v_a   record;
begin
  select * into v_q from public.quotes where id = new.quote_id;
  if v_q.id is null then
    raise exception 'Quote not found' using errcode = '23503';
  end if;
  if v_q.status <> 'draft' and coalesce(current_setting('app.quote_recalc', true), '') <> 'on' then
    raise exception 'Only draft quotes can be changed. Duplicate the quote to revise it.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.quote_id <> old.quote_id or new.organisation_id <> old.organisation_id) then
    raise exception 'A line cannot move to another quote' using errcode = '42501';
  end if;
  new.organisation_id := v_q.organisation_id;
  select * into v_a from app_private.line_amounts(new.quantity, new.unit_price, new.discount_type, new.discount_value,
    new.taxable, v_q.tax_rate_snapshot, v_q.vat_registered_snapshot, v_q.prices_include_tax);
  new.line_subtotal := v_a.gross;
  new.line_discount := v_a.discount;
  new.line_tax := v_a.tax;
  new.line_total := v_a.total;
  return new;
end;
$$;
create trigger quote_items_compute before insert or update on public.quote_items
  for each row execute function app_private.quote_item_compute();

create or replace function app_private.quote_items_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.quotes q where q.id = old.quote_id and q.status <> 'draft') then
    raise exception 'Only draft quotes can be changed. Duplicate the quote to revise it.' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger quote_items_guard_delete before delete on public.quote_items
  for each row execute function app_private.quote_items_guard_delete();

create or replace function app_private.refresh_quote_totals(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.quote_totals', 'on', true);
  update public.quotes q
     set subtotal = coalesce(t.excl, 0),
         discount_total = coalesce(t.disc, 0),
         tax_total = coalesce(t.tax, 0),
         total = coalesce(t.excl, 0) + coalesce(t.tax, 0)
    from (select sum(line_total - line_tax) as excl, sum(line_discount) as disc, sum(line_tax) as tax
            from public.quote_items where quote_id = p_quote_id) t
   where q.id = p_quote_id;
  perform set_config('app.quote_totals', 'off', true);
end;
$$;

create or replace function app_private.quote_items_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.refresh_quote_totals(coalesce(new.quote_id, old.quote_id));
  return null;
end;
$$;
create trigger quote_items_after after insert or update or delete on public.quote_items
  for each row execute function app_private.quote_items_after();

-- Guard on quotes: tenancy, ownership, frozen fields after issue, totals only via refresh,
-- status only via RPCs, linked contact/site/lead consistency, defaults from settings.
create or replace function app_private.guard_quotes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fs      public.organisation_financial_settings;
  v_rpc     boolean := coalesce(current_setting('app.quote_transition', true), '') = 'on';
  v_totals  boolean := coalesce(current_setting('app.quote_totals', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    select * into v_fs from public.organisation_financial_settings where organisation_id = new.organisation_id;
    new.created_by := auth.uid();
    if not v_rpc then
      new.status := 'draft';
      new.quote_number := app_private.next_document_number(new.organisation_id, 'quote');
    end if;
    new.vat_registered_snapshot := coalesce(v_fs.vat_registered, false);
    new.tax_rate_snapshot := case when coalesce(v_fs.vat_registered, false) then coalesce(v_fs.tax_rate, 0) else 0 end;
    new.tax_label_snapshot := coalesce(v_fs.tax_label, 'VAT');
    new.currency := coalesce((select o.currency from public.organisations o where o.id = new.organisation_id), 'ZAR');
    new.expiry_date := coalesce(new.expiry_date, new.issue_date + coalesce(v_fs.quote_validity_days, 30));
    new.terms := coalesce(new.terms, v_fs.default_quote_terms);
    if new.prices_include_tax is null then new.prices_include_tax := coalesce(v_fs.prices_include_tax_default, false); end if;
    new.subtotal := 0; new.discount_total := 0; new.tax_total := 0; new.total := 0;
    new.issued_at := null; new.accepted_at := null; new.declined_at := null; new.viewed_at := null;
  else
    if new.organisation_id <> old.organisation_id or new.quote_number <> old.quote_number then
      raise exception 'Quote number and organisation cannot be changed' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    if not v_rpc and new.status is distinct from old.status then
      raise exception 'Use the quote actions to change its status' using errcode = '42501';
    end if;
    if not v_totals and (new.subtotal, new.discount_total, new.tax_total, new.total)
         is distinct from (old.subtotal, old.discount_total, old.tax_total, old.total) then
      raise exception 'Quote totals are calculated automatically' using errcode = '42501';
    end if;
    if old.status <> 'draft' and not v_rpc and not v_totals then
      -- Issued quotes are frozen. Only internal notes on the lifecycle may change via RPCs.
      raise exception 'This quote has been issued and can no longer be edited. Duplicate it to make a revision.' using errcode = '42501';
    end if;
    if not v_rpc then
      -- Snapshot columns are written only by issue_quote().
      new.customer_name_snapshot := old.customer_name_snapshot; new.customer_registration_snapshot := old.customer_registration_snapshot;
      new.customer_tax_snapshot := old.customer_tax_snapshot; new.customer_address_snapshot := old.customer_address_snapshot;
      new.site_address_snapshot := old.site_address_snapshot; new.contact_name_snapshot := old.contact_name_snapshot;
      new.contact_email_snapshot := old.contact_email_snapshot; new.contact_phone_snapshot := old.contact_phone_snapshot;
      new.seller_name_snapshot := old.seller_name_snapshot; new.seller_legal_name_snapshot := old.seller_legal_name_snapshot;
      new.seller_registration_snapshot := old.seller_registration_snapshot; new.seller_tax_snapshot := old.seller_tax_snapshot;
      new.seller_address_snapshot := old.seller_address_snapshot; new.seller_email_snapshot := old.seller_email_snapshot;
      new.seller_phone_snapshot := old.seller_phone_snapshot;
      new.vat_registered_snapshot := old.vat_registered_snapshot; new.tax_rate_snapshot := old.tax_rate_snapshot;
      new.tax_label_snapshot := old.tax_label_snapshot; new.currency := old.currency;
      new.issued_at := old.issued_at; new.accepted_at := old.accepted_at; new.declined_at := old.declined_at;
      new.viewed_at := old.viewed_at; new.accepted_by := old.accepted_by; new.declined_by := old.declined_by;
      new.archived_at := old.archived_at; new.sent_method := old.sent_method;
    end if;
  end if;
  if new.contact_id is not null and not exists (
       select 1 from public.customer_contacts c where c.id = new.contact_id and c.customer_id = new.customer_id) then
    raise exception 'Contact does not belong to this customer' using errcode = '23503';
  end if;
  if new.site_address_id is not null and not exists (
       select 1 from public.customer_addresses a where a.id = new.site_address_id and a.customer_id = new.customer_id) then
    raise exception 'Site does not belong to this customer' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger quotes_guard before insert or update on public.quotes
  for each row execute function app_private.guard_quotes();

-- Re-price all lines when a draft's tax basis changes.
create or replace function app_private.quotes_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.prices_include_tax, new.tax_rate_snapshot, new.vat_registered_snapshot)
       is distinct from (old.prices_include_tax, old.tax_rate_snapshot, old.vat_registered_snapshot) then
    perform set_config('app.quote_recalc', 'on', true);
    update public.quote_items set sort_order = sort_order where quote_id = new.id;
    perform set_config('app.quote_recalc', 'off', true);
  end if;
  return null;
end;
$$;
create trigger quotes_after_update after update on public.quotes
  for each row execute function app_private.quotes_after_update();

create or replace function app_private.audit_quotes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := jsonb_build_object('quote_number', new.quote_number, 'customer_id', new.customer_id, 'total', new.total);
begin
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.organisation_id, 'quote_created', 'quote', new.id, v_meta);
  elsif new.status is distinct from old.status then
    perform app_private.log_activity(new.organisation_id,
      case new.status when 'sent' then 'quote_issued' when 'viewed' then 'quote_viewed' when 'accepted' then 'quote_accepted'
                      when 'declined' then 'quote_declined' when 'expired' then 'quote_expired' when 'archived' then 'quote_archived'
                      else 'quote_status_changed' end,
      'quote', new.id, v_meta || jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return null;
end;
$$;
create trigger quotes_audit after insert or update on public.quotes
  for each row execute function app_private.audit_quotes();

-- -----------------------------------------------------------------------------
-- Snapshot helpers (shared with invoices)
-- -----------------------------------------------------------------------------
create or replace function app_private.format_address(p_line1 text, p_line2 text, p_suburb text, p_city text, p_province text, p_postal text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(concat_ws(E'\n', nullif(trim(p_line1), ''), nullif(trim(p_line2), ''),
    nullif(concat_ws(', ', nullif(trim(p_suburb), ''), nullif(trim(p_city), '')), ''),
    nullif(concat_ws(' ', nullif(trim(p_province), ''), nullif(trim(p_postal), '')), '')), '')
$$;

create or replace function app_private.document_snapshot(p_organisation_id uuid, p_customer_id uuid, p_contact_id uuid, p_site_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o   public.organisations;
  fs  public.organisation_financial_settings;
  c   public.customers;
  ct  public.customer_contacts;
  st  public.customer_addresses;
  b   public.customer_addresses;
begin
  select * into o from public.organisations where id = p_organisation_id;
  select * into fs from public.organisation_financial_settings where organisation_id = p_organisation_id;
  select * into c from public.customers where id = p_customer_id and organisation_id = p_organisation_id;
  select * into ct from public.customer_contacts where id = p_contact_id and customer_id = p_customer_id;
  if ct.id is null then
    select * into ct from public.customer_contacts where customer_id = p_customer_id and is_primary limit 1;
  end if;
  select * into st from public.customer_addresses where id = p_site_id and customer_id = p_customer_id;
  select * into b from public.customer_addresses where customer_id = p_customer_id and is_default_billing limit 1;
  if b.id is null then b := st; end if;
  return jsonb_build_object(
    'customer_name', c.display_name,
    'customer_registration', c.registration_number,
    'customer_tax', c.vat_number,
    'customer_address', app_private.format_address(b.line1, b.line2, b.suburb, b.city, b.province, b.postal_code),
    'site_address', app_private.format_address(st.line1, st.line2, st.suburb, st.city, st.province, st.postal_code),
    'contact_name', nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), ''),
    'contact_email', coalesce(ct.email, c.email),
    'contact_phone', coalesce(ct.phone, c.phone),
    'seller_name', o.name,
    'seller_legal_name', o.legal_name,
    'seller_registration', o.registration_number,
    'seller_tax', case when coalesce(fs.vat_registered, false) then o.vat_number else null end,
    'seller_address', app_private.format_address(o.address_line1, o.address_line2, o.suburb, o.city, o.province, o.postal_code),
    'seller_email', o.email,
    'seller_phone', o.phone,
    'vat_registered', coalesce(fs.vat_registered, false),
    'tax_rate', case when coalesce(fs.vat_registered, false) then fs.tax_rate else 0 end,
    'tax_label', coalesce(fs.tax_label, 'VAT'));
end;
$$;

-- -----------------------------------------------------------------------------
-- Transitions (SECURITY DEFINER with explicit permission + tenancy checks)
-- -----------------------------------------------------------------------------
create or replace function app_private.lock_quote_for(p_quote_id uuid, p_permission text)
returns public.quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.quotes;
begin
  select * into v from public.quotes where id = p_quote_id for update;
  if v.id is null or not app_private.has_permission(v.organisation_id, 'quotes.read') then
    raise exception 'Quote not found' using errcode = 'P0002';
  end if;
  if not app_private.has_permission(v.organisation_id, p_permission) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  return v;
end;
$$;

create or replace function public.issue_quote(p_quote_id uuid, p_method text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v   public.quotes := app_private.lock_quote_for(p_quote_id, 'quotes.issue');
  s   jsonb;
  n   integer;
begin
  if v.status <> 'draft' then
    -- Idempotent: a second click on an already-issued quote is a no-op.
    return jsonb_build_object('id', v.id, 'status', v.status, 'quote_number', v.quote_number, 'already', true);
  end if;
  if coalesce(p_method, 'manual') not in ('manual', 'download', 'channel') then
    raise exception 'Invalid send method' using errcode = '22023';
  end if;
  if p_method = 'channel' then
    raise exception 'No messaging channel is connected yet' using errcode = '22023';
  end if;
  select count(*) into n from public.quote_items where quote_id = v.id;
  if n = 0 then
    raise exception 'Add at least one line before issuing the quote' using errcode = '22023';
  end if;
  s := app_private.document_snapshot(v.organisation_id, v.customer_id, v.contact_id, v.site_address_id);

  perform set_config('app.quote_transition', 'on', true);
  -- Freeze the tax basis as at issue, then re-price lines under it.
  update public.quotes set
    vat_registered_snapshot = (s ->> 'vat_registered')::boolean,
    tax_rate_snapshot = coalesce((s ->> 'tax_rate')::numeric, 0),
    tax_label_snapshot = s ->> 'tax_label'
  where id = v.id;
  update public.quotes set
    status = 'sent', sent_method = coalesce(p_method, 'manual'), issued_at = now(),
    issue_date = least(issue_date, (now() at time zone 'Africa/Johannesburg')::date),
    customer_name_snapshot = s ->> 'customer_name', customer_registration_snapshot = s ->> 'customer_registration',
    customer_tax_snapshot = s ->> 'customer_tax', customer_address_snapshot = s ->> 'customer_address',
    site_address_snapshot = s ->> 'site_address', contact_name_snapshot = s ->> 'contact_name',
    contact_email_snapshot = s ->> 'contact_email', contact_phone_snapshot = s ->> 'contact_phone',
    seller_name_snapshot = s ->> 'seller_name', seller_legal_name_snapshot = s ->> 'seller_legal_name',
    seller_registration_snapshot = s ->> 'seller_registration', seller_tax_snapshot = s ->> 'seller_tax',
    seller_address_snapshot = s ->> 'seller_address', seller_email_snapshot = s ->> 'seller_email',
    seller_phone_snapshot = s ->> 'seller_phone'
  where id = v.id;
  perform set_config('app.quote_transition', 'off', true);

  if v.lead_id is not null then
    update public.leads set status = 'quote_sent' where id = v.lead_id and status in ('new', 'contacted', 'qualified', 'quote_needed');
  end if;
  select * into v from public.quotes where id = v.id;
  return jsonb_build_object('id', v.id, 'status', v.status, 'quote_number', v.quote_number, 'total', v.total);
end;
$$;

create or replace function public.set_quote_outcome(
  p_quote_id uuid,
  p_outcome  text,             -- viewed | accepted | declined | archived
  p_method   text default null,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v    public.quotes := app_private.lock_quote_for(p_quote_id, 'quotes.issue');
  eff  text;
  tz   text;
begin
  select timezone into tz from public.organisations where id = v.organisation_id;
  eff := public.quote_effective_status(v.status, v.expiry_date, tz);
  if p_outcome = v.status then
    return jsonb_build_object('id', v.id, 'status', v.status, 'already', true);
  end if;
  if p_outcome = 'viewed' and v.status <> 'sent' then
    raise exception 'Only a sent quote can be marked viewed' using errcode = '22023';
  elsif p_outcome in ('accepted', 'declined') and v.status not in ('sent', 'viewed') then
    raise exception 'Only a sent quote can be accepted or declined' using errcode = '22023';
  elsif p_outcome = 'accepted' and eff = 'expired' then
    raise exception 'This quote has expired. Duplicate it to re-issue with a new expiry date' using errcode = '22023';
  elsif p_outcome = 'archived' and v.status = 'archived' then
    return jsonb_build_object('id', v.id, 'status', v.status, 'already', true);
  elsif p_outcome not in ('viewed', 'accepted', 'declined', 'archived') then
    raise exception 'Invalid quote outcome' using errcode = '22023';
  end if;
  if p_outcome = 'accepted' and coalesce(p_method, 'other') not in ('verbal', 'email', 'whatsapp', 'signed', 'other') then
    raise exception 'Invalid acceptance method' using errcode = '22023';
  end if;

  perform set_config('app.quote_transition', 'on', true);
  update public.quotes set
    status = p_outcome,
    viewed_at = case when p_outcome = 'viewed' then now() else viewed_at end,
    accepted_at = case when p_outcome = 'accepted' then now() else accepted_at end,
    accepted_by = case when p_outcome = 'accepted' then auth.uid() else accepted_by end,
    accepted_method = case when p_outcome = 'accepted' then coalesce(p_method, 'other') else accepted_method end,
    declined_at = case when p_outcome = 'declined' then now() else declined_at end,
    declined_by = case when p_outcome = 'declined' then auth.uid() else declined_by end,
    decline_reason = case when p_outcome = 'declined' then left(p_reason, 500) else decline_reason end,
    archived_at = case when p_outcome = 'archived' then now() else archived_at end
  where id = v.id;
  perform set_config('app.quote_transition', 'off', true);

  if v.lead_id is not null and p_outcome = 'accepted' then
    update public.leads set status = 'won' where id = v.lead_id and status <> 'won';
  end if;
  return jsonb_build_object('id', v.id, 'status', p_outcome);
end;
$$;

-- Duplicate (revision): new draft with the same lines; history stays untouched.
create or replace function public.duplicate_quote(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v     public.quotes := app_private.lock_quote_for(p_quote_id, 'quotes.write');
  v_new uuid;
begin
  insert into public.quotes (organisation_id, customer_id, contact_id, site_address_id, lead_id, revision_of_id, title,
                             prices_include_tax, notes, terms, issue_date)
  values (v.organisation_id, v.customer_id, v.contact_id, v.site_address_id, v.lead_id, v.id, v.title,
          v.prices_include_tax, v.notes, v.terms, (now() at time zone 'Africa/Johannesburg')::date)
  returning id into v_new;
  insert into public.quote_items (organisation_id, quote_id, description, quantity, unit, unit_price, discount_type, discount_value, taxable, sort_order)
  select organisation_id, v_new, description, quantity, unit, unit_price, discount_type, discount_value, taxable, sort_order
  from public.quote_items where quote_id = v.id order by sort_order;
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants + RLS
-- -----------------------------------------------------------------------------
revoke all on public.quotes, public.quote_items from anon, authenticated;
grant select, insert, update on public.quotes to authenticated;                      -- no delete: archive only
grant select, insert, update, delete on public.quote_items to authenticated;         -- draft-only (guard)

alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;

create policy quotes_select on public.quotes for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('quotes.read')));
create policy quotes_insert on public.quotes for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('quotes.write')));
create policy quotes_update on public.quotes for update to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('quotes.write')))
  with check (organisation_id in (select app_private.org_ids_with_permission('quotes.write')));

create policy quote_items_select on public.quote_items for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('quotes.read')));
create policy quote_items_write on public.quote_items for all to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('quotes.write')))
  with check (organisation_id in (select app_private.org_ids_with_permission('quotes.write')));

revoke execute on function public.issue_quote(uuid, text), public.set_quote_outcome(uuid, text, text, text), public.duplicate_quote(uuid)
  from public, anon;
grant execute on function public.issue_quote(uuid, text), public.set_quote_outcome(uuid, text, text, text), public.duplicate_quote(uuid),
  public.quote_effective_status(text, date, text) to authenticated;
revoke execute on all functions in schema app_private from anon, public;
