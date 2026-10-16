-- =============================================================================
-- Phase 003 · Migration 5: invoices, invoice items, payments
--   * Invoice numbers are assigned at ISSUE (unbroken INV-0001 sequence for issued
--     tax invoices; drafts have no number)
--   * Same per-line calculation as quotes (app_private.line_amounts)
--   * Issued invoices are frozen; corrections = void (only when no payments) + reissue
--   * Payments: row-locked, idempotent (idempotency_key), overpayment rejected,
--     amount_paid / amount_due / status maintained only by the database
--   * Accounting-ready: amounts are exact numeric and every financial event is an
--     immutable row with timestamps and actor, so a future double-entry engine can
--     post journals from invoices (issue/void) and payments (record/void).
-- =============================================================================

create table public.invoices (
  id                              uuid primary key default gen_random_uuid(),
  organisation_id                 uuid not null references public.organisations (id) on delete cascade,
  invoice_number                  text check (char_length(invoice_number) between 1 and 40),
  customer_id                     uuid not null,
  contact_id                      uuid,
  site_address_id                 uuid,
  job_id                          uuid,
  quote_id                        uuid,
  title                           text check (char_length(title) <= 200),
  status                          text not null default 'draft'
                                    check (status in ('draft', 'issued', 'partially_paid', 'paid', 'void', 'archived')),
  issue_date                      date not null default current_date,
  due_date                        date,
  currency                        text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  prices_include_tax              boolean not null default false,
  vat_registered_snapshot         boolean not null default false,
  tax_rate_snapshot               numeric(7, 4) not null default 0 check (tax_rate_snapshot >= 0 and tax_rate_snapshot < 100),
  tax_label_snapshot              text not null default 'VAT' check (char_length(tax_label_snapshot) <= 20),
  subtotal                        numeric(14, 2) not null default 0,
  discount_total                  numeric(14, 2) not null default 0,
  tax_total                       numeric(14, 2) not null default 0,
  total                           numeric(14, 2) not null default 0,
  amount_paid                     numeric(14, 2) not null default 0 check (amount_paid >= 0),
  amount_due                      numeric(14, 2) not null default 0,
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
  payment_details_snapshot        text,
  notes                           text check (char_length(notes) <= 4000),
  terms                           text check (char_length(terms) <= 4000),
  void_reason                     text check (char_length(void_reason) <= 500),
  created_by                      uuid references public.profiles (id) on delete set null,
  issued_by                       uuid references public.profiles (id) on delete set null,
  voided_by                       uuid references public.profiles (id) on delete set null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  issued_at                       timestamptz,
  paid_at                         timestamptz,
  voided_at                       timestamptz,
  archived_at                     timestamptz,
  constraint invoices_id_org_key unique (id, organisation_id),
  constraint invoices_number_unique unique (organisation_id, invoice_number),
  constraint invoices_customer_fk foreign key (customer_id, organisation_id) references public.customers (id, organisation_id),
  constraint invoices_job_fk foreign key (job_id, organisation_id) references public.jobs (id, organisation_id),
  constraint invoices_quote_fk foreign key (quote_id, organisation_id) references public.quotes (id, organisation_id),
  constraint invoices_due_after_issue check (due_date is null or due_date >= issue_date),
  constraint invoices_totals_consistent check (total = subtotal + tax_total),
  constraint invoices_due_consistent check (amount_due = total - amount_paid),
  constraint invoices_no_overpayment check (amount_paid <= total),
  constraint invoices_number_when_issued check ((status = 'draft') = (invoice_number is null) or status = 'archived'),
  constraint invoices_issued_has_snapshot check (status in ('draft', 'archived') or (issued_at is not null and seller_name_snapshot is not null))
);
create unique index invoices_one_per_job_idx on public.invoices (job_id) where job_id is not null and status <> 'void';
create unique index invoices_one_per_quote_idx on public.invoices (quote_id) where quote_id is not null and status <> 'void';
create index invoices_org_status_idx on public.invoices (organisation_id, status);
create index invoices_org_due_idx on public.invoices (organisation_id, due_date) where status in ('issued', 'partially_paid');
create index invoices_org_issue_idx on public.invoices (organisation_id, issue_date desc);
create index invoices_org_created_idx on public.invoices (organisation_id, created_at desc);
create index invoices_customer_idx on public.invoices (customer_id);
create index invoices_created_by_idx on public.invoices (created_by);
create index invoices_issued_by_idx on public.invoices (issued_by);
create index invoices_voided_by_idx on public.invoices (voided_by);
create index invoices_number_trgm_idx on public.invoices using gin (invoice_number extensions.gin_trgm_ops);

create table public.invoice_items (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  invoice_id       uuid not null,
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
  constraint invoice_items_invoice_fk foreign key (invoice_id, organisation_id) references public.invoices (id, organisation_id) on delete cascade,
  constraint invoice_items_discount_pair check ((discount_type is null) = (discount_value is null)),
  constraint invoice_items_percent_max check (discount_type <> 'percent' or discount_value <= 100)
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, organisation_id, sort_order);
create index invoice_items_org_idx on public.invoice_items (organisation_id);

create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  invoice_id        uuid not null,
  customer_id       uuid not null,
  amount            numeric(14, 2) not null check (amount > 0),
  payment_date      date not null,
  payment_method    text not null check (payment_method in ('bank_transfer', 'cash', 'card', 'other')),
  reference         text check (char_length(reference) <= 200),
  notes             text check (char_length(notes) <= 1000),
  idempotency_key   text check (char_length(idempotency_key) between 8 and 100),
  recorded_by       uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  voided_at         timestamptz,
  voided_by         uuid references public.profiles (id) on delete set null,
  void_reason       text check (char_length(void_reason) <= 500),
  constraint payments_invoice_fk foreign key (invoice_id, organisation_id) references public.invoices (id, organisation_id),
  constraint payments_customer_fk foreign key (customer_id, organisation_id) references public.customers (id, organisation_id),
  constraint payments_void_consistency check ((voided_at is null) = (voided_by is null))
);
create unique index payments_idempotency_idx on public.payments (organisation_id, idempotency_key) where idempotency_key is not null;
create index payments_invoice_idx on public.payments (invoice_id, organisation_id);
create index payments_org_date_idx on public.payments (organisation_id, payment_date desc);
create index payments_customer_idx on public.payments (customer_id);
create index payments_recorded_by_idx on public.payments (recorded_by);
create index payments_voided_by_idx on public.payments (voided_by);

create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function app_private.set_updated_at();
create trigger invoice_items_set_updated_at before update on public.invoice_items
  for each row execute function app_private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Effective status: overdue is derived from due date + balance
-- -----------------------------------------------------------------------------
create or replace function public.invoice_effective_status(p_status text, p_due date, p_amount_due numeric, p_tz text default 'Africa/Johannesburg')
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status in ('issued', 'partially_paid') and p_amount_due > 0 and p_due is not null
         and p_due < (now() at time zone coalesce(p_tz, 'Africa/Johannesburg'))::date then 'overdue'
    else p_status end
$$;

-- -----------------------------------------------------------------------------
-- Calculation (same engine as quotes)
-- -----------------------------------------------------------------------------
create or replace function app_private.invoice_item_compute()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_i public.invoices;
  v_a record;
begin
  select * into v_i from public.invoices where id = new.invoice_id;
  if v_i.id is null then
    raise exception 'Invoice not found' using errcode = '23503';
  end if;
  if v_i.status <> 'draft' and coalesce(current_setting('app.invoice_recalc', true), '') <> 'on' then
    raise exception 'Only draft invoices can be changed' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.invoice_id <> old.invoice_id or new.organisation_id <> old.organisation_id) then
    raise exception 'A line cannot move to another invoice' using errcode = '42501';
  end if;
  new.organisation_id := v_i.organisation_id;
  select * into v_a from app_private.line_amounts(new.quantity, new.unit_price, new.discount_type, new.discount_value,
    new.taxable, v_i.tax_rate_snapshot, v_i.vat_registered_snapshot, v_i.prices_include_tax);
  new.line_subtotal := v_a.gross; new.line_discount := v_a.discount; new.line_tax := v_a.tax; new.line_total := v_a.total;
  return new;
end;
$$;
create trigger invoice_items_compute before insert or update on public.invoice_items
  for each row execute function app_private.invoice_item_compute();

create or replace function app_private.invoice_items_guard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.invoices i where i.id = old.invoice_id and i.status <> 'draft') then
    raise exception 'Only draft invoices can be changed' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger invoice_items_guard_delete before delete on public.invoice_items
  for each row execute function app_private.invoice_items_guard_delete();

create or replace function app_private.refresh_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.invoice_totals', 'on', true);
  update public.invoices i
     set subtotal = coalesce(t.excl, 0),
         discount_total = coalesce(t.disc, 0),
         tax_total = coalesce(t.tax, 0),
         total = coalesce(t.excl, 0) + coalesce(t.tax, 0),
         amount_due = coalesce(t.excl, 0) + coalesce(t.tax, 0) - i.amount_paid
    from (select sum(line_total - line_tax) as excl, sum(line_discount) as disc, sum(line_tax) as tax
            from public.invoice_items where invoice_id = p_invoice_id) t
   where i.id = p_invoice_id;
  perform set_config('app.invoice_totals', 'off', true);
end;
$$;

create or replace function app_private.invoice_items_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.refresh_invoice_totals(coalesce(new.invoice_id, old.invoice_id));
  return null;
end;
$$;
create trigger invoice_items_after after insert or update or delete on public.invoice_items
  for each row execute function app_private.invoice_items_after();

create or replace function app_private.guard_invoices()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fs      public.organisation_financial_settings;
  v_rpc     boolean := coalesce(current_setting('app.invoice_transition', true), '') = 'on';
  v_totals  boolean := coalesce(current_setting('app.invoice_totals', true), '') = 'on';
  v_terms   integer;
begin
  if tg_op = 'INSERT' then
    select * into v_fs from public.organisation_financial_settings where organisation_id = new.organisation_id;
    select payment_terms_days into v_terms from public.customers where id = new.customer_id;
    new.created_by := auth.uid();
    new.status := 'draft';
    new.invoice_number := null;
    new.vat_registered_snapshot := coalesce(v_fs.vat_registered, false);
    new.tax_rate_snapshot := case when coalesce(v_fs.vat_registered, false) then coalesce(v_fs.tax_rate, 0) else 0 end;
    new.tax_label_snapshot := coalesce(v_fs.tax_label, 'VAT');
    new.currency := coalesce((select o.currency from public.organisations o where o.id = new.organisation_id), 'ZAR');
    new.due_date := coalesce(new.due_date, new.issue_date + coalesce(v_terms, v_fs.invoice_due_days, 30));
    new.terms := coalesce(new.terms, v_fs.default_invoice_terms);
    new.subtotal := 0; new.discount_total := 0; new.tax_total := 0; new.total := 0; new.amount_paid := 0; new.amount_due := 0;
    new.issued_at := null; new.paid_at := null; new.voided_at := null; new.issued_by := null; new.voided_by := null;
  else
    if new.organisation_id <> old.organisation_id then
      raise exception 'An invoice cannot move between organisations' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    if not v_rpc and (new.status is distinct from old.status or new.invoice_number is distinct from old.invoice_number) then
      raise exception 'Use the invoice actions to change its status' using errcode = '42501';
    end if;
    if not v_totals and not v_rpc and (new.subtotal, new.discount_total, new.tax_total, new.total, new.amount_paid, new.amount_due)
         is distinct from (old.subtotal, old.discount_total, old.tax_total, old.total, old.amount_paid, old.amount_due) then
      raise exception 'Invoice totals are calculated automatically' using errcode = '42501';
    end if;
    if old.status <> 'draft' and not v_rpc and not v_totals then
      raise exception 'This invoice has been issued and can no longer be edited' using errcode = '42501';
    end if;
    if new.job_id is distinct from old.job_id or new.quote_id is distinct from old.quote_id then
      raise exception 'An invoice''s job or quote cannot be changed' using errcode = '42501';
    end if;
    if not v_rpc then
      new.customer_name_snapshot := old.customer_name_snapshot; new.customer_registration_snapshot := old.customer_registration_snapshot;
      new.customer_tax_snapshot := old.customer_tax_snapshot; new.customer_address_snapshot := old.customer_address_snapshot;
      new.site_address_snapshot := old.site_address_snapshot; new.contact_name_snapshot := old.contact_name_snapshot;
      new.contact_email_snapshot := old.contact_email_snapshot; new.contact_phone_snapshot := old.contact_phone_snapshot;
      new.seller_name_snapshot := old.seller_name_snapshot; new.seller_legal_name_snapshot := old.seller_legal_name_snapshot;
      new.seller_registration_snapshot := old.seller_registration_snapshot; new.seller_tax_snapshot := old.seller_tax_snapshot;
      new.seller_address_snapshot := old.seller_address_snapshot; new.seller_email_snapshot := old.seller_email_snapshot;
      new.seller_phone_snapshot := old.seller_phone_snapshot; new.payment_details_snapshot := old.payment_details_snapshot;
      new.vat_registered_snapshot := old.vat_registered_snapshot; new.tax_rate_snapshot := old.tax_rate_snapshot;
      new.tax_label_snapshot := old.tax_label_snapshot; new.currency := old.currency;
      new.issued_at := old.issued_at; new.paid_at := old.paid_at; new.voided_at := old.voided_at;
      new.issued_by := old.issued_by; new.voided_by := old.voided_by; new.void_reason := old.void_reason; new.archived_at := old.archived_at;
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
create trigger invoices_guard before insert or update on public.invoices
  for each row execute function app_private.guard_invoices();

create or replace function app_private.invoices_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.prices_include_tax, new.tax_rate_snapshot, new.vat_registered_snapshot)
       is distinct from (old.prices_include_tax, old.tax_rate_snapshot, old.vat_registered_snapshot) then
    perform set_config('app.invoice_recalc', 'on', true);
    update public.invoice_items set sort_order = sort_order where invoice_id = new.id;
    perform set_config('app.invoice_recalc', 'off', true);
  end if;
  return null;
end;
$$;
create trigger invoices_after_update after update on public.invoices
  for each row execute function app_private.invoices_after_update();

create or replace function app_private.audit_invoices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := jsonb_build_object('invoice_number', new.invoice_number, 'customer_id', new.customer_id, 'total', new.total);
begin
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.organisation_id, 'invoice_created', 'invoice', new.id,
      v_meta || jsonb_build_object('job_id', new.job_id, 'quote_id', new.quote_id));
  elsif new.status is distinct from old.status then
    perform app_private.log_activity(new.organisation_id,
      case new.status when 'issued' then case when old.status = 'draft' then 'invoice_issued' else 'invoice_status_changed' end
                      when 'paid' then 'invoice_paid' when 'void' then 'invoice_voided' when 'archived' then 'invoice_archived'
                      else 'invoice_status_changed' end,
      'invoice', new.id, v_meta || jsonb_build_object('from', old.status, 'to', new.status, 'amount_due', new.amount_due));
  end if;
  return null;
end;
$$;
create trigger invoices_audit after insert or update on public.invoices
  for each row execute function app_private.audit_invoices();

-- -----------------------------------------------------------------------------
-- Creation from job / quote (idempotent; invoker so RLS applies)
-- -----------------------------------------------------------------------------
create or replace function app_private.copy_quote_items_to_invoice(p_quote_id uuid, p_invoice_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.invoice_items (organisation_id, invoice_id, description, quantity, unit, unit_price, discount_type, discount_value, taxable, sort_order)
  select organisation_id, p_invoice_id, description, quantity, unit, unit_price, discount_type, discount_value, taxable, sort_order
  from public.quote_items where quote_id = p_quote_id order by sort_order;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.create_invoice_from_job(p_job_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  j      public.jobs;
  q      public.quotes;
  v_inv  uuid;
begin
  -- No row lock: invoicing roles may not have job update rights. Double submits are
  -- stopped by the unique index (one non-void invoice per job), handled below.
  select * into j from public.jobs where id = p_job_id;
  if j.id is null then raise exception 'Job not found' using errcode = 'P0002'; end if;
  select id into v_inv from public.invoices where job_id = j.id and status <> 'void' limit 1;
  if v_inv is not null then return jsonb_build_object('invoice_id', v_inv, 'created', false); end if;
  if j.quote_id is not null then
    select id into v_inv from public.invoices where quote_id = j.quote_id and status <> 'void' limit 1;
    if v_inv is not null then
      return jsonb_build_object('invoice_id', v_inv, 'created', false, 'via_quote', true);
    end if;
  end if;
  if j.status <> 'completed' then
    raise exception 'Complete the job before invoicing it' using errcode = '22023';
  end if;
  if j.quote_id is not null then select * into q from public.quotes where id = j.quote_id; end if;
  insert into public.invoices (organisation_id, customer_id, contact_id, site_address_id, job_id, quote_id, title,
                               prices_include_tax, notes, issue_date)
  values (j.organisation_id, j.customer_id, j.contact_id, j.site_address_id, j.id, j.quote_id,
          coalesce(nullif(q.title, ''), j.title), coalesce(q.prices_include_tax, false),
          case when q.id is not null then 'Ref: ' || q.quote_number || ' · ' || j.job_number else 'Ref: ' || j.job_number end,
          (now() at time zone coalesce((select timezone from public.organisations where id = j.organisation_id), 'Africa/Johannesburg'))::date)
  returning id into v_inv;
  if q.id is not null then
    perform app_private.copy_quote_items_to_invoice(q.id, v_inv);
  else
    insert into public.invoice_items (organisation_id, invoice_id, description, quantity, unit_price, sort_order)
    values (j.organisation_id, v_inv, j.title, 1, 0, 0);
  end if;
  return jsonb_build_object('invoice_id', v_inv, 'created', true);
exception when unique_violation then
  select id into v_inv from public.invoices where (job_id = p_job_id or (j.quote_id is not null and quote_id = j.quote_id)) and status <> 'void' limit 1;
  return jsonb_build_object('invoice_id', v_inv, 'created', false);
end;
$$;

create or replace function public.create_invoice_from_quote(p_quote_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  q      public.quotes;
  v_inv  uuid;
begin
  select * into q from public.quotes where id = p_quote_id;
  if q.id is null then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  select id into v_inv from public.invoices where quote_id = q.id and status <> 'void' limit 1;
  if v_inv is not null then return jsonb_build_object('invoice_id', v_inv, 'created', false); end if;
  if q.status <> 'accepted' then
    raise exception 'Only an accepted quote can be invoiced' using errcode = '22023';
  end if;
  insert into public.invoices (organisation_id, customer_id, contact_id, site_address_id, quote_id, title, prices_include_tax, notes, issue_date)
  values (q.organisation_id, q.customer_id, q.contact_id, q.site_address_id, q.id, q.title, q.prices_include_tax,
          'Ref: ' || q.quote_number,
          (now() at time zone coalesce((select timezone from public.organisations where id = q.organisation_id), 'Africa/Johannesburg'))::date)
  returning id into v_inv;
  perform app_private.copy_quote_items_to_invoice(q.id, v_inv);
  return jsonb_build_object('invoice_id', v_inv, 'created', true);
exception when unique_violation then
  select id into v_inv from public.invoices where quote_id = p_quote_id and status <> 'void' limit 1;
  return jsonb_build_object('invoice_id', v_inv, 'created', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Transitions (definer + explicit checks)
-- -----------------------------------------------------------------------------
create or replace function app_private.lock_invoice_for(p_invoice_id uuid, p_permission text)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
begin
  select * into v from public.invoices where id = p_invoice_id for update;
  if v.id is null or not app_private.has_permission(v.organisation_id, 'invoices.read') then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if not app_private.has_permission(v.organisation_id, p_permission) then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;
  return v;
end;
$$;

create or replace function public.issue_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v    public.invoices := app_private.lock_invoice_for(p_invoice_id, 'invoices.issue');
  s    jsonb;
  fs   public.organisation_financial_settings;
  tz   text;
  n    integer;
  num  text;
  pay  text;
begin
  if v.status <> 'draft' then
    return jsonb_build_object('id', v.id, 'status', v.status, 'invoice_number', v.invoice_number, 'already', true);
  end if;
  select count(*) into n from public.invoice_items where invoice_id = v.id;
  if n = 0 then raise exception 'Add at least one line before issuing the invoice' using errcode = '22023'; end if;
  if v.total <= 0 then raise exception 'The invoice total must be more than zero' using errcode = '22023'; end if;
  select timezone into tz from public.organisations where id = v.organisation_id;
  select * into fs from public.organisation_financial_settings where organisation_id = v.organisation_id;
  s := app_private.document_snapshot(v.organisation_id, v.customer_id, v.contact_id, v.site_address_id);
  pay := nullif(concat_ws(E'\n',
           case when fs.bank_name is not null then 'Bank: ' || fs.bank_name end,
           case when fs.bank_account_holder is not null then 'Account holder: ' || fs.bank_account_holder end,
           case when fs.bank_account_number is not null then 'Account number: ' || fs.bank_account_number end,
           case when fs.bank_branch_code is not null then 'Branch code: ' || fs.bank_branch_code end,
           case when fs.bank_account_type is not null then 'Account type: ' || fs.bank_account_type end), '');

  perform set_config('app.invoice_transition', 'on', true);
  update public.invoices set
    vat_registered_snapshot = (s ->> 'vat_registered')::boolean,
    tax_rate_snapshot = coalesce((s ->> 'tax_rate')::numeric, 0),
    tax_label_snapshot = s ->> 'tax_label'
  where id = v.id;
  -- Re-read totals after a possible re-price under the frozen tax basis.
  select * into v from public.invoices where id = v.id;
  if v.total <= 0 then raise exception 'The invoice total must be more than zero' using errcode = '22023'; end if;
  num := app_private.next_document_number(v.organisation_id, 'invoice');
  update public.invoices set
    status = 'issued', invoice_number = num, issued_at = now(), issued_by = auth.uid(),
    issue_date = (now() at time zone coalesce(tz, 'Africa/Johannesburg'))::date,
    due_date = greatest(coalesce(due_date, (now() at time zone coalesce(tz, 'Africa/Johannesburg'))::date),
                        (now() at time zone coalesce(tz, 'Africa/Johannesburg'))::date),
    customer_name_snapshot = s ->> 'customer_name', customer_registration_snapshot = s ->> 'customer_registration',
    customer_tax_snapshot = s ->> 'customer_tax', customer_address_snapshot = s ->> 'customer_address',
    site_address_snapshot = s ->> 'site_address', contact_name_snapshot = s ->> 'contact_name',
    contact_email_snapshot = s ->> 'contact_email', contact_phone_snapshot = s ->> 'contact_phone',
    seller_name_snapshot = s ->> 'seller_name', seller_legal_name_snapshot = s ->> 'seller_legal_name',
    seller_registration_snapshot = s ->> 'seller_registration', seller_tax_snapshot = s ->> 'seller_tax',
    seller_address_snapshot = s ->> 'seller_address', seller_email_snapshot = s ->> 'seller_email',
    seller_phone_snapshot = s ->> 'seller_phone', payment_details_snapshot = pay
  where id = v.id;
  perform set_config('app.invoice_transition', 'off', true);
  select * into v from public.invoices where id = v.id;
  return jsonb_build_object('id', v.id, 'status', v.status, 'invoice_number', v.invoice_number, 'total', v.total);
end;
$$;

create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices := app_private.lock_invoice_for(p_invoice_id, 'invoices.issue');
begin
  if v.status = 'void' then return jsonb_build_object('id', v.id, 'status', v.status, 'already', true); end if;
  if v.status not in ('issued', 'partially_paid', 'paid') then
    raise exception 'Only an issued invoice can be voided. Archive a draft instead' using errcode = '22023';
  end if;
  if exists (select 1 from public.payments p where p.invoice_id = v.id and p.voided_at is null) then
    raise exception 'Void the payments on this invoice first' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason for voiding the invoice' using errcode = '22023';
  end if;
  perform set_config('app.invoice_transition', 'on', true);
  update public.invoices set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = left(trim(p_reason), 500)
   where id = v.id;
  perform set_config('app.invoice_transition', 'off', true);
  return jsonb_build_object('id', v.id, 'status', 'void');
end;
$$;

create or replace function public.archive_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices := app_private.lock_invoice_for(p_invoice_id, 'invoices.write');
begin
  if v.status = 'archived' then return jsonb_build_object('id', v.id, 'status', v.status, 'already', true); end if;
  if v.status not in ('draft', 'void', 'paid') then
    raise exception 'Only draft, paid or void invoices can be archived' using errcode = '22023';
  end if;
  perform set_config('app.invoice_transition', 'on', true);
  update public.invoices set status = 'archived', archived_at = now() where id = v.id;
  perform set_config('app.invoice_transition', 'off', true);
  return jsonb_build_object('id', v.id, 'status', 'archived');
end;
$$;

-- -----------------------------------------------------------------------------
-- Payments
-- -----------------------------------------------------------------------------
create or replace function app_private.apply_invoice_payments(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid numeric;
  v      public.invoices;
begin
  select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = p_invoice_id and voided_at is null;
  perform set_config('app.invoice_transition', 'on', true);
  update public.invoices set
    amount_paid = v_paid,
    amount_due = total - v_paid,
    status = case when v_paid >= total then 'paid' when v_paid > 0 then 'partially_paid' else 'issued' end,
    paid_at = case when v_paid >= total then coalesce(paid_at, now()) else null end
  where id = p_invoice_id
  returning * into v;
  perform set_config('app.invoice_transition', 'off', true);
  return v;
end;
$$;

create or replace function public.record_payment(
  p_invoice_id      uuid,
  p_amount          numeric,
  p_payment_date    date default null,
  p_method          text default 'bank_transfer',
  p_reference       text default null,
  p_notes           text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      public.invoices := app_private.lock_invoice_for(p_invoice_id, 'payments.record');
  v_amt  numeric := round(coalesce(p_amount, 0), 2);
  v_pid  uuid;
  tz     text;
begin
  if p_idempotency_key is not null then
    select id into v_pid from public.payments where organisation_id = v.organisation_id and idempotency_key = p_idempotency_key;
    if v_pid is not null then
      return jsonb_build_object('payment_id', v_pid, 'invoice_id', v.id, 'status', v.status, 'amount_due', v.amount_due, 'already', true);
    end if;
  end if;
  if v.status not in ('issued', 'partially_paid') then
    raise exception 'Payments can only be recorded against an issued, unpaid invoice' using errcode = '22023';
  end if;
  if v_amt <= 0 then raise exception 'The payment amount must be more than zero' using errcode = '22023'; end if;
  if v_amt > v.amount_due then
    raise exception 'That is more than the % outstanding on this invoice', v.amount_due using errcode = '22023';
  end if;
  select timezone into tz from public.organisations where id = v.organisation_id;
  insert into public.payments (organisation_id, invoice_id, customer_id, amount, payment_date, payment_method, reference, notes,
                               idempotency_key, recorded_by)
  values (v.organisation_id, v.id, v.customer_id, v_amt,
          coalesce(p_payment_date, (now() at time zone coalesce(tz, 'Africa/Johannesburg'))::date),
          coalesce(p_method, 'bank_transfer'), nullif(trim(coalesce(p_reference, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
          p_idempotency_key, auth.uid())
  returning id into v_pid;
  v := app_private.apply_invoice_payments(v.id);
  perform app_private.log_activity(v.organisation_id, 'payment_recorded', 'invoice', v.id,
    jsonb_build_object('invoice_number', v.invoice_number, 'amount', v_amt, 'method', coalesce(p_method, 'bank_transfer'),
                       'amount_due', v.amount_due, 'payment_id', v_pid, 'customer_id', v.customer_id));
  return jsonb_build_object('payment_id', v_pid, 'invoice_id', v.id, 'status', v.status, 'amount_paid', v.amount_paid, 'amount_due', v.amount_due);
end;
$$;

create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p  public.payments;
  v  public.invoices;
begin
  select * into p from public.payments where id = p_payment_id;
  if p.id is null then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  v := app_private.lock_invoice_for(p.invoice_id, 'payments.record');
  if p.voided_at is not null then return jsonb_build_object('payment_id', p.id, 'already', true); end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason for reversing the payment' using errcode = '22023';
  end if;
  update public.payments set voided_at = now(), voided_by = auth.uid(), void_reason = left(trim(p_reason), 500) where id = p.id;
  v := app_private.apply_invoice_payments(v.id);
  perform app_private.log_activity(v.organisation_id, 'payment_voided', 'invoice', v.id,
    jsonb_build_object('invoice_number', v.invoice_number, 'amount', p.amount, 'payment_id', p.id, 'amount_due', v.amount_due));
  return jsonb_build_object('payment_id', p.id, 'invoice_id', v.id, 'status', v.status, 'amount_due', v.amount_due);
end;
$$;

-- Payments are append-only; only void_payment() (definer) may set the void columns.
create or replace function app_private.payments_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payments cannot be deleted. Reverse the payment instead' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason']) <> (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason'])
     or old.voided_at is not null then
    raise exception 'Payments cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger payments_immutable before update or delete on public.payments
  for each row execute function app_private.payments_immutable();

-- Customer balance (deterministic): outstanding on issued / part-paid invoices.
create or replace function public.customer_balance(p_customer_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'customer_id', p_customer_id,
    'outstanding', coalesce(sum(i.amount_due) filter (where i.status in ('issued', 'partially_paid')), 0),
    'overdue', coalesce(sum(i.amount_due) filter (where i.status in ('issued', 'partially_paid')
                 and i.due_date < (now() at time zone coalesce(o.timezone, 'Africa/Johannesburg'))::date), 0),
    'open_invoices', count(*) filter (where i.status in ('issued', 'partially_paid')),
    'paid_total', coalesce(sum(i.amount_paid) filter (where i.status in ('issued', 'partially_paid', 'paid')), 0),
    'currency', max(i.currency))
  from public.invoices i
  join public.organisations o on o.id = i.organisation_id
  where i.customer_id = p_customer_id
$$;

-- -----------------------------------------------------------------------------
-- Grants + RLS
-- -----------------------------------------------------------------------------
revoke all on public.invoices, public.invoice_items, public.payments from anon, authenticated;
grant select, insert, update on public.invoices to authenticated;                  -- no delete
grant select, insert, update, delete on public.invoice_items to authenticated;     -- draft-only (guard)
grant select on public.payments to authenticated;                                  -- writes via RPC only

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;

create policy invoices_select on public.invoices for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('invoices.read')));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('invoices.write')));
create policy invoices_update on public.invoices for update to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('invoices.write')))
  with check (organisation_id in (select app_private.org_ids_with_permission('invoices.write')));

create policy invoice_items_select on public.invoice_items for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('invoices.read')));
create policy invoice_items_write on public.invoice_items for all to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('invoices.write')))
  with check (organisation_id in (select app_private.org_ids_with_permission('invoices.write')));

create policy payments_select on public.payments for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('payments.read')));

revoke execute on function public.create_invoice_from_job(uuid), public.create_invoice_from_quote(uuid), public.issue_invoice(uuid),
  public.void_invoice(uuid, text), public.archive_invoice(uuid),
  public.record_payment(uuid, numeric, date, text, text, text, text), public.void_payment(uuid, text),
  public.customer_balance(uuid) from public, anon;
grant execute on function public.create_invoice_from_job(uuid), public.create_invoice_from_quote(uuid), public.issue_invoice(uuid),
  public.void_invoice(uuid, text), public.archive_invoice(uuid),
  public.record_payment(uuid, numeric, date, text, text, text, text), public.void_payment(uuid, text),
  public.customer_balance(uuid), public.invoice_effective_status(text, date, numeric, text) to authenticated;
revoke execute on all functions in schema app_private from anon, public;
