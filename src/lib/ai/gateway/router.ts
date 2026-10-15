import { allowedModel, isAllowedProvider, providerSpec, type AllowedProviderName, type ProviderAdapter } from "./allowlist";
import { REASONING_EFFORTS, type ModelTier, type ReasoningEffort } from "./types";

export interface RouteRow {
  tier: string;
  provider: string | null;
  model: string | null;
  enabled: boolean;
  max_output_tokens: number;
  timeout_ms: number;
  /** Optional (column added 2026-10-16). Null = model default from the allowlist (first approved / none). */
  reasoning_effort?: string | null;
}

export interface ResolvedRoute {
  tier: ModelTier;
  provider: AllowedProviderName;
  adapter: ProviderAdapter;
  model: string;
  apiKey: string;
  baseUrl: string;
  maxOutputTokens: number;
  maxInputTokens: number;
  timeoutMs: number;
  reasoningEffort?: ReasoningEffort;
}

export type RouteFailureReason =
  | "no_route"
  | "disabled"
  | "provider_disabled"
  | "not_allowlisted"
  | "missing_credentials"
  | "missing_endpoint";

export type RouteResolution = { ok: true; route: ResolvedRoute } | { ok: false; reason: RouteFailureReason };

/** Endpoints come from server env only. Plain http is accepted only for loopback (tests / local inference). */
export function safeBaseUrl(raw: string | undefined | null): string | null {
  const v = raw?.trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) return null;
  return v.replace(/\/+$/, "");
}

/**
 * Resolve a tier to a callable route. The DB row chooses; the code allowlist decides.
 * Pure (env is injected) so it is unit-tested exhaustively.
 */
export function resolveRoute(rows: RouteRow[], tier: ModelTier, env: Record<string, string | undefined>): RouteResolution {
  const row = rows.find((r) => r.tier === tier);
  if (!row) return { ok: false, reason: "no_route" };
  if (!row.enabled || !row.provider || !row.model) return { ok: false, reason: "disabled" };
  if (!isAllowedProvider(row.provider)) return { ok: false, reason: "not_allowlisted" };
  const spec = providerSpec(row.provider)!;
  if (spec.status !== "active") return { ok: false, reason: "provider_disabled" };
  const allowed = allowedModel(row.provider, row.model);
  if (!allowed) return { ok: false, reason: "not_allowlisted" };

  let reasoningEffort: ReasoningEffort | undefined;
  if (allowed.reasoningEfforts.length > 0) {
    const wanted = row.reasoning_effort ?? allowed.reasoningEfforts[0]!;
    if (!(REASONING_EFFORTS as readonly string[]).includes(wanted) || !allowed.reasoningEfforts.includes(wanted as ReasoningEffort)) {
      return { ok: false, reason: "not_allowlisted" };
    }
    reasoningEffort = wanted as ReasoningEffort;
  } else if (row.reasoning_effort) {
    return { ok: false, reason: "not_allowlisted" };
  }

  const apiKey = env[spec.envKey]?.trim();
  if (!apiKey) return { ok: false, reason: "missing_credentials" };
  const baseUrl = safeBaseUrl(env[spec.baseUrlEnv]) ?? (env[spec.baseUrlEnv]?.trim() ? null : spec.defaultBaseUrl);
  if (!baseUrl) return { ok: false, reason: "missing_endpoint" };

  return {
    ok: true,
    route: {
      tier,
      provider: row.provider,
      adapter: spec.adapter,
      model: row.model,
      apiKey,
      baseUrl,
      // Reasoning tokens count as output, so allow headroom but keep a hard cap.
      maxOutputTokens: Math.min(row.max_output_tokens, 4096),
      maxInputTokens: allowed.maxInputTokens,
      timeoutMs: row.timeout_ms,
      reasoningEffort,
    },
  };
}

/** V1 policy: only the primary tier is ever used; no automatic cross-provider fallback. */
export const FALLBACK_ENABLED_IN_V1 = false;
/** V1 policy: no automatic model routing (simple → self-hosted, complex → premium). */
export const AUTOMATIC_ROUTING_ENABLED_IN_V1 = false;
