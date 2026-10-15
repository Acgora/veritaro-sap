import "server-only";
import { createServiceClient, type ServiceSupabase } from "@/lib/supabase/service";
import { logServerError } from "@/lib/errors";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import { resolveRoute, type ResolvedRoute, type RouteRow } from "./router";
import { ProviderError, type AIProvider, type ChatMessage, type ModelTier, type ProviderResponse, type ToolSpec } from "./types";

export type GatewayFailure =
  | { ok: false; code: "not_configured"; reason: string }
  | { ok: false; code: "blocked"; reason: string }
  | { ok: false; code: "unavailable"; reason: string };

export type GatewayResult = { ok: true; response: ProviderResponse; provider: string; model: string } | GatewayFailure;

export interface ModelCall {
  organisationId: string;
  userId: string;
  tier?: ModelTier;
  /** Analytics category, e.g. "chat". */
  category: string;
  /** Tool the model is expected to drive this turn, when known (analytics). */
  toolName?: string | null;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
}

/** Rough, conservative token estimate (≈3 chars/token) used ONLY for budget reservation. */
export function estimateInputTokens(call: Pick<ModelCall, "system" | "messages" | "tools">): number {
  const chars = call.system.length + JSON.stringify(call.messages).length + JSON.stringify(call.tools).length;
  return Math.ceil(chars / 3) + 50;
}

export interface GatewayDeps {
  service: ServiceSupabase | null;
  env: Record<string, string | undefined>;
  providerFor: (route: ResolvedRoute) => AIProvider;
  now: () => number;
}

export function defaultProviderFor(route: ResolvedRoute): AIProvider {
  switch (route.provider) {
    case "anthropic":
      return new AnthropicProvider(route.apiKey, route.baseUrl);
    case "openai":
      return new OpenAICompatibleProvider(route.apiKey, route.baseUrl);
  }
}

/**
 * The single entry point to any LLM. Order: config → route (allowlist) → budget/rate
 * reservation (DB) → provider call (timeout) → usage record (DB computes cost) → release.
 * Any failure returns a typed result; it never throws into the app.
 */
export async function runModel(call: ModelCall, deps?: Partial<GatewayDeps>): Promise<GatewayResult> {
  const d: GatewayDeps = {
    service: deps?.service !== undefined ? deps.service : createServiceClient(),
    env: deps?.env ?? process.env,
    providerFor: deps?.providerFor ?? defaultProviderFor,
    now: deps?.now ?? Date.now,
  };
  if (!d.service) return { ok: false, code: "not_configured", reason: "Server key for AI metering is not configured." };

  const { data: routes, error: routeError } = await d.service
    .from("ai_model_routes")
    .select("tier, provider, model, enabled, max_output_tokens, timeout_ms");
  if (routeError) {
    logServerError("ai.routes", routeError);
    return { ok: false, code: "unavailable", reason: "AI configuration could not be loaded." };
  }

  const tier = call.tier ?? "primary";
  const resolved = resolveRoute((routes ?? []) as RouteRow[], tier, d.env);
  if (!resolved.ok) {
    return { ok: false, code: "not_configured", reason: `AI ${tier} model unavailable (${resolved.reason}).` };
  }
  const route = resolved.route;

  const estInput = estimateInputTokens(call);
  if (estInput > route.maxInputTokens) {
    return { ok: false, code: "blocked", reason: "That request is too large for the assistant." };
  }

  const { data: begin, error: beginError } = await d.service.rpc("ai_begin_request", {
    p_organisation_id: call.organisationId,
    p_user_id: call.userId,
    p_provider: route.provider,
    p_model: route.model,
    p_category: call.category,
    p_est_input_tokens: estInput,
    p_max_output_tokens: route.maxOutputTokens,
  });
  if (beginError) {
    logServerError("ai.begin", beginError);
    return { ok: false, code: "unavailable", reason: "AI usage check failed." };
  }
  const b = begin as { allowed: boolean; reason?: string; request_id?: string };
  if (!b.allowed || !b.request_id) return { ok: false, code: "blocked", reason: b.reason ?? "blocked" };

  const started = d.now();
  let response: ProviderResponse | null = null;
  let outcome: "ok" | "error" | "timeout" | "provider_unavailable" = "ok";
  try {
    response = await d.providerFor(route).complete({
      model: route.model,
      system: call.system,
      messages: call.messages,
      tools: call.tools,
      maxOutputTokens: route.maxOutputTokens,
      timeoutMs: route.timeoutMs,
    });
  } catch (e) {
    const kind = e instanceof ProviderError ? e.kind : "unavailable";
    outcome = kind === "timeout" ? "timeout" : kind === "unavailable" || kind === "rate_limited" ? "provider_unavailable" : "error";
    logServerError("ai.provider", { code: kind, message: (e as Error).message });
  }

  const { error: recError } = await d.service.rpc("ai_record_usage", {
    p_request_id: b.request_id,
    p_provider: route.provider,
    p_model: route.model,
    p_tier: tier,
    // Analytics: the tool(s) the model chose in THIS response (falls back to the caller's hint).
    p_tool_name: toolsChosen(response) ?? call.toolName ?? undefined,
    p_input_tokens: response?.usage.inputTokens ?? 0,
    p_output_tokens: response?.usage.outputTokens ?? 0,
    p_latency_ms: Math.max(0, Math.round(d.now() - started)),
    p_outcome: outcome,
  });
  if (recError) logServerError("ai.record", recError);
  const { error: finError } = await d.service.rpc("ai_finish_request", { p_request_id: b.request_id, p_status: response ? "completed" : "failed" });
  if (finError) logServerError("ai.finish", finError);

  // No silent fallback to another provider (approved D9). Fail gracefully instead.
  if (!response) return { ok: false, code: "unavailable", reason: "The AI provider is unavailable right now." };
  return { ok: true, response, provider: route.provider, model: route.model };
}

function toolsChosen(r: ProviderResponse | null): string | null {
  const names = (r?.content ?? []).flatMap((b) => (b.type === "tool_use" ? [b.name] : []));
  return names.length ? [...new Set(names)].join(",").slice(0, 200) : null;
}

/** True when the server has everything needed to attempt an AI call. */
export function isGatewayConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.SUPABASE_SECRET_KEY?.trim() && !!env.AI_PROVIDER_ANTHROPIC_KEY?.trim();
}
