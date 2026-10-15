import "server-only";

/**
 * SERVER-SIDE ALLOWLIST — the only providers/models the app will ever call.
 *
 * The database (ai_model_routes) may choose WHICH of these is active for a tier,
 * but a DB value naming anything not listed here is refused. Adding a model is a
 * code change + review + deploy, by design.
 *
 * Credentials: each provider names the Vercel env var holding its key. Keys are
 * read only on the server and never stored in the database, logs or prompts.
 */
export interface AllowedModel {
  /** Hard cap on prompt size we will send (stays inside the cheaper pricing tier). */
  maxInputTokens: number;
}

export interface AllowedProvider {
  envKey: string;
  /** Optional base-URL override env var (tests / private gateways). Never read from the DB. */
  baseUrlEnv?: string;
  models: Record<string, AllowedModel>;
}

export const PROVIDER_ALLOWLIST = {
  anthropic: {
    envKey: "AI_PROVIDER_ANTHROPIC_KEY",
    baseUrlEnv: "AI_PROVIDER_ANTHROPIC_BASE_URL",
    models: {
      "claude-haiku-5-5": { maxInputTokens: 20_000 },
    },
  },
  // Second-provider interface exists (providers/openai-compatible.ts) but NO models are
  // approved, so it can never be selected. Approve explicitly before enabling (POPIA: new processor).
  openai: {
    envKey: "AI_PROVIDER_OPENAI_KEY",
    baseUrlEnv: "AI_PROVIDER_OPENAI_BASE_URL",
    models: {},
  },
} as const satisfies Record<string, AllowedProvider>;

export type AllowedProviderName = keyof typeof PROVIDER_ALLOWLIST;

export function isAllowedProvider(name: string): name is AllowedProviderName {
  return Object.prototype.hasOwnProperty.call(PROVIDER_ALLOWLIST, name);
}

export function allowedModel(provider: string, model: string): AllowedModel | null {
  if (!isAllowedProvider(provider)) return null;
  const models = PROVIDER_ALLOWLIST[provider].models as Record<string, AllowedModel>;
  return Object.prototype.hasOwnProperty.call(models, model) ? models[model]! : null;
}
