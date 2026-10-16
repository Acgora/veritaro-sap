-- =============================================================================
-- Phase 003 tests: leads, communications, quotes (maths, VAT, snapshots, states,
-- numbering), jobs (assignment, field scope, lifecycle), invoices + payments
-- (maths, numbering at issue, partial/full/over-payment, idempotency, void),
-- follow-ups / Today, global search, storage policies, activity, tenancy.
-- Runs after earlier suites in the same database (reuses tests.* helpers).
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

select tests.logout();
insert into auth.users (id, email, raw_user_meta_data) values
  ('e3000000-0000-0000-0000-000000000001', 'p3.owner@test.local',  '{"first_name":"Olu"}'),
  ('e3000000-0000-0000-0000-000000000002', 'p3.acct@test.local',   '{"first_name":"Ann"}'),
  ('e3000000-0000-0000-0000-000000000003', 'p3.sup@test.local',    '{"first_name":"Sam"}'),
  ('e3000000-0000-0000-0000-000000000004', 'p3.field@test.local',  '{"first_name":"Peter"}'),
  ('e3000000-0000-0000-0000-000000000005', 'p3.field2@test.local', '{"first_name":"Fran"}'),
  ('e3000000-0000-0000-0000-000000000006', 'p3.viewer@test.local', '{"first_name":"Vic"}'),
  ('e3000000-0000-0000-0000-000000000007', 'p3.other@test.local',  '{"first_name":"Xan"}');

select tests.login('e3000000-0000-0000-0000-000000000001');
select set_config('t.org', public.create_organisation('Boland Pest')::text, false);
insert into public.organisation_members (organisation_id, user_id, role) values
  (current_setting('t.org')::uuid, 'e3000000-0000-0000-0000-000000000002', 'accountant'),
  (current_setting('t.org')::uuid, 'e3000000-0000-0000-0000-000000000003', 'supervisor'),
  (current_setting('t.org')::uuid, 'e3000000-0000-0000-0000-000000000004', 'field_agent'),
  (current_setting('t.org')::uuid, 'e3000000-0000-0000-0000-000000000005', 'field_agent'),
  (current_setting('t.org')::uuid, 'e3000000-0000-0000-0000-000000000006', 'viewer');
select tests.login('e3000000-0000-0000-0000-000000000007');
select set_config('t.other', public.create_organisation('Other Pest Co')::text, false);

-- ---------------------------------------------------------------------------
-- Foundation
-- ---------------------------------------------------------------------------
select tests.login('e3000000-0000-0000-0000-000000000001');
select tests.ok((select count(*) from public.organisation_financial_settings where organisation_id = current_setting('t.org')::uuid) = 1,
                'new organisation gets financial settings automatically');
select tests.ok((select count(*) from public.document_sequences where organisation_id = current_setting('t.org')::uuid) = 3,
                'new organisation gets quote/job/invoice sequences');
update public.organisations set address_line1 = '1 Dorp St', city = 'Stellenbosch', postal_code = '7600', email = 'hi@boland.test',
  phone = '021 555 0000', vat_number = '4123456789' where id = current_setting('t.org')::uuid;
update public.organisation_financial_settings set vat_registered = true, tax_rate = 15, bank_name = 'FNB', bank_account_number = '62000000000'
 where organisation_id = current_setting('t.org')::uuid;
select tests.login('e3000000-0000-0000-0000-000000000003');
select tests.ok(tests.affected($$update public.organisation_financial_settings set tax_rate = 0 where organisation_id = current_setting('t.org')::uuid$$) = 0,
                'supervisor cannot change tax settings');
select tests.login('e3000000-0000-0000-0000-000000000007');
select tests.ok((select count(*) from public.organisation_financial_settings where organisation_id = current_setting('t.org')::uuid) = 0,
                'other org cannot read financial settings');

-- Money engine (pure)
select tests.ok((select row(gross, discount, tax, excl, total)::text from app_private.line_amounts(2, 625, null, null, true, 15, true, false))
                = '(1250.00,0,187.50,1250.00,1437.50)', 'excl VAT: 2 × 625 = 1250 + 187.50 VAT');
select tests.ok((select row(gross, discount, tax, excl, total)::text from app_private.line_amounts(1, 1150, null, null, true, 15, true, true))
                = '(1150.00,0,150.00,1000.00,1150.00)', 'incl VAT: 1150 includes 150 VAT');
select tests.ok((select row(gross, discount, tax, excl, total)::text from app_private.line_amounts(3, 33.33, 'percent', 10, true, 15, true, false))
                = '(99.99,10.00,13.50,89.99,103.49)', 'percent discount, per-line rounding');
select tests.ok((select row(gross, discount, tax, excl, total)::text from app_private.line_amounts(1, 100, 'amount', 250, true, 15, true, false))
                = '(100.00,100.00,0.00,0.00,0.00)', 'fixed discount is capped at the line amount');
select tests.ok((select tax from app_private.line_amounts(1, 1000, null, null, true, 15, false, false)) = 0, 'non-VAT business charges no VAT');
select tests.ok((select tax from app_private.line_amounts(1, 1000, null, null, false, 15, true, false)) = 0, 'non-taxable line has no VAT');

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
select tests.login('e3000000-0000-0000-0000-000000000003');  -- supervisor
insert into public.leads (organisation_id, title, person_name, company_name, email, phone, source, service_summary, site_address_text, assigned_to)
values (current_setting('t.org')::uuid, 'Pest control for offices', 'Johan Ossewa', 'DJ Ossewa', 'johan@ossewa.test', '082 111 2222',
        'phone', 'Quarterly pest control', '24 Main Rd, Strand', 'e3000000-0000-0000-0000-000000000003');
select set_config('t.lead', (select id::text from public.leads where title = 'Pest control for offices'), false);
select tests.ok((select status = 'new' and created_by = 'e3000000-0000-0000-0000-000000000003'::uuid from public.leads where id = current_setting('t.lead')::uuid),
                'lead created as new, attributed to creator');
select tests.throws($$insert into public.leads (organisation_id, title, assigned_to) values (current_setting('t.org')::uuid, 'x', 'e3000000-0000-0000-0000-000000000007')$$,
                    'lead cannot be assigned to a non-member');
select tests.throws($$update public.leads set organisation_id = current_setting('t.other')::uuid where id = current_setting('t.lead')::uuid$$,
                    'lead cannot move organisation');
update public.leads set status = 'lost', lost_reason = 'price' where id = current_setting('t.lead')::uuid;
select tests.ok((select lost_at is not null and won_at is null from public.leads where id = current_setting('t.lead')::uuid), 'lost sets lost_at');
update public.leads set status = 'qualified' where id = current_setting('t.lead')::uuid;
select tests.ok((select lost_at is null and lost_reason is null from public.leads where id = current_setting('t.lead')::uuid), 'reopening clears lost fields');
select tests.ok((select count(*) from public.activity_log where entity_id = current_setting('t.lead')::uuid and action = 'lead_status_changed') = 2,
                'lead status changes are logged');

select tests.login('e3000000-0000-0000-0000-000000000004');  -- field agent
select tests.ok((select count(*) from public.leads) = 0, 'field agent cannot see leads');
select tests.login('e3000000-0000-0000-0000-000000000006');  -- viewer
select tests.ok((select count(*) from public.leads) = 1, 'viewer can read leads');
select tests.ok(tests.affected($$update public.leads set title = 'x'$$) = 0, 'viewer cannot edit leads');
select tests.login('e3000000-0000-0000-0000-000000000007');
select tests.ok((select count(*) from public.leads) = 0, 'other org cannot see leads');

-- Communications
select tests.login('e3000000-0000-0000-0000-000000000003');
select set_config('t.conv', (public.log_communication(current_setting('t.org')::uuid, 'Called Johan. Wants quote tomorrow.', 'call', 'outbound',
                  null, current_setting('t.lead')::uuid) ->> 'conversation_id'), false);
select tests.ok((select count(*) from public.messages where conversation_id = current_setting('t.conv')::uuid and status = 'logged' and channel = 'manual') = 1,
                'manual communication is logged on the lead conversation');
select tests.ok((select (public.log_communication(current_setting('t.org')::uuid, 'Second note', 'note', 'internal', null, current_setting('t.lead')::uuid) ->> 'conversation_id'))
                = current_setting('t.conv'), 'further notes join the same conversation');
select tests.ok((select count(*) from public.activity_log where action = 'communication_logged' and entity_id = current_setting('t.conv')::uuid) = 2,
                'communication_logged activity recorded');
select tests.throws($$insert into public.messages (organisation_id, conversation_id, channel, direction, body)
                      values (current_setting('t.org')::uuid, current_setting('t.conv')::uuid, 'whatsapp', 'inbound', 'fake inbound')$$,
                    'clients cannot fake inbound WhatsApp/email messages');
insert into public.messages (organisation_id, conversation_id, channel, direction, status, body)
values (current_setting('t.org')::uuid, current_setting('t.conv')::uuid, 'email', 'outbound', 'sent', 'Hi Johan');
select tests.ok((select status from public.messages where body = 'Hi Johan') = 'draft',
                'outbound email without a provider is stored as a draft, never "sent"');
select tests.ok((select count(*) from public.messages where body = 'Hi Johan') = 1, 'author sees own draft');
select tests.login('e3000000-0000-0000-0000-000000000006');
select tests.ok((select count(*) from public.messages where body = 'Hi Johan') = 0, 'other users do not see someone else''s draft');
select tests.ok((select count(*) from public.messages where conversation_id = current_setting('t.conv')::uuid) = 2, 'viewer reads logged messages');
select tests.throws($$select public.log_communication(current_setting('t.org')::uuid, 'x')$$, 'viewer cannot log communications');
select tests.login('e3000000-0000-0000-0000-000000000007');
select tests.ok((select count(*) from public.conversations) = 0 and (select count(*) from public.messages) = 0, 'other org cannot see conversations');
select tests.login('e3000000-0000-0000-0000-000000000004');
select tests.ok((select count(*) from public.messages) = 0, 'field agent cannot see communications');

-- Lead conversion
select tests.login('e3000000-0000-0000-0000-000000000003');
select public.create_customer(current_setting('t.org')::uuid, '{"display_name":"DJ Ossewa Holdings","email":"accounts@ossewa.test","phone":"0821112222"}');
select tests.ok((public.convert_lead_to_customer(current_setting('t.lead')::uuid) -> 'possible_duplicates') is not null,
                'conversion warns about a likely duplicate customer (same phone)');
select tests.ok((select customer_id is null from public.leads where id = current_setting('t.lead')::uuid), 'nothing created while duplicates are unresolved');
select set_config('t.cust', (public.convert_lead_to_customer(current_setting('t.lead')::uuid, null, true) ->> 'customer_id'), false);
select tests.ok((select customer_id = current_setting('t.cust')::uuid and contact_id is not null and site_address_id is not null
                   from public.leads where id = current_setting('t.lead')::uuid), 'conversion creates customer + contact + site and links the lead');
select tests.ok((select display_name from public.customers where id = current_setting('t.cust')::uuid) = 'DJ Ossewa', 'customer named from lead company');
select tests.ok((public.convert_lead_to_customer(current_setting('t.lead')::uuid) ->> 'already_linked') = 'true', 'conversion is idempotent');
select tests.ok((select count(*) from public.leads where id = current_setting('t.lead')::uuid) = 1, 'lead is preserved after conversion');
select tests.ok((select count(*) from public.activity_log where entity_id = current_setting('t.lead')::uuid and action = 'lead_converted') = 1, 'lead_converted logged');
insert into public.leads (organisation_id, title, person_name, email) values (current_setting('t.org')::uuid, 'Link me', 'Mary Ossewa', 'mary@ossewa.test');
select tests.ok((public.convert_lead_to_customer((select id from public.leads where title = 'Link me'), current_setting('t.cust')::uuid) ->> 'customer_id')
                = current_setting('t.cust'), 'lead can be linked to an existing customer');
select tests.ok((select count(*) from public.customer_contacts where customer_id = current_setting('t.cust')::uuid) = 2, 'linking adds the lead person as a contact');
select set_config('t.contact', (select contact_id::text from public.leads where id = current_setting('t.lead')::uuid), false);
select set_config('t.site', (select site_address_id::text from public.leads where id = current_setting('t.lead')::uuid), false);

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------
insert into public.quotes (organisation_id, customer_id, contact_id, site_address_id, lead_id, title, prices_include_tax)
values (current_setting('t.org')::uuid, current_setting('t.cust')::uuid, current_setting('t.contact')::uuid, current_setting('t.site')::uuid,
        current_setting('t.lead')::uuid, 'Pest control', false);
select set_config('t.q', (select id::text from public.quotes where title = 'Pest control'), false);
select tests.ok((select quote_number from public.quotes where id = current_setting('t.q')::uuid) = 'Q-0001', 'first quote is Q-0001');
select tests.ok((select status = 'draft' and vat_registered_snapshot and tax_rate_snapshot = 15 and expiry_date = issue_date + 30
                   from public.quotes where id = current_setting('t.q')::uuid), 'draft takes tax basis and validity from settings');
insert into public.quote_items (organisation_id, quote_id, description, quantity, unit, unit_price, sort_order) values
  (current_setting('t.org')::uuid, current_setting('t.q')::uuid, 'Pest control treatment', 1, 'job', 1250, 1),
  (current_setting('t.org')::uuid, current_setting('t.q')::uuid, 'Call-out fee', 1, null, 650, 2);
select tests.ok((select row(subtotal, discount_total, tax_total, total)::text from public.quotes where id = current_setting('t.q')::uuid)
                = '(1900.00,0.00,285.00,2185.00)', 'quote totals: 1250 + 650 = 1900, VAT 285, total 2185');
select tests.throws($$update public.quotes set total = 1 where id = current_setting('t.q')::uuid$$, 'totals cannot be set by the client');
select tests.throws($$update public.quotes set status = 'accepted' where id = current_setting('t.q')::uuid$$, 'status only changes through quote actions');
update public.quotes set prices_include_tax = true where id = current_setting('t.q')::uuid;
select tests.ok((select row(subtotal, tax_total, total)::text from public.quotes where id = current_setting('t.q')::uuid)
                = '(1652.18,247.82,1900.00)', 'switching to VAT-inclusive re-prices all lines (per-line VAT rounding)');
update public.quotes set prices_include_tax = false where id = current_setting('t.q')::uuid;
update public.quote_items set discount_type = 'percent', discount_value = 10 where description = 'Call-out fee';
select tests.ok((select row(subtotal, discount_total, tax_total, total)::text from public.quotes where id = current_setting('t.q')::uuid)
                = '(1835.00,65.00,275.25,2110.25)', 'line discount flows into totals');
update public.quote_items set discount_type = null, discount_value = null where description = 'Call-out fee';
select tests.throws($$select public.issue_quote(gen_random_uuid())$$, 'issuing an unknown quote fails');
select tests.throws($$select public.set_quote_outcome(current_setting('t.q')::uuid, 'accepted')$$, 'a draft cannot be accepted');

-- Numbering under contention: 25 quotes in one transaction stay unique and gapless
do $$
begin
  for i in 1..25 loop
    insert into public.quotes (organisation_id, customer_id, title) values (current_setting('t.org')::uuid, current_setting('t.cust')::uuid, 'bulk ' || i);
  end loop;
end $$;
select tests.ok((select count(distinct quote_number) = 26 and max(quote_number) = 'Q-0026' from public.quotes where organisation_id = current_setting('t.org')::uuid),
                'quote numbers are unique and sequential');
select tests.login('e3000000-0000-0000-0000-000000000007');
insert into public.customers (organisation_id, display_name) values (current_setting('t.other')::uuid, 'Other Customer');
insert into public.quotes (organisation_id, customer_id, title) values (current_setting('t.other')::uuid, (select id from public.customers limit 1), 'other q');
select tests.ok((select quote_number from public.quotes where title = 'other q') = 'Q-0001', 'numbering is per organisation');
select tests.ok((select count(*) from public.quotes) = 1, 'other org sees only its own quotes');
select tests.throws($$insert into public.quotes (organisation_id, customer_id, title) values (current_setting('t.org')::uuid, current_setting('t.cust')::uuid, 'cross')$$,
                    'cannot create a quote in another organisation');
select tests.throws($$select public.issue_quote(current_setting('t.q')::uuid)$$, 'other org cannot issue our quote');

-- Issue: snapshots + freeze
select tests.login('e3000000-0000-0000-0000-000000000003');
select tests.ok((public.issue_quote(current_setting('t.q')::uuid, 'download') ->> 'status') = 'sent', 'supervisor issues the quote');
select tests.ok((select customer_name_snapshot = 'DJ Ossewa' and contact_name_snapshot = 'Johan Ossewa' and seller_name_snapshot = 'Boland Pest'
                        and seller_tax_snapshot = '4123456789' and site_address_snapshot like '24 Main Rd%' and seller_address_snapshot like '1 Dorp St%'
                   from public.quotes where id = current_setting('t.q')::uuid), 'issue snapshots customer, contact, site and seller');
select tests.ok((public.issue_quote(current_setting('t.q')::uuid) ->> 'already') = 'true', 'issuing twice is a no-op (idempotent)');
select tests.ok((select status from public.leads where id = current_setting('t.lead')::uuid) = 'quote_sent', 'issuing moves the lead to quote_sent');
select tests.throws($$update public.quotes set notes = 'sneaky' where id = current_setting('t.q')::uuid$$, 'issued quote cannot be edited');
select tests.throws($$update public.quote_items set unit_price = 1 where quote_id = current_setting('t.q')::uuid$$, 'issued quote lines cannot be edited');
select tests.throws($$delete from public.quote_items where quote_id = current_setting('t.q')::uuid$$, 'issued quote lines cannot be deleted');
select tests.throws($$insert into public.quote_items (organisation_id, quote_id, description, unit_price) values (current_setting('t.org')::uuid, current_setting('t.q')::uuid, 'x', 1)$$,
                    'no lines can be added to an issued quote');
update public.customers set display_name = 'Renamed Customer' where id = current_setting('t.cust')::uuid;
select tests.ok((select customer_name_snapshot from public.quotes where id = current_setting('t.q')::uuid) = 'DJ Ossewa', 'later customer changes do not alter the issued quote');
update public.customers set display_name = 'DJ Ossewa' where id = current_setting('t.cust')::uuid;
select tests.login('e3000000-0000-0000-0000-000000000001');
update public.organisation_financial_settings set tax_rate = 16 where organisation_id = current_setting('t.org')::uuid;
select tests.ok((select tax_rate_snapshot = 15 and total = 2185 from public.quotes where id = current_setting('t.q')::uuid), 'tax rate change does not alter the issued quote');
update public.organisation_financial_settings set tax_rate = 15 where organisation_id = current_setting('t.org')::uuid;

select tests.login('e3000000-0000-0000-0000-000000000006');
select tests.throws($$select public.set_quote_outcome(current_setting('t.q')::uuid, 'accepted', 'verbal')$$, 'viewer cannot accept a quote');
select tests.login('e3000000-0000-0000-0000-000000000003');
select tests.ok((public.set_quote_outcome(current_setting('t.q')::uuid, 'accepted', 'verbal') ->> 'status') = 'accepted', 'quote accepted');
select tests.ok((select accepted_by = 'e3000000-0000-0000-0000-000000000003'::uuid and accepted_method = 'verbal' and accepted_at is not null
                   from public.quotes where id = current_setting('t.q')::uuid), 'acceptance records who, when and how');
select tests.ok((select status from public.leads where id = current_setting('t.lead')::uuid) = 'won', 'accepting the quote wins the lead');
select tests.throws($$select public.set_quote_outcome(current_setting('t.q')::uuid, 'declined')$$, 'an accepted quote cannot be declined');
select set_config('t.q2', public.duplicate_quote(current_setting('t.q')::uuid)::text, false);
select tests.ok((select status = 'draft' and revision_of_id = current_setting('t.q')::uuid and total = 2185 from public.quotes where id = current_setting('t.q2')::uuid),
                'duplicate creates a draft revision with the same lines');
select tests.ok((select count(*) from public.activity_log where entity_id = current_setting('t.q')::uuid and action in ('quote_created', 'quote_issued', 'quote_accepted')) = 3,
                'quote lifecycle is logged');
-- Expiry is derived
select tests.ok(public.quote_effective_status('sent', current_date - 1) = 'expired' and public.quote_effective_status('sent', current_date + 1) = 'sent'
                and public.quote_effective_status('accepted', current_date - 1) = 'accepted', 'expired is derived from expiry date');
-- Declines
insert into public.quote_items (organisation_id, quote_id, description, unit_price)
  select current_setting('t.org')::uuid, id, 'thing', 100 from public.quotes where title = 'bulk 1';
select public.issue_quote((select id from public.quotes where title = 'bulk 1'));
select tests.ok((public.set_quote_outcome((select id from public.quotes where title = 'bulk 1'), 'declined', null, 'Too expensive') ->> 'status') = 'declined',
                'quote declined with reason');
select tests.throws($$select public.issue_quote((select id from public.quotes where title = 'bulk 2'))$$, 'a quote without lines cannot be issued');
-- Accountant has quotes access; field agent does not
select tests.login('e3000000-0000-0000-0000-000000000004');
select tests.ok((select count(*) from public.quotes) = 0 and (select count(*) from public.quote_items) = 0, 'field agent cannot see quotes');

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
select tests.login('e3000000-0000-0000-0000-000000000003');
select set_config('t.job', (public.create_job_from_quote(current_setting('t.q')::uuid, now() + interval '1 day', null) ->> 'job_id'), false);
select tests.ok((select job_number = 'J-0001' and status = 'scheduled' and customer_id = current_setting('t.cust')::uuid
                        and site_address_id = current_setting('t.site')::uuid and contact_id = current_setting('t.contact')::uuid
                        and description like '%Pest control treatment%' and quote_id = current_setting('t.q')::uuid
                   from public.jobs where id = current_setting('t.job')::uuid), 'accepted quote becomes a scheduled job with customer, site, contact and scope');
select tests.ok((public.create_job_from_quote(current_setting('t.q')::uuid) ->> 'created') = 'false', 'create job from quote is idempotent');
select tests.throws($$select public.create_job_from_quote((select id from public.quotes where title = 'bulk 3'))$$, 'a draft quote cannot become a job');
select tests.throws($$insert into public.jobs (organisation_id, customer_id, title, quote_id) values (current_setting('t.org')::uuid, current_setting('t.cust')::uuid, 'dup', current_setting('t.q')::uuid)$$,
                    'only one active job per quote');
insert into public.jobs (organisation_id, customer_id, title) values (current_setting('t.org')::uuid, current_setting('t.cust')::uuid, 'Adhoc fix');
select tests.ok((select job_number = 'J-0002' and status = 'unscheduled' from public.jobs where title = 'Adhoc fix'), 'manual job is J-0002, unscheduled');
update public.jobs set scheduled_start = now() + interval '1 day 1 hour', scheduled_end = now() + interval '1 day 3 hours' where title = 'Adhoc fix';
select tests.ok((select status from public.jobs where title = 'Adhoc fix') = 'scheduled', 'scheduling sets status');
select tests.throws($$update public.jobs set status = 'completed' where title = 'Adhoc fix'$$, 'completion only through job actions');
insert into public.job_assignments (organisation_id, job_id, user_id) values
  (current_setting('t.org')::uuid, current_setting('t.job')::uuid, 'e3000000-0000-0000-0000-000000000004'),
  (current_setting('t.org')::uuid, (select id from public.jobs where title = 'Adhoc fix'), 'e3000000-0000-0000-0000-000000000004');
select tests.throws($$insert into public.job_assignments (organisation_id, job_id, user_id) values (current_setting('t.org')::uuid, current_setting('t.job')::uuid, 'e3000000-0000-0000-0000-000000000007')$$,
                    'cannot assign a non-member');
select tests.ok((select count(*) from public.find_schedule_conflicts(current_setting('t.org')::uuid, now() + interval '1 day', now() + interval '1 day 2 hours',
                   array['e3000000-0000-0000-0000-000000000004'::uuid], current_setting('t.job')::uuid)) = 1,
                'overlapping job for the same worker is reported as a conflict');
select tests.ok((select count(*) from public.find_schedule_conflicts(current_setting('t.org')::uuid, now() + interval '3 days', now() + interval '3 days 2 hours',
                   array['e3000000-0000-0000-0000-000000000004'::uuid], null)) = 0, 'no conflict when times do not overlap');
select tests.ok((select count(*) from public.notifications where user_id = 'e3000000-0000-0000-0000-000000000004'::uuid and type = 'job.assigned') = 0,
                'assignee notification not visible to others (RLS)');

-- Field agent scope
select tests.login('e3000000-0000-0000-0000-000000000004');
select tests.ok((select count(*) from public.jobs) = 2, 'field agent sees their assigned jobs');
select tests.ok((select count(*) from public.customers) = 0 and (select count(*) from public.customer_addresses) = 0
                and (select count(*) from public.customer_contacts) = 0, 'field agent cannot read customer tables');
select tests.ok((select count(*) from public.invoices) = 0 and (select count(*) from public.payments) = 0 and (select count(*) from public.quotes) = 0,
                'field agent cannot see quotes, invoices or payments');
select tests.ok((public.get_field_job(current_setting('t.job')::uuid) ->> 'customer_name') = 'DJ Ossewa'
                and (public.get_field_job(current_setting('t.job')::uuid) ->> 'site_address') like '24 Main Rd%'
                and (public.get_field_job(current_setting('t.job')::uuid) ->> 'contact_phone') is not null,
                'field job view gives name, site and contact phone');
select tests.ok(not (public.get_field_job(current_setting('t.job')::uuid) ? 'total') and not (public.get_field_job(current_setting('t.job')::uuid) ? 'quote_id'),
                'field job view exposes no commercial data');
select tests.ok((select count(*) from public.notifications where type = 'job.assigned') = 2, 'assignee was notified');
select tests.ok((select count(*) from public.list_my_jobs(current_setting('t.org')::uuid)) = 2, 'list_my_jobs returns assigned jobs');
select tests.ok(tests.affected($$update public.jobs set title = 'hacked'$$) = 0, 'field agent cannot edit job details');
select tests.ok((public.set_job_status(current_setting('t.job')::uuid, 'start') ->> 'status') = 'in_progress', 'field agent starts assigned job');
insert into public.job_notes (organisation_id, job_id, body) values (current_setting('t.org')::uuid, current_setting('t.job')::uuid, 'Treated kitchen and storeroom');
select tests.ok((select author_id from public.job_notes where job_id = current_setting('t.job')::uuid) = 'e3000000-0000-0000-0000-000000000004'::uuid,
                'field agent adds a note (attributed)');
insert into storage.objects (bucket_id, name) values ('job-photos', current_setting('t.org') || '/jobs/' || current_setting('t.job') || '/p1.jpg');
insert into public.job_photos (organisation_id, job_id, storage_path, caption, category, byte_size)
values (current_setting('t.org')::uuid, current_setting('t.job')::uuid, current_setting('t.org') || '/jobs/' || current_setting('t.job') || '/p1.jpg', 'Bait stations', 'after', 120000);
select tests.ok((select count(*) from public.job_photos where job_id = current_setting('t.job')::uuid) = 1, 'field agent uploads a job photo');
select tests.throws($$insert into storage.objects (bucket_id, name) values ('job-photos', current_setting('t.org') || '/jobs/' || gen_random_uuid() || '/x.jpg')$$,
                    'cannot upload a photo for a job not assigned to me');
select tests.throws($$insert into storage.objects (bucket_id, name) values ('documents', current_setting('t.org') || '/invoices/' || gen_random_uuid() || '/x.pdf')$$,
                    'field agent cannot write financial documents');
select tests.ok((public.set_job_status(current_setting('t.job')::uuid, 'complete', 'All done') ->> 'status') = 'completed', 'field agent completes the job');
select tests.ok((select completed_by = 'e3000000-0000-0000-0000-000000000004'::uuid and completion_notes = 'All done' and actual_end is not null
                   from public.jobs where id = current_setting('t.job')::uuid), 'completion records who and notes');
select tests.throws($$select public.set_job_status(current_setting('t.job')::uuid, 'cancel')$$, 'field agent cannot cancel jobs');
select tests.login('e3000000-0000-0000-0000-000000000005');  -- other field agent
select tests.ok((select count(*) from public.jobs) = 0 and (select count(*) from public.job_notes) = 0 and (select count(*) from public.job_photos) = 0,
                'unassigned field agent sees nothing');
select tests.throws($$select public.get_field_job(current_setting('t.job')::uuid)$$, 'unassigned field agent cannot open the job');
select tests.throws($$select public.set_job_status((select id from public.jobs where title = 'Adhoc fix'), 'start')$$, 'unassigned field agent cannot start a job');
select tests.login('e3000000-0000-0000-0000-000000000007');
select tests.ok((select count(*) from public.jobs) = 0, 'other org cannot see jobs');
select tests.ok((select count(*) from storage.objects where bucket_id = 'job-photos') = 0, 'other org cannot list our job photos');
select tests.login('e3000000-0000-0000-0000-000000000003');
select tests.ok((select count(*) from storage.objects where bucket_id = 'job-photos') = 1, 'office can read job photos');
select tests.ok((select count(*) from public.activity_log where entity_id = current_setting('t.job')::uuid
                   and action in ('job_created', 'job_scheduled', 'job_assigned', 'job_started', 'job_completed', 'job_note_added', 'job_photo_added')) = 7,
                'job lifecycle is logged');

-- ---------------------------------------------------------------------------
-- Invoices + payments
-- ---------------------------------------------------------------------------
select tests.throws($$select public.create_invoice_from_job(current_setting('t.job')::uuid)$$, 'supervisor cannot create invoices');
select tests.login('e3000000-0000-0000-0000-000000000002');  -- accountant
select set_config('t.inv', (public.create_invoice_from_job(current_setting('t.job')::uuid) ->> 'invoice_id'), false);
select tests.ok((select status = 'draft' and invoice_number is null and total = 2185 and job_id = current_setting('t.job')::uuid
                        and quote_id = current_setting('t.q')::uuid and due_date = issue_date + 30
                   from public.invoices where id = current_setting('t.inv')::uuid), 'invoice drafted from job with quote lines, no number yet');
select tests.ok((select count(*) from public.invoice_items where invoice_id = current_setting('t.inv')::uuid) = 2, 'quote lines copied to invoice');
select tests.ok((public.create_invoice_from_job(current_setting('t.job')::uuid) ->> 'created') = 'false', 'invoice from job is idempotent');
select tests.ok((public.create_invoice_from_quote(current_setting('t.q')::uuid) ->> 'invoice_id') = current_setting('t.inv'),
                'invoicing the same quote directly returns the existing invoice (no double billing)');
select tests.throws($$select public.create_invoice_from_job((select id from public.jobs where title = 'Adhoc fix'))$$, 'an incomplete job cannot be invoiced');
insert into public.invoice_items (organisation_id, invoice_id, description, unit_price, sort_order)
values (current_setting('t.org')::uuid, current_setting('t.inv')::uuid, 'Extra bait station', 100, 3);
select tests.ok((select total from public.invoices where id = current_setting('t.inv')::uuid) = 2300, 'draft invoice line edits recalc (2000 + 300 VAT)');
select tests.throws($$select public.record_payment(current_setting('t.inv')::uuid, 100)$$, 'cannot pay a draft invoice');
select tests.ok((public.issue_invoice(current_setting('t.inv')::uuid) ->> 'invoice_number') = 'INV-0001', 'issued invoice gets INV-0001');
select tests.ok((public.issue_invoice(current_setting('t.inv')::uuid) ->> 'already') = 'true', 'issuing twice is a no-op');
select tests.ok((select customer_name_snapshot = 'DJ Ossewa' and payment_details_snapshot like '%FNB%' and seller_tax_snapshot = '4123456789'
                   from public.invoices where id = current_setting('t.inv')::uuid), 'invoice snapshots seller, customer and bank details');
select tests.throws($$update public.invoice_items set unit_price = 1 where invoice_id = current_setting('t.inv')::uuid$$, 'issued invoice lines are frozen');
select tests.throws($$update public.invoices set notes = 'x' where id = current_setting('t.inv')::uuid$$, 'issued invoice is frozen');
select tests.throws($$select public.record_payment(current_setting('t.inv')::uuid, 0)$$, 'zero payment rejected');
select tests.throws($$select public.record_payment(current_setting('t.inv')::uuid, 2300.01)$$, 'overpayment rejected');
select tests.ok((public.record_payment(current_setting('t.inv')::uuid, 1000, null, 'bank_transfer', 'EFT 1', null, 'idem-key-0001') ->> 'status') = 'partially_paid',
                'partial payment');
select tests.ok((public.record_payment(current_setting('t.inv')::uuid, 1000, null, 'bank_transfer', 'EFT 1', null, 'idem-key-0001') ->> 'already') = 'true',
                'double submit with the same key records nothing new');
select tests.ok((select amount_paid = 1000 and amount_due = 1300 from public.invoices where id = current_setting('t.inv')::uuid), 'balance after partial payment');
select tests.ok((public.customer_balance(current_setting('t.cust')::uuid) ->> 'outstanding')::numeric = 1300, 'customer balance shows 1300 outstanding');
select tests.throws($$select public.void_invoice(current_setting('t.inv')::uuid, 'mistake')$$, 'cannot void an invoice with payments');
select tests.throws($$update public.payments set amount = 1$$, 'payments cannot be edited');
select tests.throws($$delete from public.payments$$, 'payments cannot be deleted');
select tests.ok((public.record_payment(current_setting('t.inv')::uuid, 1300, null, 'cash', null, null, 'idem-key-0002') ->> 'status') = 'paid', 'final payment marks invoice paid');
select tests.ok((select amount_due = 0 and paid_at is not null from public.invoices where id = current_setting('t.inv')::uuid), 'paid invoice has zero due');
select tests.ok((public.customer_balance(current_setting('t.cust')::uuid) ->> 'outstanding')::numeric = 0, 'customer balance is R0');
select tests.throws($$select public.record_payment(current_setting('t.inv')::uuid, 1)$$, 'cannot pay a paid invoice');
select tests.ok((public.void_payment((select id from public.payments where idempotency_key = 'idem-key-0002'), 'bounced') ->> 'status') = 'partially_paid',
                'reversing a payment reopens the balance');
select public.record_payment(current_setting('t.inv')::uuid, 1300, null, 'card', null, null, 'idem-key-0003');
select tests.ok((select count(*) from public.activity_log where entity_id = current_setting('t.inv')::uuid
                   and action in ('invoice_created', 'invoice_issued', 'payment_recorded', 'payment_voided', 'invoice_paid')) >= 6,
                'invoice + payment events are logged');
-- Numbering at issue: a second invoice is INV-0002 even though created later
insert into public.invoices (organisation_id, customer_id, title) values (current_setting('t.org')::uuid, current_setting('t.cust')::uuid, 'Manual invoice');
insert into public.invoice_items (organisation_id, invoice_id, description, unit_price)
  select current_setting('t.org')::uuid, id, 'Service', 500 from public.invoices where title = 'Manual invoice';
select tests.ok((public.issue_invoice((select id from public.invoices where title = 'Manual invoice')) ->> 'invoice_number') = 'INV-0002', 'second issued invoice is INV-0002');
select tests.ok((public.void_invoice((select id from public.invoices where title = 'Manual invoice'), 'Raised in error') ->> 'status') = 'void', 'unpaid invoice can be voided with a reason');
select tests.ok((select count(*) from public.invoices where invoice_number = 'INV-0002') = 1, 'voided invoice keeps its number (audit trail)');
select tests.throws($$delete from public.invoices$$, 'invoices cannot be deleted');

select tests.login('e3000000-0000-0000-0000-000000000003');
select tests.ok((select count(*) from public.invoices) = 0 and (select count(*) from public.payments) = 0, 'supervisor cannot see invoices or payments');
select tests.ok((public.customer_balance(current_setting('t.cust')::uuid) ->> 'open_invoices')::int = 0, 'supervisor gets no balance data (RLS)');
select tests.login('e3000000-0000-0000-0000-000000000006');
select tests.throws($$select public.record_payment(current_setting('t.inv')::uuid, 1)$$, 'viewer cannot record payments');
select tests.ok((select count(*) from public.invoices) = 2, 'viewer reads invoices');
select tests.login('e3000000-0000-0000-0000-000000000007');
select tests.ok((select count(*) from public.invoices) = 0, 'other org cannot see invoices');
select tests.throws($$select public.record_payment(current_setting('t.inv')::uuid, 1)$$, 'other org cannot pay our invoice');

-- Documents bucket
select tests.login('e3000000-0000-0000-0000-000000000002');
insert into storage.objects (bucket_id, name) values ('documents', current_setting('t.org') || '/invoices/' || current_setting('t.inv') || '/INV-0001.pdf');
insert into public.documents (organisation_id, entity_type, entity_id, kind, storage_path, file_name, created_by)
values (current_setting('t.org')::uuid, 'invoice', current_setting('t.inv')::uuid, 'invoice_pdf',
        current_setting('t.org') || '/invoices/' || current_setting('t.inv') || '/INV-0001.pdf', 'INV-0001.pdf', 'e3000000-0000-0000-0000-000000000002');
select tests.throws($$update public.documents set file_name = 'x'$$, 'documents are immutable');
select tests.throws($$insert into public.documents (organisation_id, entity_type, entity_id, kind, storage_path, file_name, created_by)
                      values (current_setting('t.org')::uuid, 'invoice', current_setting('t.inv')::uuid, 'invoice_pdf', current_setting('t.other') || '/x.pdf', 'x.pdf', 'e3000000-0000-0000-0000-000000000002')$$,
                    'document path must be inside the organisation folder');
select tests.login('e3000000-0000-0000-0000-000000000003');
select tests.ok((select count(*) from storage.objects where bucket_id = 'documents') = 0, 'supervisor cannot read invoice PDFs');
select tests.login('e3000000-0000-0000-0000-000000000007');
select tests.ok((select count(*) from storage.objects where bucket_id = 'documents') = 0 and (select count(*) from public.documents) = 0,
                'other org cannot read our documents');

-- ---------------------------------------------------------------------------
-- Today + search
-- ---------------------------------------------------------------------------
select tests.login('e3000000-0000-0000-0000-000000000001');
insert into public.leads (organisation_id, title, person_name, phone) values (current_setting('t.org')::uuid, 'New enquiry', 'Jane Smith', '083 444 5555');
update public.leads set last_activity_at = now() - interval '5 days' where title = 'New enquiry';
select set_config('t.today', public.today_summary(current_setting('t.org')::uuid)::text, false);
select tests.ok((current_setting('t.today')::jsonb ->> 'money_outstanding')::numeric = 0, 'Today: no money outstanding once paid');
select tests.ok((current_setting('t.today')::jsonb ->> 'new_leads_count')::int >= 1, 'Today: new leads counted');
select tests.ok((current_setting('t.today')::jsonb ->> 'leads_followup_count')::int >= 1, 'Today: stale lead needs follow-up');
select tests.ok(jsonb_array_length(current_setting('t.today')::jsonb -> 'unassigned_upcoming') = 0, 'Today: no unassigned jobs (all assigned)');
-- Overdue invoice appears and disappears
insert into public.invoices (organisation_id, customer_id, title, issue_date, due_date) values (current_setting('t.org')::uuid, current_setting('t.cust')::uuid, 'Old invoice', current_date - 40, current_date - 10);
insert into public.invoice_items (organisation_id, invoice_id, description, unit_price) select current_setting('t.org')::uuid, id, 'Old work', 870 from public.invoices where title = 'Old invoice';
select public.issue_invoice((select id from public.invoices where title = 'Old invoice'));
-- issue_invoice moves dates to today; backdate the due date as the scheduler would see an old invoice
select set_config('app.invoice_transition', 'on', false);
update public.invoices set issue_date = current_date - 40, due_date = current_date - 10 where title = 'Old invoice';
select set_config('app.invoice_transition', 'off', false);
select tests.ok((public.today_summary(current_setting('t.org')::uuid) ->> 'overdue_invoices_count')::int = 1
                and (public.today_summary(current_setting('t.org')::uuid) ->> 'overdue_amount')::numeric = 1000.50, 'Today: overdue invoice counted with amount');
select tests.ok(public.invoice_effective_status('issued', current_date - 1, 10) = 'overdue', 'overdue is derived');
select tests.login('e3000000-0000-0000-0000-000000000004');
select tests.ok(not (public.today_summary(current_setting('t.org')::uuid) ? 'money_outstanding'), 'field agent Today has no money figures');
select tests.ok(not (public.today_summary(current_setting('t.org')::uuid) ? 'new_leads_count'), 'field agent Today has no leads');
select tests.login('e3000000-0000-0000-0000-000000000007');
select tests.throws($$select public.today_summary(current_setting('t.org')::uuid)$$, 'cannot read another organisation''s Today');

select tests.login('e3000000-0000-0000-0000-000000000001');
select tests.ok((select count(*) from public.global_search(current_setting('t.org')::uuid, 'Ossewa') where entity_type = 'customer') >= 1, 'search finds customer by name');
select tests.ok((select count(*) from public.global_search(current_setting('t.org')::uuid, 'INV-0001') where entity_type = 'invoice') = 1, 'search finds invoice by number');
select tests.ok((select count(*) from public.global_search(current_setting('t.org')::uuid, 'Q-0001') where entity_type = 'quote') >= 1, 'search finds quote by number');
select tests.ok((select count(*) from public.global_search(current_setting('t.org')::uuid, '4445555') where entity_type = 'lead') = 1, 'search finds lead by phone digits');
select tests.ok((select count(*) from public.global_search(current_setting('t.org')::uuid, 'J-0001') where entity_type = 'job') = 1, 'search finds job by number');
select tests.ok((select count(*) from public.global_search(current_setting('t.org')::uuid, '%')) = 0, 'search ignores 1-char/wildcard queries');
select tests.login('e3000000-0000-0000-0000-000000000004');
select tests.ok((select count(*) from public.global_search(current_setting('t.org')::uuid, 'Ossewa') where entity_type in ('customer', 'invoice', 'quote', 'lead')) = 0,
                'field agent search returns no customers, leads, quotes or invoices');
select tests.ok((select count(*) from public.global_search(current_setting('t.org')::uuid, 'J-0001')) = 1, 'field agent finds own job');
select tests.login('e3000000-0000-0000-0000-000000000007');
select tests.ok((select count(*) from public.global_search(current_setting('t.org')::uuid, 'Ossewa')) = 0, 'search is tenant-isolated');

-- Client API cannot reach internals
select tests.logout();
select tests.ok(not has_function_privilege('anon', 'public.record_payment(uuid,numeric,date,text,text,text,text)', 'execute')
                and not has_function_privilege('anon', 'public.issue_invoice(uuid)', 'execute')
                and not has_function_privilege('anon', 'public.today_summary(uuid)', 'execute'), 'anon cannot call Phase 003 RPCs');
select tests.ok(not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
                'anon still has no table privileges');
select tests.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'app_private' and has_function_privilege('anon', p.oid, 'execute')),
                'anon cannot execute any app_private function');

select format('%s assertions passed (cumulative)', count(*)) as summary from tests.results;
