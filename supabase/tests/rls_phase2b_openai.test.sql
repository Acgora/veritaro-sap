-- =============================================================================
-- AI architecture decision 2026-10-15: OpenAI GPT-6 Luna primary.
-- Routes, dated prices, cached-token costing, usage detail, history preservation,
-- limits with the new provider, and client lockout of the replaced functions.
-- Runs after rls_phase2.test.sql in the same database (reuses tests.* helpers).
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

select tests.logout();
insert into auth.users (id, email, raw_user_meta_data) values
  ('e2000000-0000-0000-0000-000000000001', 'oa.owner@test.local', '{"first_name":"Olu"}'),
  ('e2000000-0000-0000-0000-000000000002', 'oa.other@test.local', '{"first_name":"Ot"}');
select tests.login('e2000000-0000-0000-0000-000000000001');
select set_config('t.org', public.create_organisation('OpenAI Test Org')::text, false);
select tests.login('e2000000-0000-0000-0000-000000000002');
select set_config('t.other', public.create_organisation('OpenAI Other Org')::text, false);

-- Clients still locked out of metering (new signatures)
select tests.login('e2000000-0000-0000-0000-000000000001');
select tests.throws($$select public.ai_record_usage(gen_random_uuid(), 'openai', 'gpt-6-luna', 'primary', null, 1, 1, 1, 'ok', 0, 0)$$,
                    'clients cannot call the new ai_record_usage');
select tests.throws($$select app_private.ai_cost_usd('openai', 'gpt-6-luna', 1, 1, 0)$$, 'clients cannot call ai_cost_usd');
select tests.throws($$update public.ai_model_routes set model = 'gpt-anything' where tier = 'primary'$$, 'clients cannot change model routes');

select tests.as_service();

-- Routes
select tests.ok((select provider = 'openai' and model = 'gpt-6-luna' and enabled and reasoning_effort = 'low'
                   from public.ai_model_routes where tier = 'primary'), 'primary route is openai / gpt-6-luna, effort low');
select tests.ok((select bool_and(not enabled and provider is null and model is null)
                   from public.ai_model_routes where tier in ('fallback', 'premium')), 'fallback and premium stay disabled and unconfigured');
select tests.throws($$update public.ai_model_routes set reasoning_effort = 'max' where tier = 'primary'$$, 'unapproved reasoning effort rejected by the DB');

-- Prices: dated, data-driven, history kept
select tests.ok((select count(*) from public.ai_model_prices where provider = 'anthropic' and model = 'claude-haiku-5-5') = 1,
                'Anthropic price row kept for historical costs');
select tests.ok((select effective_from = '2026-09-22T00:00:00Z'::timestamptz and cached_input_usd_per_mtok = 0.01
                   from public.ai_model_prices where provider = 'openai' and model = 'gpt-6-luna'), 'GPT-6 Luna price row is dated with a cached rate');
select tests.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'app_private' and p.proname = 'ai_cost_usd') = 1, 'single ai_cost_usd signature (no ambiguous overloads)');
select tests.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'ai_record_usage') = 1, 'single ai_record_usage signature');

-- Cost maths (exact numeric)
select tests.ok(app_private.ai_cost_usd('openai', 'gpt-6-luna', 200000, 200000) = 0.12, 'cost: 200K in + 200K out = $0.12');
select tests.ok(app_private.ai_cost_usd('openai', 'gpt-6-luna', 200000, 200000, 100000) = 0.111, 'cost: half the prompt cached at $0.01/M');
select tests.ok(app_private.ai_cost_usd('openai', 'gpt-6-luna', 1000, 0, 5000) = 0.00001, 'cached tokens clamp to input tokens');
select tests.ok(app_private.ai_cost_usd('openai', 'gpt-6-luna', 300000, 10000) = 0.0675, 'cost: >272K prompt uses the long-context tier (2x in, 1.5x out)');
select tests.ok(app_private.ai_cost_usd('anthropic', 'claude-haiku-5-5', 100000, 100000) = 0.06, 'historical Anthropic pricing unchanged');
select tests.ok(app_private.ai_cost_usd('openai', 'gpt-unknown', 10, 10) is null, 'unpriced model has no price');
select tests.ok((public.ai_begin_request(current_setting('t.org')::uuid, 'e2000000-0000-0000-0000-000000000001',
                 'openai', 'gpt-unknown', 'chat', 10, 10) ->> 'reason') = 'unknown_price', 'unpriced model is never called');

-- Historical usage rows (written by the Phase 002 suite) keep provider/model and gain zero detail
select tests.ok((select count(*) > 0 and bool_and(provider = 'anthropic' and model = 'claude-haiku-5-5'
                        and cached_input_tokens = 0 and reasoning_tokens = 0)
                   from public.ai_usage_events where provider = 'anthropic'), 'historical usage keeps its original provider/model');

-- Full metered call with OpenAI
select set_config('t.req', public.ai_begin_request(current_setting('t.org')::uuid, 'e2000000-0000-0000-0000-000000000001',
                  'openai', 'gpt-6-luna', 'chat', 2000, 2048) ->> 'request_id', false);
select tests.ok(current_setting('t.req') <> '', 'OpenAI request reserved');
select tests.ok(public.ai_record_usage(current_setting('t.req')::uuid, 'openai', 'gpt-6-luna', 'primary', 'search_customers',
                2000, 200, 850, 'ok', 1000, 50) = 0.00021, 'usage cost: 1000 uncached + 1000 cached + 200 out = $0.00021');
select tests.ok((select provider = 'openai' and model = 'gpt-6-luna' and input_tokens = 2000 and output_tokens = 200
                        and cached_input_tokens = 1000 and reasoning_tokens = 50 and tool_name = 'search_customers'
                        and outcome = 'ok' and cost_usd = 0.00021 and user_id = 'e2000000-0000-0000-0000-000000000001'
                        and organisation_id = current_setting('t.org')::uuid and created_at is not null
                   from public.ai_usage_events where request_id = current_setting('t.req')::uuid),
                'usage event stores org, user, provider, model, tokens, cached, reasoning, tool, outcome, cost, time');
select public.ai_finish_request(current_setting('t.req')::uuid, 'completed');
select tests.ok((select cost_usd = 0.00021 and reserved_usd = 0 from public.ai_usage_monthly
                  where organisation_id = current_setting('t.org')::uuid), 'monthly total exact, reservation released');
select tests.ok((select count(*) from public.ai_usage_monthly where organisation_id = current_setting('t.other')::uuid) = 0,
                'other organisation unaffected by this org''s usage');
select tests.throws($$update public.ai_usage_events set cached_input_tokens = 1 where request_id = current_setting('t.req')::uuid$$,
                    'usage events remain append-only (new columns too)');

-- Failure is recorded as a failure
select set_config('t.req2', public.ai_begin_request(current_setting('t.org')::uuid, 'e2000000-0000-0000-0000-000000000001',
                  'openai', 'gpt-6-luna', 'chat', 2000, 2048) ->> 'request_id', false);
select public.ai_record_usage(current_setting('t.req2')::uuid, 'openai', 'gpt-6-luna', 'primary', null, 0, 0, 30000, 'timeout');
select public.ai_finish_request(current_setting('t.req2')::uuid, 'failed');
select tests.ok((select status = 'failed' from public.ai_requests where id = current_setting('t.req2')::uuid)
                and (select outcome = 'timeout' and cost_usd = 0 from public.ai_usage_events where request_id = current_setting('t.req2')::uuid),
                'provider failure recorded as failed, zero cost');

-- Soft budget flags but keeps working; hard ceiling blocks (OpenAI pricing)
insert into public.ai_org_limits (organisation_id, soft_budget_usd, hard_budget_usd)
values (current_setting('t.org')::uuid, 0.0002, 0.0100);
select set_config('t.req3', public.ai_begin_request(current_setting('t.org')::uuid, 'e2000000-0000-0000-0000-000000000001',
                  'openai', 'gpt-6-luna', 'chat', 1000, 1000) ->> 'request_id', false);
select public.ai_record_usage(current_setting('t.req3')::uuid, 'openai', 'gpt-6-luna', 'primary', null, 1000, 100, 500, 'ok');
select tests.ok((public.ai_finish_request(current_setting('t.req3')::uuid, 'completed') ->> 'soft_flagged') = 'true', 'soft budget crossed → flagged');
select tests.ok((public.ai_begin_request(current_setting('t.org')::uuid, 'e2000000-0000-0000-0000-000000000001',
                 'openai', 'gpt-6-luna', 'chat', 1000, 1000) ->> 'allowed') = 'true', 'soft budget does not block');
update public.ai_org_limits set hard_budget_usd = 0.0003 where organisation_id = current_setting('t.org')::uuid;
select tests.ok((public.ai_begin_request(current_setting('t.org')::uuid, 'e2000000-0000-0000-0000-000000000001',
                 'openai', 'gpt-6-luna', 'chat', 1000, 2048) ->> 'reason') = 'hard_limit', 'hard ceiling blocks the next billable OpenAI request');
select tests.ok(public.ai_release_stale_reservations('0 seconds') >= 1, 'open reservation released');
select tests.logout();

select format('%s assertions passed (cumulative)', count(*)) as summary from tests.results;
