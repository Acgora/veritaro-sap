import { allowedModel, isAllowedProvider, PROVIDER_ALLOWLIST } from "./allowlist";
import type { ModelTier } from "./types";

export interface RouteRow {
  tier: string;
  provider: string | null;
  model: string | null;
  enabled: boolean;
  max_output_tokens: number;
  timeout_ms: number;
}

export interface ResolvedRoute {
  tier: ModelTier;
  provider: keyof typeof PROVIDER_ALLOWLIST;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxOutputTokens: number;
  maxInputTokens: number;
  timeoutMs: number;
}

export type RouteResolution =
  | { ok: true; route: ResolvedRoute }
  | { ok: false; reason: "no_route" | "disabled" | "not_allowlisted" | "missing_credentials" };

/**
 * Resolve a tier to a callable route. The DB row chooses; the code allowlist decides.
 * Pure (env is injected) so it is unit-tested exhaustively.
 */
export function resolveRoute(rows: RouteRow[], tier: ModelTier, env: Record<string, string | undefined>): RouteResolution {
  const row = rows.find((r) => r.tier === tier);
  if (!row) return { ok: false, reason: "no_route" };
  if (!row.enabled || !row.provider || !row.model) return { ok: false, reason: "disabled" };
  const allowed = allowedModel(row.provider, row.model);
  if (!allowed || !isAllowedProvider(row.provider)) return { ok: false, reason: "not_allowlisted" };
  const spec = PROVIDER_ALLOWLIST[row.provider];
  const apiKey = env[spec.envKey]?.trim();
  if (!apiKey) return { ok: false, reason: "missing_credentials" };
  const baseUrl = spec.baseUrlEnv ? env[spec.baseUrlEnv]?.trim() || undefined : undefined;
  return {
    ok: true,
    route: {
      tier,
      provider: row.provider,
      model: row.model,
      apiKey,
      baseUrl,
      maxOutputTokens: Math.min(row.max_output_tokens, 4096),
      maxInputTokens: allowed.maxInputTokens,
      timeoutMs: row.timeout_ms,
    },
  };
}

/** V1 policy: only the primary tier is ever used; fallback stays disabled (approved D9). */
export const FALLBACK_ENABLED_IN_V1 = false;
