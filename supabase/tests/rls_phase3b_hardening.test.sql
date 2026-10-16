-- =============================================================================
-- Phase 003 hardening (migration 20261016000800). Runs after rls_phase3.test.sql
-- in the same database and reuses its data (organisation "Boland Pest").
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

select set_config('t.org', (select id::text from public.organisations where name = 'Boland Pest'), false);
select set_config('t.job', (select id::text from public.jobs where organisation_id = current_setting('t.org')::uuid and status not in ('completed', 'cancelled') order by created_at limit 1), false);

-- Job internal notes are office-only
select tests.login('e3000000-0000-0000-0000-000000000001');
update public.jobs set internal_notes = 'Customer pays late; insist on deposit' where id = current_setting('t.job')::uuid;
select tests.ok(public.get_job_internal_notes(current_setting('t.job')::uuid) like 'Customer pays late%', 'owner reads job internal notes via RPC');
select tests.throws($$select internal_notes from public.jobs$$, 'internal_notes column is not selectable through the API');
select tests.ok((select count(*) from public.jobs where id = current_setting('t.job')::uuid) = 1, 'other job columns stay readable');
select tests.login('e3000000-0000-0000-0000-000000000004');
select tests.ok(public.get_job_internal_notes(current_setting('t.job')::uuid) is null, 'field agent gets no internal notes');
select tests.throws($$select internal_notes from public.jobs$$, 'field agent cannot select internal notes');

-- Bank details are not visible to field agents
select tests.ok((select count(*) from public.organisation_financial_settings where organisation_id = current_setting('t.org')::uuid) = 0,
                'field agent cannot read financial settings / bank details');
select tests.login('e3000000-0000-0000-0000-000000000002');
select tests.ok((select count(*) from public.organisation_financial_settings where organisation_id = current_setting('t.org')::uuid) = 1,
                'accountant can read financial settings');

-- Manual conversations can hold a draft reply
select tests.login('e3000000-0000-0000-0000-000000000001');
select set_config('t.conv', (public.log_communication(current_setting('t.org')::uuid, 'Called Anna about the quote', 'call', 'outbound') ->> 'conversation_id'), false);
insert into public.messages (organisation_id, conversation_id, channel, direction, status, body)
values (current_setting('t.org')::uuid, current_setting('t.conv')::uuid, 'manual', 'outbound', 'draft', 'Hi Anna, following up on your quote');
select tests.ok((select status from public.messages where conversation_id = current_setting('t.conv')::uuid and body like 'Hi Anna%') = 'draft',
                'manual draft stays a draft');
select tests.ok((select last_message_preview from public.conversations where id = current_setting('t.conv')::uuid) not like 'Hi Anna%',
                'a draft does not change the conversation preview');
insert into public.messages (organisation_id, conversation_id, channel, direction, status, body)
values (current_setting('t.org')::uuid, current_setting('t.conv')::uuid, 'manual', 'outbound', 'sent', 'Sent from my phone');
select tests.ok((select status from public.messages where body = 'Sent from my phone') = 'logged', 'a manual non-draft is still only "logged", never "sent"');

-- Conversation links stay in the organisation
select tests.throws($$update public.conversations set quote_id = gen_random_uuid() where id = current_setting('t.conv')::uuid$$,
                    'conversation cannot link to a quote outside the organisation');

-- Idempotency keys are tied to one invoice
select set_config('t.paid_inv', (select invoice_id::text from public.payments where idempotency_key = 'idem-key-0001'), false);
insert into public.invoices (organisation_id, customer_id, title)
  select current_setting('t.org')::uuid, customer_id, 'Idempotency invoice' from public.invoices where id = current_setting('t.paid_inv')::uuid;
insert into public.invoice_items (organisation_id, invoice_id, description, unit_price)
  select current_setting('t.org')::uuid, id, 'Service', 200 from public.invoices where title = 'Idempotency invoice';
select public.issue_invoice((select id from public.invoices where title = 'Idempotency invoice'));
select tests.throws($$select public.record_payment((select id from public.invoices where title = 'Idempotency invoice'), 50, null, 'cash', null, null, 'idem-key-0001')$$,
                    'reusing an idempotency key on another invoice is rejected');

-- Issuing an old draft keeps its payment terms
insert into public.invoices (organisation_id, customer_id, title, issue_date, due_date)
  select current_setting('t.org')::uuid, customer_id, 'Old draft', current_date - 20, current_date + 10 from public.invoices where id = current_setting('t.paid_inv')::uuid;
insert into public.invoice_items (organisation_id, invoice_id, description, unit_price)
  select current_setting('t.org')::uuid, id, 'Service', 300 from public.invoices where title = 'Old draft';
select public.issue_invoice((select id from public.invoices where title = 'Old draft'));
select tests.ok((select due_date - issue_date from public.invoices where title = 'Old draft') = 30, 'issued old draft keeps its 30-day terms');

-- Search shows effective statuses
update public.organisation_financial_settings set invoice_due_days = 30 where organisation_id = current_setting('t.org')::uuid;
select tests.ok(not exists (
  select 1 from public.global_search(current_setting('t.org')::uuid, 'INV-', 20) s join public.invoices i on i.id = s.id
   where s.status <> public.invoice_effective_status(i.status, i.due_date, i.amount_due)), 'search invoice statuses are effective statuses');

select format('%s assertions passed (cumulative)', count(*)) as summary from tests.results;
