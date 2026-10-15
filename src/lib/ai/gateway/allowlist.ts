import "server-only";
import type { ReasoningEffort } from "./types";

/**
 * SERVER-SIDE ALLOWLIST — the only providers, models and endpoints the app will ever call.
 *
 * The database (ai_model_routes) may choose WHICH approved model serves a tier, but:
 *   * a provider whose status is not "active" is refused (provider_disabled);
 *   * a provider/model not listed here is refused (not_allowlisted);
 *   * a reasoning effort not approved for that model is refused (not_allowlisted);
 *   * endpoints (base URLs) and credentials come ONLY from server env vars named here —
 *     never from the database.
 * Activating a provider or approving a model is a code change + review + deploy, by design.
 *
 * The current provider/model is a CONFIGURATION decision, not an architectural dependency:
 * application code talks to the gateway's neutral types, never to a vendor API.
 */
export interface AllowedModel {
  /** Hard cap on prompt size we will send (keeps requests small and in the cheapest pricing tier). */
  maxInputTokens: number;
  /** Reasoning efforts a route may request. Empty = model has no reasoning control (none is sent). */
  reasoningEfforts: readonly ReasoningEffort[];
}

/** Which adapter speaks to the provider. */
export type ProviderAdapter = "openai_responses" | "anthropic_messages" | "openai_compatible_chat";

export interface AllowedProvider {
  /** "active" = may be selected by a route. "disabled" = adapter kept, never called. */
  status: "active" | "disabled";
  adapter: ProviderAdapter;
  /** Env var holding the credential. */
  envKey: string;
  /** Env var holding the endpoint. Never read from the DB. */
  baseUrlEnv: string;
  /** Default endpoint; null means the env var is REQUIRED (self-hosted has no public default). */
  defaultBaseUrl: string | null;
  models: Record<string, AllowedModel>;
}

export const PROVIDER_ALLOWLIST = {
  // ACTIVE (V1). GPT-6 Luna handles all routine AI work. Approved 2026-10-15.
  openai: {
    status: "active",
    adapter: "openai_responses",
    envKey: "AI_PROVIDER_OPENAI_KEY",
    baseUrlEnv: "AI_PROVIDER_OPENAI_BASE_URL",
    defaultBaseUrl: "https://api.openai.com",
    models: {
      // 20K cap keeps every request far below the 272K long-context price tier.
      // xhigh/max are deliberately NOT approved (cost/latency); "high" only for future evaluation.
      "gpt-6-luna": { maxInputTokens: 20_000, reasoningEfforts: ["none", "low", "medium", "high"] },
    },
  },
  // DISABLED. Adapter kept and tested so it can be re-activated by config + deploy.
  anthropic: {
    status: "disabled",
    adapter: "anthropic_messages",
    envKey: "AI_PROVIDER_ANTHROPIC_KEY",
    baseUrlEnv: "AI_PROVIDER_ANTHROPIC_BASE_URL",
    defaultBaseUrl: "https://api.anthropic.com",
    models: {
      "claude-haiku-5-5": { maxInputTokens: 20_000, reasoningEfforts: [] },
    },
  },
  // DISABLED. Future self-hosted / open-weight inference (Llama, Qwen, Mistral …) behind an
  // OpenAI-compatible endpoint (vLLM, TGI, Ollama, llama.cpp server). To enable: approve model
  // ids here, set status "active", set AI_PROVIDER_SELFHOSTED_BASE_URL + _KEY, add a price row
  // (may be 0 or an amortised hosting cost), point a route at it. No business logic changes.
  selfhosted: {
    status: "disabled",
    adapter: "openai_compatible_chat",
    envKey: "AI_PROVIDER_SELFHOSTED_KEY",
    baseUrlEnv: "AI_PROVIDER_SELFHOSTED_BASE_URL",
    defaultBaseUrl: null,
    models: {},
  },
} as const satisfies Record<string, AllowedProvider>;

export type AllowedProviderName = keyof typeof PROVIDER_ALLOWLIST;

export function isAllowedProvider(name: string): name is AllowedProviderName {
  return Object.prototype.hasOwnProperty.call(PROVIDER_ALLOWLIST, name);
}

export function providerSpec(name: string): AllowedProvider | null {
  return isAllowedProvider(name) ? (PROVIDER_ALLOWLIST[name] as AllowedProvider) : null;
}

export function allowedModel(provider: string, model: string): AllowedModel | null {
  const spec = providerSpec(provider);
  if (!spec) return null;
  return Object.prototype.hasOwnProperty.call(spec.models, model) ? spec.models[model]! : null;
}

/** Providers the server may call right now. */
export function activeProviders(): AllowedProviderName[] {
  return (Object.keys(PROVIDER_ALLOWLIST) as AllowedProviderName[]).filter((p) => PROVIDER_ALLOWLIST[p].status === "active");
}
