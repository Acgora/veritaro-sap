-- =============================================================================
-- Phase 002 tests: customers / contacts / addresses tenancy & roles,
-- AI metering (limits, reservations, soft/hard budget, rate limit), AI privacy.
-- Runs after rls.test.sql in the same database (reuses the tests.* helpers).
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', false);
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('role', 'service_role', false);
end $$;
grant execute on function tests.as_service() to authenticated, anon, service_role;
grant usage on schema tests to service_role;
grant insert, select on tests.results to service_role;
grant usage on sequence tests.results_n_seq to service_role;
grant execute on all functions in schema tests to service_role;

select tests.logout();
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000001', 'p2.owner@test.local',  '{"first_name":"Pia"}'),
  ('e1000000-0000-0000-0000-000000000002', 'p2.acct@test.local',   '{"first_name":"Al"}'),
  ('e1000000-0000-0000-0000-000000000003', 'p2.field@test.local',  '{"first_name":"Fi"}'),
  ('e1000000-0000-0000-0000-000000000004', 'p2.viewer@test.local', '{"first_name":"Vi"}'),
  ('e1000000-0000-0000-0000-000000000005', 'p2.other@test.local',  '{"first_name":"Ot"}');

select tests.login('e1000000-0000-0000-0000-000000000001');
select set_config('t.org', public.create_organisation('P2 Cleaning')::text, false);
insert into public.organisation_members (organisation_id, user_id, role) values
  (current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000002', 'accountant'),
  (current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000003', 'field_agent'),
  (current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000004', 'viewer');

select tests.login('e1000000-0000-0000-0000-000000000005');
select set_config('t.other', public.create_organisation('Other Org')::text, false);
insert into public.customers (organisation_id, display_name, email) values (current_setting('t.other')::uuid, 'Secret Client', 'secret@x.co');

-- ---------------------------------------------------------------------------
-- Customers: create, normalise, duplicates, audit
-- ---------------------------------------------------------------------------
select tests.login('e1000000-0000-0000-0000-000000000001');
insert into public.customers (organisation_id, display_name, email, phone, vat_number, created_by, source)
values (current_setting('t.org')::uuid, 'ABC Construction', ' Info@ABC.co.za ', '+27 82 555 1234', '4123-456-789',
        'e1000000-0000-0000-0000-000000000005', 'ai');
select set_config('t.abc', (select id::text from public.customers where display_name = 'ABC Construction'), false);
select tests.ok((select created_by from public.customers where id = current_setting('t.abc')::uuid) = auth.uid(), 'customer created_by forced to caller');
select tests.ok((select source from public.customers where id = current_setting('t.abc')::uuid) = 'manual', 'client cannot claim source=ai without AI header');
select tests.ok((select email_normalized || '|' || phone_normalized || '|' || vat_normalized from public.customers where id = current_setting('t.abc')::uuid)
                = 'info@abc.co.za|27825551234|4123456789', 'email/phone/VAT normalised by DB');
select tests.ok(exists (select 1 from public.activity_log where action = 'customer_created' and entity_id = current_setting('t.abc')::uuid), 'customer_created logged');

select tests.ok((select reason from public.find_customer_duplicates(current_setting('t.org')::uuid, p_vat => '4123456789') limit 1) = 'Same VAT number', 'duplicate by VAT');
select tests.ok((select reason from public.find_customer_duplicates(current_setting('t.org')::uuid, p_email => 'INFO@abc.co.za') limit 1) = 'Same email', 'duplicate by email (case-insensitive)');
select tests.ok((select reason from public.find_customer_duplicates(current_setting('t.org')::uuid, p_phone => '082 555 1234') limit 1) = 'Same phone number', 'duplicate by phone (local vs +27 format)');
select tests.ok((select reason from public.find_customer_duplicates(current_setting('t.org')::uuid, p_name => 'ABC Constructions') limit 1) = 'Similar name', 'duplicate by similar name');
select tests.ok(not exists (select 1 from public.find_customer_duplicates(current_setting('t.org')::uuid, p_name => 'Secret Client')), 'duplicate search never reveals other orgs');

insert into public.customer_contacts (organisation_id, customer_id, first_name, phone, is_primary)
values (current_setting('t.org')::uuid, current_setting('t.abc')::uuid, 'Pieter', '0825551234', true);
select tests.throws($$insert into public.customer_contacts (organisation_id, customer_id, first_name, is_primary)
                      values (current_setting('t.org')::uuid, current_setting('t.abc')::uuid, 'Second', true)$$, 'only one primary contact');
insert into public.customer_addresses (organisation_id, customer_id, kind, label, line1, city)
values (current_setting('t.org')::uuid, current_setting('t.abc')::uuid, 'site', 'Head office', '1 Main Rd', 'Stellenbosch');
select tests.ok(exists (select 1 from public.activity_log where action = 'contact_added'), 'contact_added logged');
select tests.ok(exists (select 1 from public.activity_log where action = 'address_added'), 'address_added logged');

-- Cross-org child insert blocked by composite FK / RLS
select tests.throws($$insert into public.customer_contacts (organisation_id, customer_id, first_name)
                      values (current_setting('t.other')::uuid, current_setting('t.abc')::uuid, 'Hijack')$$, 'contact cannot point at another org''s customer');
select tests.throws($$delete from public.customers where id = current_setting('t.abc')::uuid$$, 'customers cannot be deleted (archive only)');

-- Task link validation
insert into public.tasks (organisation_id, title, assigned_to, related_entity_type, related_entity_id)
values (current_setting('t.org')::uuid, 'Site visit ABC', 'e1000000-0000-0000-0000-000000000003', 'customer', current_setting('t.abc')::uuid);
select tests.throws($$insert into public.tasks (organisation_id, title, related_entity_type, related_entity_id)
                      values (current_setting('t.org')::uuid, 'bad', 'customer', (select id from public.customers where display_name = 'Secret Client'))$$,
                    'task cannot link to another org''s customer');
select tests.throws($$insert into public.tasks (organisation_id, title, related_entity_type, related_entity_id)
                      values (current_setting('t.org')::uuid, 'bad', 'spaceship', gen_random_uuid())$$, 'unsupported related entity type rejected');

select public.create_customer(current_setting('t.org')::uuid, '{"display_name":"Unlinked Household","type":"individual"}',
  '{"first_name":"Mary","phone":"0721112222"}', '{"line1":"5 Oak St","city":"Paarl"}');
select tests.ok((select count(*) from public.customer_contacts c join public.customers u on u.id = c.customer_id where u.display_name = 'Unlinked Household' and c.is_primary) = 1
                and (select count(*) from public.customer_addresses a join public.customers u on u.id = a.customer_id where u.display_name = 'Unlinked Household') = 1,
                'create_customer RPC creates customer + primary contact + address atomically');
select tests.throws($$select public.create_customer(current_setting('t.org')::uuid, '{"display_name":"Half"}', '{"first_name":"x","email":"' || repeat('a', 400) || '"}')$$,
                    'create_customer is atomic (bad contact = nothing created)');
select tests.ok(not exists (select 1 from public.customers where display_name = 'Half'), 'no partial customer left behind');

-- ---------------------------------------------------------------------------
-- Tenant isolation & roles
-- ---------------------------------------------------------------------------
select tests.ok((select count(*) from public.customers) = 2, 'owner sees only own org customers');

select tests.login('e1000000-0000-0000-0000-000000000005');
select tests.ok((select count(*) from public.customers) = 1, 'other org owner sees only their customer');
select tests.ok((select count(*) from public.customer_contacts) = 0, 'other org sees no contacts');
select tests.ok(tests.affected($$update public.customers set display_name = 'x' where id = current_setting('t.abc')::uuid$$) = 0, 'other org cannot update customer');

select tests.login('e1000000-0000-0000-0000-000000000003');  -- field agent
-- Phase 003 (approved): field agents no longer read customer tables through linked tasks; job-scoped RPC only.
select tests.ok((select count(*) from public.customers) = 0, 'field agent cannot read customer records directly (Phase 003 scope)');
select tests.ok((select count(*) from public.customer_addresses) = 0, 'field agent cannot read customer sites directly (Phase 003 scope)');
select tests.throws($$insert into public.customers (organisation_id, display_name) values (current_setting('t.org')::uuid, 'x')$$, 'field agent cannot create customers');
select tests.ok(tests.affected($$update public.customers set phone = '1'$$) = 0, 'field agent cannot edit customers');

select tests.login('e1000000-0000-0000-0000-000000000004');  -- viewer
select tests.ok((select count(*) from public.customers) = 2, 'viewer reads all org customers');
select tests.throws($$insert into public.customers (organisation_id, display_name) values (current_setting('t.org')::uuid, 'x')$$, 'viewer cannot create customers');

select tests.login('e1000000-0000-0000-0000-000000000002');  -- accountant
insert into public.customers (organisation_id, display_name) values (current_setting('t.org')::uuid, 'Acct Created');
select tests.throws($$update public.customers set status = 'archived' where display_name = 'ABC Construction'$$, 'accountant cannot archive others'' customers');
select tests.ok(tests.affected($$update public.customers set status = 'archived' where display_name = 'Acct Created'$$) = 1, 'creator can undo (archive) own new customer within 15 minutes');
select tests.ok((select archived_by from public.customers where display_name = 'Acct Created') = auth.uid(), 'archived_by set by server');

select tests.login('e1000000-0000-0000-0000-000000000001');
select tests.ok(tests.affected($$update public.customers set status = 'archived' where id = current_setting('t.abc')::uuid$$) = 1, 'owner can archive');
select tests.ok(exists (select 1 from public.activity_log where action = 'customer_archived'), 'customer_archived logged');
select tests.ok(tests.affected($$update public.customers set status = 'active' where id = current_setting('t.abc')::uuid$$) = 1, 'owner can restore');
select tests.ok(exists (select 1 from public.activity_log where action = 'customer_restored'), 'customer_restored logged');
select tests.throws($$update public.customers set organisation_id = current_setting('t.other')::uuid where id = current_setting('t.abc')::uuid$$, 'customer cannot move org');

-- AI-originated writes (server sets the x-veritaro-actor header) are attributed to AI
select set_config('request.headers', '{"x-veritaro-actor":"ai"}', false);
insert into public.customers (organisation_id, display_name) values (current_setting('t.org')::uuid, 'Made By AI');
select set_config('request.headers', '', false);
select tests.ok((select source from public.customers where display_name = 'Made By AI') = 'ai', 'AI header sets customer source = ai');
select tests.ok((select actor_type from public.activity_log where action = 'customer_created' and metadata ->> 'name' = 'Made By AI') = 'ai'
                and (select actor_user_id from public.activity_log where action = 'customer_created' and metadata ->> 'name' = 'Made By AI') = auth.uid(),
                'AI action logged as actor_type=ai and still tied to the user');

-- ---------------------------------------------------------------------------
-- AI: clients cannot touch metering or routes
-- ---------------------------------------------------------------------------
select tests.throws($$select * from public.ai_model_routes$$, 'clients cannot read model routes');
select tests.throws($$select public.ai_begin_request(current_setting('t.org')::uuid, auth.uid(), 'anthropic', 'claude-haiku-5-5', 'chat', 100, 100)$$,
                    'clients cannot call ai_begin_request');
select tests.throws($$select public.ai_record_usage(gen_random_uuid(), 'anthropic', 'claude-haiku-5-5', 'primary', null, 1, 1, 1, 'ok')$$,
                    'clients cannot record usage');
select tests.throws($$insert into public.ai_usage_events (request_id, organisation_id, provider, model, tier, category, input_tokens, output_tokens, cost_usd, outcome)
                      values (gen_random_uuid(), current_setting('t.org')::uuid, 'x', 'y', 'primary', 'chat', 0, 0, 0, 'ok')$$, 'clients cannot insert usage events');
select tests.ok((public.ai_usage_summary(current_setting('t.org')::uuid) ->> 'soft_budget_usd') = '1.0000', 'owner sees usage summary with default soft budget');

select tests.login('e1000000-0000-0000-0000-000000000004');
select tests.throws($$select public.ai_usage_summary(current_setting('t.org')::uuid)$$, 'viewer cannot see AI usage');
select tests.throws($$insert into public.ai_conversations (organisation_id, user_id) values (current_setting('t.org')::uuid, auth.uid())$$, 'viewer (no ai.use) cannot start AI conversation');

select tests.login('e1000000-0000-0000-0000-000000000002');
insert into public.ai_conversations (organisation_id, user_id) values (current_setting('t.org')::uuid, auth.uid());
select tests.throws($$insert into public.ai_conversations (organisation_id, user_id) values (current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000001')$$, 'cannot create conversation as someone else');
select tests.login('e1000000-0000-0000-0000-000000000001');
select tests.ok((select count(*) from public.ai_conversations) = 0, 'owner cannot read another user''s AI conversations');

-- ---------------------------------------------------------------------------
-- AI metering as the server (service_role)
-- ---------------------------------------------------------------------------
select tests.as_service();
select tests.ok(app_private.ai_cost_usd('anthropic', 'claude-haiku-5-5', 100000, 100000) = 0.06, 'cost: 100K in + 100K out = $0.06 (standard tier)');
select tests.ok(app_private.ai_cost_usd('anthropic', 'claude-haiku-5-5', 150000, 1000) = 0.0775, 'cost: >100K prompt uses long-context tier');
select tests.ok(app_private.ai_cost_usd('anthropic', 'not-a-model', 10, 10) is null, 'unknown model has no price');

select tests.ok((public.ai_begin_request(current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000004', 'anthropic', 'claude-haiku-5-5', 'chat', 100, 100) ->> 'reason') = 'not_permitted',
                'viewer without ai.use is blocked');
select tests.ok((public.ai_begin_request(current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000001', 'evil', 'model', 'chat', 100, 100) ->> 'reason') = 'unknown_price',
                'unpriced model is refused before any call');

select set_config('t.req', public.ai_begin_request(current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000001',
                  'anthropic', 'claude-haiku-5-5', 'chat', 2000, 500) ->> 'request_id', false);
select tests.ok(current_setting('t.req') <> '', 'request reserved');
select tests.ok((select reserved_usd from public.ai_usage_monthly where organisation_id = current_setting('t.org')::uuid) = 0.00045, 'reservation = estimated cost');
select tests.ok(public.ai_record_usage(current_setting('t.req')::uuid, 'anthropic', 'claude-haiku-5-5', 'primary', 'create_customer', 1800, 200, 900, 'ok') = 0.00028,
                'recorded cost computed in DB (1800 in, 200 out = $0.00028)');
select public.ai_finish_request(current_setting('t.req')::uuid, 'completed');
select tests.ok((select reserved_usd = 0 and cost_usd = 0.00028 and request_count = 1 from public.ai_usage_monthly where organisation_id = current_setting('t.org')::uuid),
                'finish releases reservation, keeps actual cost');
select tests.ok((select input_tokens = 1800 and output_tokens = 200 and model = 'claude-haiku-5-5' and provider = 'anthropic' and tool_name = 'create_customer'
                        and user_id = 'e1000000-0000-0000-0000-000000000001' and category = 'chat'
                 from public.ai_usage_events where request_id = current_setting('t.req')::uuid), 'usage event stores tokens, model, provider, user, tool, category');
select tests.throws($$select public.ai_finish_request(current_setting('t.req')::uuid, 'completed')$$, 'request cannot be finished twice');
select tests.throws($$update public.ai_usage_events set cost_usd = 0$$, 'usage events are append-only');

-- Soft budget: flag + notify, keep working
update public.ai_usage_monthly set cost_usd = 1.10 where organisation_id = current_setting('t.org')::uuid;
select set_config('t.req2', public.ai_begin_request(current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000001',
                  'anthropic', 'claude-haiku-5-5', 'chat', 2000, 500) ->> 'request_id', false);
select tests.ok(current_setting('t.req2') <> '', 'above soft budget: still allowed');
select public.ai_finish_request(current_setting('t.req2')::uuid, 'completed');
select tests.ok((select soft_flagged_at is not null from public.ai_usage_monthly where organisation_id = current_setting('t.org')::uuid), 'soft budget flagged');
select tests.ok(exists (select 1 from public.activity_log where action = 'ai_soft_budget_exceeded' and organisation_id = current_setting('t.org')::uuid), 'soft budget logged');
select tests.ok(exists (select 1 from public.notifications where type = 'ai.soft_budget' and user_id = 'e1000000-0000-0000-0000-000000000001'), 'owner notified of soft budget');

-- Hard ceiling: blocked before the call
update public.ai_usage_monthly set cost_usd = 1.9999 where organisation_id = current_setting('t.org')::uuid;
select tests.ok((public.ai_begin_request(current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000001',
                 'anthropic', 'claude-haiku-5-5', 'chat', 2000, 500) ->> 'reason') = 'hard_limit', 'hard ceiling ($2) blocks billable request');
select tests.ok((select hard_blocked_at is not null from public.ai_usage_monthly where organisation_id = current_setting('t.org')::uuid), 'hard block flagged');
select tests.ok(exists (select 1 from public.activity_log where action = 'ai_hard_limit_reached'), 'hard limit logged');

-- Per-org override raises the ceiling (configurable later per plan)
insert into public.ai_org_limits (organisation_id, hard_budget_usd) values (current_setting('t.org')::uuid, 5.00);
select set_config('t.req3', public.ai_begin_request(current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000001',
                  'anthropic', 'claude-haiku-5-5', 'chat', 2000, 500) ->> 'request_id', false);
select tests.ok(current_setting('t.req3') <> '', 'per-organisation override applies');
select public.ai_finish_request(current_setting('t.req3')::uuid, 'failed');

-- Rate limit: 30 per user per 10 minutes
update public.ai_usage_monthly set cost_usd = 0 where organisation_id = current_setting('t.org')::uuid;
do $$
declare r jsonb; i int;
begin
  for i in 1..30 loop
    r := public.ai_begin_request(current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000002', 'anthropic', 'claude-haiku-5-5', 'chat', 10, 10);
    if r ->> 'request_id' is not null then perform public.ai_finish_request((r ->> 'request_id')::uuid, 'completed'); end if;
  end loop;
end $$;
select tests.ok((public.ai_begin_request(current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000002',
                 'anthropic', 'claude-haiku-5-5', 'chat', 10, 10) ->> 'reason') = 'rate_limited', '31st request in 10 minutes is rate-limited');
select tests.ok((public.ai_begin_request(current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000001',
                 'anthropic', 'claude-haiku-5-5', 'chat', 10, 10) ->> 'allowed') = 'true', 'rate limit is per user');

-- Monthly request limit
update public.ai_usage_monthly set request_count = 5000 where organisation_id = current_setting('t.org')::uuid;
select tests.ok((public.ai_begin_request(current_setting('t.org')::uuid, 'e1000000-0000-0000-0000-000000000001',
                 'anthropic', 'claude-haiku-5-5', 'chat', 10, 10) ->> 'reason') = 'request_limit', 'monthly request limit (5,000 since Phase 003) enforced');

select tests.ok(public.ai_release_stale_reservations('0 seconds') >= 1, 'stale reservations can be released');
select tests.logout();

select format('%s assertions passed (cumulative)', count(*)) as summary from tests.results;
