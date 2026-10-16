-- Phase 003 hardening (review findings). Additive only: create or replace / alter policy / grants / new constraints.

-- 1. Manual conversations can hold an unsent draft reply (was silently turned into a logged message).
create or replace function app_private.guard_messages()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Clients may only create manual records or drafts. Provider ingestion (future) runs as service_role.
    if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
       and current_user <> 'service_role' then
      new.author_user_id := auth.uid();
      new.provider := null;
      new.external_id := null;
      if new.channel in ('email', 'whatsapp', 'web') and new.direction <> 'outbound' then
        raise exception 'Inbound channel messages can only come from a connected integration' using errcode = '42501';
      end if;
      if new.channel in ('email', 'whatsapp', 'web') then
        new.status := 'draft';
      elsif new.channel = 'manual' then
        -- A manual draft (reply not yet sent) stays a draft; anything else is a logged record.
        new.status := case when new.status = 'draft' then 'draft' else 'logged' end;
      end if;
    end if;
    return new;
  end if;
  -- UPDATE: messages are immutable except a draft's body/status edits by its author.
  if old.status <> 'draft' or old.author_user_id is distinct from auth.uid() then
    raise exception 'Messages cannot be changed' using errcode = '42501';
  end if;
  if new.conversation_id <> old.conversation_id or new.organisation_id <> old.organisation_id
     or new.channel <> old.channel or new.direction <> old.direction or new.status <> 'draft' then
    raise exception 'Only a draft''s text can be edited' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 2. Conversation links to quotes/jobs/invoices must stay inside the organisation.
alter table public.conversations
  add constraint conversations_quote_fk foreign key (quote_id, organisation_id) references public.quotes (id, organisation_id),
  add constraint conversations_job_fk foreign key (job_id, organisation_id) references public.jobs (id, organisation_id),
  add constraint conversations_invoice_fk foreign key (invoice_id, organisation_id) references public.invoices (id, organisation_id);

-- 3. Bank details: only people who work with settings or financial documents can read them (not field agents).
alter policy fin_settings_select on public.organisation_financial_settings
  using (organisation_id in (select app_private.org_ids_with_permission('settings.read'))
      or organisation_id in (select app_private.org_ids_with_permission('quotes.read'))
      or organisation_id in (select app_private.org_ids_with_permission('invoices.read')));

-- 4. Issuing an old draft keeps its payment terms instead of shortening them.
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
    -- Keep the payment terms the draft had (due - issue), counted from the actual issue date.
    due_date = (now() at time zone coalesce(tz, 'Africa/Johannesburg'))::date
               + greatest(coalesce(due_date - issue_date, coalesce(fs.invoice_due_days, 30)), 0),
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

-- 5. An idempotency key belongs to one invoice.
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
    if v_pid is not null and not exists (select 1 from public.payments where id = v_pid and invoice_id = v.id) then
      raise exception 'This payment request was already used for a different invoice' using errcode = '22023';
    end if;
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

-- 6. A job invoiced via its quote cannot be reopened.
create or replace function public.set_job_status(p_job_id uuid, p_action text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j       public.jobs;
  v_perm  boolean;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if j.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  -- Who may act: jobs.write (office) on any job; jobs.work on jobs assigned to me.
  v_perm := app_private.has_permission(j.organisation_id, 'jobs.write')
         or (app_private.has_permission(j.organisation_id, 'jobs.work')
             and (app_private.has_permission(j.organisation_id, 'jobs.read_all') or j.id in (select app_private.my_assigned_job_ids())));
  if not v_perm then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if p_action = 'cancel' and not app_private.has_permission(j.organisation_id, 'jobs.write') then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;

  perform set_config('app.job_transition', 'on', true);
  if p_action = 'start' then
    if j.status = 'in_progress' then return jsonb_build_object('id', j.id, 'status', j.status, 'already', true); end if;
    if j.status not in ('unscheduled', 'scheduled') then
      raise exception 'Only a scheduled or unscheduled job can be started' using errcode = '22023';
    end if;
    update public.jobs set status = 'in_progress', actual_start = now() where id = j.id;
  elsif p_action = 'complete' then
    if j.status = 'completed' then return jsonb_build_object('id', j.id, 'status', j.status, 'already', true); end if;
    if j.status not in ('unscheduled', 'scheduled', 'in_progress') then
      raise exception 'This job cannot be completed' using errcode = '22023';
    end if;
    update public.jobs set status = 'completed', completed_at = now(), completed_by = auth.uid(),
           actual_start = coalesce(actual_start, now()), actual_end = now(),
           completion_notes = coalesce(nullif(trim(p_notes), ''), completion_notes)
     where id = j.id;
  elsif p_action = 'cancel' then
    if j.status = 'cancelled' then return jsonb_build_object('id', j.id, 'status', j.status, 'already', true); end if;
    if j.status = 'completed' then
      raise exception 'A completed job cannot be cancelled' using errcode = '22023';
    end if;
    update public.jobs set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_notes, 500) where id = j.id;
  elsif p_action = 'reopen' then
    if not app_private.has_permission(j.organisation_id, 'jobs.write') then
      raise exception 'You do not have permission to do that' using errcode = '42501';
    end if;
    if j.status <> 'completed' then
      raise exception 'Only a completed job can be reopened' using errcode = '22023';
    end if;
    if exists (select 1 from public.invoices i where i.status <> 'void'
                 and (i.job_id = j.id or (j.quote_id is not null and i.quote_id = j.quote_id))) then
      raise exception 'This job has been invoiced and cannot be reopened' using errcode = '22023';
    end if;
    update public.jobs set status = 'in_progress', completed_at = null, completed_by = null, actual_end = null where id = j.id;
  else
    raise exception 'Invalid job action' using errcode = '22023';
  end if;
  perform set_config('app.job_transition', 'off', true);
  select * into j from public.jobs where id = j.id;
  return jsonb_build_object('id', j.id, 'status', j.status);
end;
$$;

-- 7. Search returns effective statuses (expired quotes, overdue invoices).
create or replace function public.global_search(p_organisation_id uuid, p_query text, p_limit integer default 6)
returns table (entity_type text, id uuid, title text, subtitle text, status text, rank real)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  q      text := trim(coalesce(p_query, ''));
  pat    text;
  digits text;
  lim    integer := least(greatest(coalesce(p_limit, 6), 1), 20);
  tz     text := coalesce((select o.timezone from public.organisations o where o.id = p_organisation_id), 'Africa/Johannesburg');
begin
  if char_length(q) < 2 then
    return;
  end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  digits := regexp_replace(q, '[^0-9]', '', 'g');

  return query
  (select 'customer'::text, c.id, c.display_name, concat_ws(' · ', c.email, c.phone), c.status,
          extensions.similarity(c.display_name, q)
     from public.customers c
    where c.organisation_id = p_organisation_id
      and (c.display_name ilike pat or c.email ilike pat
           or (char_length(digits) >= 4 and c.phone_normalized like '%' || digits || '%'))
    order by 6 desc limit lim)
  union all
  (select 'contact'::text, ct.customer_id, concat_ws(' ', ct.first_name, ct.last_name), concat_ws(' · ', cu.display_name, ct.phone, ct.email), null::text,
          extensions.similarity(concat_ws(' ', ct.first_name, ct.last_name), q)
     from public.customer_contacts ct join public.customers cu on cu.id = ct.customer_id
    where ct.organisation_id = p_organisation_id
      and (concat_ws(' ', ct.first_name, ct.last_name) ilike pat or ct.email ilike pat
           or (char_length(digits) >= 4 and regexp_replace(coalesce(ct.phone, ''), '[^0-9]', '', 'g') like '%' || digits || '%'))
    order by 6 desc limit lim)
  union all
  (select 'lead'::text, l.id, l.title, concat_ws(' · ', coalesce(l.company_name, l.person_name), l.service_summary), l.status,
          greatest(extensions.similarity(l.title, q), extensions.similarity(coalesce(l.company_name, l.person_name, ''), q))
     from public.leads l
    where l.organisation_id = p_organisation_id and l.archived_at is null
      and (l.title ilike pat or l.company_name ilike pat or l.person_name ilike pat or l.email ilike pat
           or (char_length(digits) >= 4 and l.phone_normalized like '%' || digits || '%'))
    order by 6 desc limit lim)
  union all
  (select 'quote'::text, qu.id, qu.quote_number, concat_ws(' · ', coalesce(qu.customer_name_snapshot, c.display_name), qu.title),
          case when qu.status in ('sent', 'viewed') and qu.expiry_date < (now() at time zone tz)::date then 'expired' else qu.status end,
          case when qu.quote_number ilike q then 1 else extensions.similarity(c.display_name, q) end
     from public.quotes qu join public.customers c on c.id = qu.customer_id
    where qu.organisation_id = p_organisation_id
      and (qu.quote_number ilike pat or c.display_name ilike pat or qu.title ilike pat)
    order by 6 desc limit lim)
  union all
  (select 'job'::text, j.id, j.job_number || ' · ' || j.title, c.display_name, j.status,
          case when j.job_number ilike q then 1 else greatest(extensions.similarity(j.title, q), coalesce(extensions.similarity(c.display_name, q), 0)) end
     from public.jobs j left join public.customers c on c.id = j.customer_id   -- field agents can't read customers
    where j.organisation_id = p_organisation_id
      and (j.job_number ilike pat or j.title ilike pat or c.display_name ilike pat)
    order by 6 desc limit lim)
  union all
  (select 'invoice'::text, i.id, coalesce(i.invoice_number, 'Draft invoice'), concat_ws(' · ', coalesce(i.customer_name_snapshot, c.display_name), i.title),
          public.invoice_effective_status(i.status, i.due_date, i.amount_due, tz),
          case when i.invoice_number ilike q then 1 else extensions.similarity(c.display_name, q) end
     from public.invoices i join public.customers c on c.id = i.customer_id
    where i.organisation_id = p_organisation_id
      and (i.invoice_number ilike pat or c.display_name ilike pat or i.title ilike pat)
    order by 6 desc limit lim);
end;
$$;

-- 8. Job internal notes are office-only: field agents read jobs rows but never internal_notes.
--    create_invoice_from_job runs as the caller, so it reads explicit columns.
create or replace function public.create_invoice_from_job(p_job_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  j      record;  -- explicit columns: invoker cannot read jobs.internal_notes
  q      public.quotes;
  v_inv  uuid;
begin
  -- No row lock: invoicing roles may not have job update rights. Double submits are
  -- stopped by the unique index (one non-void invoice per job), handled below.
  select id, organisation_id, customer_id, contact_id, site_address_id, quote_id, title, job_number, status
    into j from public.jobs where id = p_job_id;
  if not found or j.id is null then raise exception 'Job not found' using errcode = 'P0002'; end if;
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

-- (column grants): field agents read jobs rows but never internal_notes.
revoke select on public.jobs from authenticated;
grant select (actual_end, actual_start, archived_at, cancel_reason, cancelled_at, completed_at, completed_by, completion_notes, contact_id, created_at, created_by, customer_id, description, id, job_number, lead_id, organisation_id, priority, quote_id, scheduled_end, scheduled_start, site_address_id, status, title, updated_at) on public.jobs to authenticated;

create or replace function public.get_job_internal_notes(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select j.internal_notes from public.jobs j
   where j.id = p_job_id and app_private.has_permission(j.organisation_id, 'jobs.read_all')
$$;
revoke execute on function public.get_job_internal_notes(uuid) from public, anon;
grant execute on function public.get_job_internal_notes(uuid) to authenticated;
revoke execute on all functions in schema app_private from anon, public;
