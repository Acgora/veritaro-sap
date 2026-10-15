import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveRoute, safeBaseUrl, FALLBACK_ENABLED_IN_V1, AUTOMATIC_ROUTING_ENABLED_IN_V1, type RouteRow } from "@/lib/ai/gateway/router";
import { activeProviders, allowedModel, PROVIDER_ALLOWLIST } from "@/lib/ai/gateway/allowlist";
import { runModel, estimateInputTokens, isGatewayConfigured, defaultProviderFor } from "@/lib/ai/gateway/gateway";
import { AnthropicProvider, parseAnthropicResponse } from "@/lib/ai/gateway/providers/anthropic";
import { OpenAIProvider, buildResponsesBody, parseResponsesResponse, toResponsesInput } from "@/lib/ai/gateway/providers/openai";
import { OpenAICompatibleProvider } from "@/lib/ai/gateway/providers/openai-compatible";
import { classify, extract, parseStructured } from "@/lib/ai/gateway/capabilities";
import { ProviderError, type AIProvider, type ChatMessage, type ProviderResponse } from "@/lib/ai/gateway/types";
import type { ServiceSupabase } from "@/lib/supabase/service";

const primary: RouteRow = { tier: "primary", provider: "openai", model: "gpt-6-luna", enabled: true, max_output_tokens: 2048, timeout_ms: 30000, reasoning_effort: "low" };
const env = { AI_PROVIDER_OPENAI_KEY: "test-key", SUPABASE_SECRET_KEY: "svc" };

describe("server-side allowlist & provider selection", () => {
  it("V1: OpenAI GPT-6 Luna is the only active provider/model; Anthropic and self-hosted are disabled", () => {
    expect(activeProviders()).toEqual(["openai"]);
    expect(allowedModel("openai", "gpt-6-luna")).not.toBeNull();
    expect(PROVIDER_ALLOWLIST.anthropic.status).toBe("disabled");
    expect(PROVIDER_ALLOWLIST.selfhosted.status).toBe("disabled");
    expect(Object.keys(PROVIDER_ALLOWLIST.selfhosted.models)).toHaveLength(0);
    expect(FALLBACK_ENABLED_IN_V1).toBe(false);
    expect(AUTOMATIC_ROUTING_ENABLED_IN_V1).toBe(false);
  });

  it("a DB route pointing at disabled Anthropic is refused, even with a key present", () => {
    const anth: RouteRow = { ...primary, provider: "anthropic", model: "claude-haiku-5-5", reasoning_effort: null };
    expect(resolveRoute([anth], "primary", { ...env, AI_PROVIDER_ANTHROPIC_KEY: "k" })).toEqual({ ok: false, reason: "provider_disabled" });
  });

  it("a DB route naming an unapproved provider or model is refused", () => {
    expect(resolveRoute([{ ...primary, model: "gpt-6-sol" }], "primary", env)).toEqual({ ok: false, reason: "not_allowlisted" });
    expect(resolveRoute([{ ...primary, provider: "evilcorp", model: "x" }], "primary", env)).toEqual({ ok: false, reason: "not_allowlisted" });
    expect(resolveRoute([{ ...primary, provider: "selfhosted", model: "llama-4" }], "primary", env)).toEqual({ ok: false, reason: "provider_disabled" });
  });

  it("a reasoning effort not approved for the model is refused", () => {
    expect(resolveRoute([{ ...primary, reasoning_effort: "max" }], "primary", env)).toEqual({ ok: false, reason: "not_allowlisted" });
    expect(resolveRoute([{ ...primary, reasoning_effort: "xhigh" }], "primary", env)).toEqual({ ok: false, reason: "not_allowlisted" });
    const r = resolveRoute([{ ...primary, reasoning_effort: null }], "primary", env);
    expect(r.ok && r.route.reasoningEffort).toBe("none"); // allowlist default = first approved
  });

  it("prototype keys cannot sneak past the allowlist", () => {
    expect(allowedModel("openai", "constructor")).toBeNull();
    expect(allowedModel("__proto__", "x")).toBeNull();
    expect(resolveRoute([{ ...primary, provider: "__proto__" }], "primary", env)).toEqual({ ok: false, reason: "not_allowlisted" });
  });

  it("disabled tiers, missing credentials and bad endpoints resolve to nothing", () => {
    const fallback: RouteRow = { tier: "fallback", provider: null, model: null, enabled: false, max_output_tokens: 1024, timeout_ms: 20000 };
    expect(resolveRoute([primary, fallback], "fallback", env)).toEqual({ ok: false, reason: "disabled" });
    expect(resolveRoute([primary], "primary", { SUPABASE_SECRET_KEY: "s" })).toEqual({ ok: false, reason: "missing_credentials" });
    expect(resolveRoute([], "primary", env)).toEqual({ ok: false, reason: "no_route" });
    expect(resolveRoute([primary], "primary", { ...env, AI_PROVIDER_OPENAI_BASE_URL: "http://evil.example" })).toEqual({ ok: false, reason: "missing_endpoint" });
  });

  it("resolves the approved primary route with key and endpoint from env (never from the DB)", () => {
    const r = resolveRoute([primary], "primary", env);
    expect(r.ok && r.route).toMatchObject({ provider: "openai", adapter: "openai_responses", model: "gpt-6-luna", apiKey: "test-key", baseUrl: "https://api.openai.com", reasoningEffort: "low" });
    expect(r.ok && defaultProviderFor(r.route)).toBeInstanceOf(OpenAIProvider);
  });

  it("endpoint env values must be https (http only for loopback) and carry no credentials", () => {
    expect(safeBaseUrl("https://api.openai.com/")).toBe("https://api.openai.com");
    expect(safeBaseUrl("http://127.0.0.1:54400")).toBe("http://127.0.0.1:54400");
    expect(safeBaseUrl("http://inference.internal")).toBeNull();
    expect(safeBaseUrl("https://user:pw@x.com")).toBeNull();
    expect(safeBaseUrl("javascript:alert(1)")).toBeNull();
  });

  it("isGatewayConfigured needs the metering key and a key for an ACTIVE provider", () => {
    expect(isGatewayConfigured({ AI_PROVIDER_OPENAI_KEY: "x" })).toBe(false);
    expect(isGatewayConfigured({ SUPABASE_SECRET_KEY: "s", AI_PROVIDER_ANTHROPIC_KEY: "x" })).toBe(false);
    expect(isGatewayConfigured(env)).toBe(true);
  });
});

/** Minimal fake of the service client used by runModel. */
function fakeService(opts: { begin?: unknown; routes?: RouteRow[] } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const service = {
    from: () => ({ select: async () => ({ data: opts.routes ?? [primary], error: null }) }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "ai_begin_request") return { data: opts.begin ?? { allowed: true, request_id: "req-1" }, error: null };
      return { data: null, error: null };
    },
  } as unknown as ServiceSupabase;
  return { service, calls };
}

const call = { organisationId: "org", userId: "u", category: "chat", system: "s", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }], tools: [] };
const reply = (r: Partial<ProviderResponse>): AIProvider => ({ name: "openai", complete: vi.fn(async () => ({ content: [], stopReason: "end_turn" as const, usage: { inputTokens: 0, outputTokens: 0 }, ...r })) });

describe("gateway runModel (metering, limits, failure)", () => {
  it("reserves budget, calls the provider with the route's effort, records usage incl. cached/reasoning, releases", async () => {
    const { service, calls } = fakeService();
    const provider = reply({ content: [{ type: "tool_use", id: "t", name: "search_customers", input: {} }], stopReason: "tool_use", usage: { inputTokens: 1200, outputTokens: 80, cachedInputTokens: 1000, reasoningTokens: 40 } });
    const r = await runModel(call, { service, env, providerFor: () => provider, now: () => 1000 });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual(["ai_begin_request", "ai_record_usage", "ai_finish_request"]);
    expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-6-luna", reasoningEffort: "low", maxOutputTokens: 2048 }));
    const rec = calls[1]!.args;
    expect(rec).toMatchObject({ p_provider: "openai", p_model: "gpt-6-luna", p_tier: "primary", p_input_tokens: 1200, p_output_tokens: 80, p_cached_input_tokens: 1000, p_reasoning_tokens: 40, p_outcome: "ok", p_tool_name: "search_customers" });
    expect(calls[0]!.args).toMatchObject({ p_category: "chat", p_user_id: "u", p_organisation_id: "org", p_provider: "openai", p_model: "gpt-6-luna" });
    expect(rec).not.toHaveProperty("p_cost_usd"); // cost is computed in the DB, never by the app
  });

  for (const reason of ["hard_limit", "rate_limited", "request_limit"]) {
    it(`does not call the provider when metering blocks (${reason})`, async () => {
      const { service, calls } = fakeService({ begin: { allowed: false, reason } });
      const complete = vi.fn();
      const r = await runModel(call, { service, env, providerFor: () => ({ name: "openai", complete }), now: () => 0 });
      expect(r).toEqual({ ok: false, code: "blocked", reason });
      expect(complete).not.toHaveBeenCalled();
      expect(calls.map((c) => c.fn)).toEqual(["ai_begin_request"]);
    });
  }

  it("soft budget is advisory: a flagged org still gets an answer", async () => {
    const { service } = fakeService({ begin: { allowed: true, request_id: "r" } });
    const r = await runModel(call, { service, env, providerFor: () => reply({ content: [{ type: "text", text: "ok" }] }), now: () => 0 });
    expect(r.ok).toBe(true);
  });

  it("OpenAI outage fails gracefully, is metered as unavailable, and never falls back to another provider", async () => {
    const anthRoute: RouteRow = { tier: "fallback", provider: "anthropic", model: "claude-haiku-5-5", enabled: true, max_output_tokens: 1024, timeout_ms: 1000 };
    const { service, calls } = fakeService({ routes: [primary, anthRoute] });
    const providerFor = vi.fn(() => ({ name: "openai", complete: async () => { throw new ProviderError("unavailable", "down", 503); } }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runModel(call, { service, env: { ...env, AI_PROVIDER_ANTHROPIC_KEY: "k" }, providerFor, now: () => 0 });
    errSpy.mockRestore();
    expect(r).toMatchObject({ ok: false, code: "unavailable" });
    expect(providerFor).toHaveBeenCalledTimes(1);
    const rec = calls.find((c) => c.fn === "ai_record_usage")!.args;
    expect(rec).toMatchObject({ p_outcome: "provider_unavailable", p_input_tokens: 0 });
    // Regression: the key must be present (null), or PostgREST cannot resolve the function and the failure goes unrecorded.
    expect(rec).toHaveProperty("p_tool_name", null);
    expect(calls.find((c) => c.fn === "ai_finish_request")!.args).toMatchObject({ p_status: "failed" });
  });

  it("an unapproved model in the DB is not_configured: no reservation, no call", async () => {
    const { service, calls } = fakeService({ routes: [{ ...primary, model: "gpt-6-sol" }] });
    const r = await runModel(call, { service, env, providerFor: () => reply({}), now: () => 0 });
    expect(r).toMatchObject({ ok: false, code: "not_configured" });
    expect(calls).toHaveLength(0);
  });

  it("is not_configured (no call, no reservation) without the metering key", async () => {
    const r = await runModel(call, { service: null, env });
    expect(r).toMatchObject({ ok: false, code: "not_configured" });
  });

  it("refuses prompts larger than the model's approved input cap before reserving", async () => {
    const { service, calls } = fakeService();
    const big = { ...call, system: "x".repeat(80_000) };
    const r = await runModel(big, { service, env, providerFor: () => ({ name: "a", complete: vi.fn() }), now: () => 0 });
    expect(r).toMatchObject({ ok: false, code: "blocked" });
    expect(calls).toHaveLength(0);
    expect(estimateInputTokens(big)).toBeGreaterThan(20_000);
  });
});

describe("OpenAI adapter (Responses API)", () => {
  const history: ChatMessage[] = [
    { role: "user", content: [{ type: "text", text: "Find ABC" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "search_customers", input: { query: "ABC" } }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "call_1", content: "[]" }] },
  ];

  it("maps neutral messages to Responses input items (function_call / function_call_output)", () => {
    expect(toResponsesInput(history)).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Find ABC" }] },
      { type: "function_call", call_id: "call_1", name: "search_customers", arguments: '{"query":"ABC"}' },
      { type: "function_call_output", call_id: "call_1", output: "[]" },
    ]);
  });

  it("builds a request with store:false, reasoning effort, function tools and NO temperature", () => {
    const body = buildResponsesBody({ model: "gpt-6-luna", system: "sys", messages: history, tools: [{ name: "search_customers", description: "d", inputSchema: { type: "object" } }], maxOutputTokens: 2048, timeoutMs: 1, reasoningEffort: "low" });
    expect(body).toMatchObject({ model: "gpt-6-luna", instructions: "sys", store: false, max_output_tokens: 2048, reasoning: { effort: "low" } });
    expect(body.tools).toEqual([{ type: "function", name: "search_customers", description: "d", parameters: { type: "object" }, strict: false }]);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
  });

  it("requests JSON-schema output for structured extraction", () => {
    const body = buildResponsesBody({ model: "m", system: "", messages: [], tools: [], maxOutputTokens: 10, timeoutMs: 1, responseFormat: { name: "receipt", schema: { type: "object" } } });
    expect(body.text).toEqual({ format: { type: "json_schema", name: "receipt", schema: { type: "object" }, strict: false } });
    expect(body).not.toHaveProperty("tools");
  });

  it("parses text, tool calls, cached and reasoning usage; ignores reasoning items", () => {
    const r = parseResponsesResponse({
      status: "completed",
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "Looking that up" }] },
        { type: "function_call", call_id: "call_9", name: "get_customer", arguments: '{"customerId":"x"}' },
      ],
      usage: { input_tokens: 900, output_tokens: 60, input_tokens_details: { cached_tokens: 512 }, output_tokens_details: { reasoning_tokens: 20 } },
    });
    expect(r.content).toEqual([{ type: "text", text: "Looking that up" }, { type: "tool_use", id: "call_9", name: "get_customer", input: { customerId: "x" } }]);
    expect(r.stopReason).toBe("tool_use");
    expect(r.usage).toEqual({ inputTokens: 900, outputTokens: 60, cachedInputTokens: 512, reasoningTokens: 20 });
  });

  it("malformed tool arguments become {} (zod then rejects them); truncation is max_tokens", () => {
    const r = parseResponsesResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "function_call", call_id: "c", name: "t", arguments: "{oops" }] });
    expect(r.content[0]).toEqual({ type: "tool_use", id: "c", name: "t", input: {} });
    expect(r.stopReason).toBe("max_tokens");
    expect(parseResponsesResponse({}).usage).toEqual({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 });
  });

  it("sends the key only as a Bearer header to {base}/v1/responses", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "hi" }] }], usage: { input_tokens: 5, output_tokens: 1 } }), { status: 200 }));
    const p = new OpenAIProvider("sk-test", "https://mock.local/", fetchImpl as unknown as typeof fetch);
    const r = await p.complete({ model: "gpt-6-luna", system: "s", messages: [], tools: [], maxOutputTokens: 10, timeoutMs: 1000, reasoningEffort: "low" });
    expect(r.content).toEqual([{ type: "text", text: "hi" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mock.local/v1/responses");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(String(init.body)).not.toContain("sk-test");
  });

  it("maps HTTP failures to typed errors without leaking provider bodies", async () => {
    const mk = (status: number) => new OpenAIProvider("k", "https://mock.local", (async () => new Response("secret echo", { status })) as unknown as typeof fetch);
    const req = { model: "m", system: "", messages: [], tools: [], maxOutputTokens: 1, timeoutMs: 1000 };
    await expect(mk(503).complete(req)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(mk(401).complete(req)).rejects.toMatchObject({ kind: "auth" });
    await expect(mk(429).complete(req)).rejects.toMatchObject({ kind: "rate_limited" });
    await expect(mk(400).complete(req)).rejects.toMatchObject({ kind: "bad_request", message: "AI provider returned 400" });
    const down = new OpenAIProvider("k", "https://mock.local", (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
    await expect(down.complete(req)).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("OpenAI-compatible adapter (future self-hosted)", () => {
  it("speaks Chat Completions to the configured endpoint and parses tool calls", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c1", function: { name: "search_customers", arguments: '{"query":"x"}' } }] } }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    }), { status: 200 }));
    const p = new OpenAICompatibleProvider("selfhosted", "k", "http://127.0.0.1:8000", fetchImpl as unknown as typeof fetch);
    const r = await p.complete({ model: "qwen", system: "s", messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], tools: [{ name: "search_customers", description: "d", inputSchema: {} }], maxOutputTokens: 10, timeoutMs: 1000 });
    expect(r.stopReason).toBe("tool_use");
    expect(r.content).toEqual([{ type: "tool_use", id: "c1", name: "search_customers", input: { query: "x" } }]);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("http://127.0.0.1:8000/v1/chat/completions");
    expect(p.name).toBe("selfhosted");
  });
});

describe("capabilities: structured output", () => {
  const Receipt = z.object({ supplier: z.string().nullable(), total: z.number().nullable() });

  it("parseStructured validates JSON against the schema", () => {
    expect(parseStructured(Receipt, '{"supplier":"Builders","total":120.5}')).toEqual({ ok: true, data: { supplier: "Builders", total: 120.5 } });
    expect(parseStructured(Receipt, '```json\n{"supplier":null,"total":null}\n```')).toMatchObject({ ok: true });
    expect(parseStructured(Receipt, "not json")).toEqual({ ok: false, code: "invalid_output", reason: "not_json" });
    expect(parseStructured(Receipt, '{"supplier":5}')).toEqual({ ok: false, code: "invalid_output", reason: "schema_mismatch" });
  });

  it("extract() goes through the metered gateway with a response format", async () => {
    const { service, calls } = fakeService();
    const provider = reply({ content: [{ type: "text", text: '{"supplier":"Builders","total":99}' }] });
    const r = await extract({ organisationId: "org", userId: "u", category: "extract.receipt" }, { name: "receipt", schema: Receipt, instructions: "Extract.", input: "Builders R99" }, { service, env, providerFor: () => provider, now: () => 0 });
    expect(r).toEqual({ ok: true, data: { supplier: "Builders", total: 99 } });
    expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({ responseFormat: expect.objectContaining({ name: "receipt" }), tools: [] }));
    expect(calls[0]!.args).toMatchObject({ p_category: "extract.receipt" });
  });

  it("classify() only returns a label from the fixed list", async () => {
    const { service } = fakeService();
    const ok = await classify({ organisationId: "o", userId: "u", category: "classify.lead" }, { labels: ["lead", "support", "spam"], instructions: "Classify.", input: "Need a quote" }, { service, env, providerFor: () => reply({ content: [{ type: "text", text: '{"label":"lead"}' }] }), now: () => 0 });
    expect(ok).toEqual({ ok: true, data: "lead" });
    const bad = await classify({ organisationId: "o", userId: "u", category: "classify.lead" }, { labels: ["lead", "support", "spam"], instructions: "Classify.", input: "x" }, { service, env, providerFor: () => reply({ content: [{ type: "text", text: '{"label":"hack"}' }] }), now: () => 0 });
    expect(bad).toMatchObject({ ok: false, code: "invalid_output" });
  });
});

describe("Anthropic adapter (disabled, kept)", () => {
  it("sends the key only in the x-api-key header and parses tool calls + usage", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        content: [{ type: "text", text: "Searching" }, { type: "tool_use", id: "t1", name: "search_customers", input: { query: "ABC" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 900, output_tokens: 45 },
      }), { status: 200 }),
    );
    const p = new AnthropicProvider("sk-test", "https://mock.local", fetchImpl as unknown as typeof fetch);
    const r = await p.complete({ model: "claude-haiku-5-5", system: "s", messages: [], tools: [], maxOutputTokens: 100, timeoutMs: 1000 });
    expect(r.stopReason).toBe("tool_use");
    expect(r.usage).toEqual({ inputTokens: 900, outputTokens: 45 });
    expect(r.content[1]).toEqual({ type: "tool_use", id: "t1", name: "search_customers", input: { query: "ABC" } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mock.local/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
    expect(String(init.body)).not.toContain("sk-test");
  });

  it("maps HTTP failures to typed errors without leaking provider bodies", async () => {
    const p = new AnthropicProvider("k", "https://mock.local", (async () => new Response("secret echo", { status: 529 })) as unknown as typeof fetch);
    await expect(p.complete({ model: "m", system: "", messages: [], tools: [], maxOutputTokens: 1, timeoutMs: 1000 })).rejects.toMatchObject({ kind: "unavailable" });
    const a = new AnthropicProvider("k", "https://mock.local", (async () => new Response("", { status: 401 })) as unknown as typeof fetch);
    await expect(a.complete({ model: "m", system: "", messages: [], tools: [], maxOutputTokens: 1, timeoutMs: 1000 })).rejects.toMatchObject({ kind: "auth" });
  });

  it("parses an empty/odd response safely", () => {
    expect(parseAnthropicResponse({})).toEqual({ content: [], stopReason: "other", usage: { inputTokens: 0, outputTokens: 0 } });
  });
});
