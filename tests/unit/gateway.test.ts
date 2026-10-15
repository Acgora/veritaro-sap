import { describe, expect, it, vi } from "vitest";
import { resolveRoute, FALLBACK_ENABLED_IN_V1, type RouteRow } from "@/lib/ai/gateway/router";
import { allowedModel, PROVIDER_ALLOWLIST } from "@/lib/ai/gateway/allowlist";
import { runModel, estimateInputTokens, isGatewayConfigured } from "@/lib/ai/gateway/gateway";
import { AnthropicProvider, parseAnthropicResponse } from "@/lib/ai/gateway/providers/anthropic";
import { ProviderError, type AIProvider } from "@/lib/ai/gateway/types";
import type { ServiceSupabase } from "@/lib/supabase/service";

const primary: RouteRow = { tier: "primary", provider: "anthropic", model: "claude-haiku-5-5", enabled: true, max_output_tokens: 1024, timeout_ms: 20000 };
const env = { AI_PROVIDER_ANTHROPIC_KEY: "test-key", SUPABASE_SECRET_KEY: "svc" };

describe("server-side allowlist", () => {
  it("only Claude Haiku 5.5 is approved in V1; the second provider has no approved models", () => {
    expect(allowedModel("anthropic", "claude-haiku-5-5")).not.toBeNull();
    expect(Object.keys(PROVIDER_ALLOWLIST.openai.models)).toHaveLength(0);
    expect(FALLBACK_ENABLED_IN_V1).toBe(false);
  });

  it("a DB route naming an unlisted model or provider is refused", () => {
    expect(resolveRoute([{ ...primary, model: "claude-opus-anything" }], "primary", env)).toEqual({ ok: false, reason: "not_allowlisted" });
    expect(resolveRoute([{ ...primary, provider: "evilcorp", model: "x" }], "primary", env)).toEqual({ ok: false, reason: "not_allowlisted" });
    expect(resolveRoute([{ ...primary, provider: "openai", model: "gpt-anything" }], "primary", env)).toEqual({ ok: false, reason: "not_allowlisted" });
  });

  it("prototype keys cannot sneak past the allowlist", () => {
    expect(allowedModel("anthropic", "constructor")).toBeNull();
    expect(allowedModel("__proto__", "x")).toBeNull();
  });

  it("disabled tiers and missing credentials resolve to nothing", () => {
    const fallback: RouteRow = { tier: "fallback", provider: null, model: null, enabled: false, max_output_tokens: 1024, timeout_ms: 20000 };
    expect(resolveRoute([primary, fallback], "fallback", env)).toEqual({ ok: false, reason: "disabled" });
    expect(resolveRoute([primary], "primary", {})).toEqual({ ok: false, reason: "missing_credentials" });
    expect(resolveRoute([], "primary", env)).toEqual({ ok: false, reason: "no_route" });
  });

  it("resolves the approved primary route with its key from env (never from the DB)", () => {
    const r = resolveRoute([primary], "primary", env);
    expect(r.ok && r.route.apiKey).toBe("test-key");
    expect(r.ok && r.route.model).toBe("claude-haiku-5-5");
  });

  it("isGatewayConfigured needs both the provider key and the metering key", () => {
    expect(isGatewayConfigured({ AI_PROVIDER_ANTHROPIC_KEY: "x" })).toBe(false);
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

describe("gateway runModel", () => {
  it("reserves budget, calls the provider, records usage and releases the reservation", async () => {
    const { service, calls } = fakeService();
    const provider: AIProvider = { name: "anthropic", complete: vi.fn(async () => ({ content: [{ type: "tool_use" as const, id: "t", name: "search_customers", input: {} }], stopReason: "tool_use" as const, usage: { inputTokens: 120, outputTokens: 30 } })) };
    const r = await runModel(call, { service, env, providerFor: () => provider, now: () => 1000 });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual(["ai_begin_request", "ai_record_usage", "ai_finish_request"]);
    const rec = calls[1]!.args;
    expect(rec).toMatchObject({ p_provider: "anthropic", p_model: "claude-haiku-5-5", p_tier: "primary", p_input_tokens: 120, p_output_tokens: 30, p_outcome: "ok", p_tool_name: "search_customers" });
    expect(calls[0]!.args).toMatchObject({ p_category: "chat", p_user_id: "u", p_organisation_id: "org" });
    expect(rec).not.toHaveProperty("p_cost_usd"); // cost is computed in the DB, never by the app
  });

  it("does not call the provider when the budget/rate check blocks", async () => {
    const { service, calls } = fakeService({ begin: { allowed: false, reason: "hard_limit" } });
    const complete = vi.fn();
    const r = await runModel(call, { service, env, providerFor: () => ({ name: "anthropic", complete }), now: () => 0 });
    expect(r).toEqual({ ok: false, code: "blocked", reason: "hard_limit" });
    expect(complete).not.toHaveBeenCalled();
    expect(calls.map((c) => c.fn)).toEqual(["ai_begin_request"]);
  });

  it("provider outage fails gracefully, is metered as unavailable, and never falls back to another provider", async () => {
    const { service, calls } = fakeService({ routes: [primary, { tier: "fallback", provider: "openai", model: "gpt-x", enabled: true, max_output_tokens: 1024, timeout_ms: 1000 }] });
    const providerFor = vi.fn(() => ({ name: "anthropic", complete: async () => { throw new ProviderError("unavailable", "down", 503); } }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runModel(call, { service, env: { ...env, AI_PROVIDER_OPENAI_KEY: "k" }, providerFor, now: () => 0 });
    errSpy.mockRestore();
    expect(r).toMatchObject({ ok: false, code: "unavailable" });
    expect(providerFor).toHaveBeenCalledTimes(1);
    expect(calls.find((c) => c.fn === "ai_record_usage")!.args).toMatchObject({ p_outcome: "provider_unavailable", p_input_tokens: 0 });
    expect(calls.find((c) => c.fn === "ai_finish_request")!.args).toMatchObject({ p_status: "failed" });
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

describe("Anthropic adapter", () => {
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
