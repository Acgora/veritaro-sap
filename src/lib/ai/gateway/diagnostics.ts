import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { PROVIDER_ALLOWLIST, activeProviders } from "./allowlist";
import { resolveRoute, type RouteRow } from "./router";

/**
 * Configuration self-check for owners/admins (Settings → AI usage).
 * Reports only booleans and reason codes — never key values, lengths or prefixes.
 * The provider check is a free metadata request (GET /v1/models/{model}); no tokens are billed.
 */
export interface AICheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

const looksLikeSecret = (k: string) => k.startsWith("sb_secret_") || k.split(".").length === 3;

export async function runAIDiagnostics(env: Record<string, string | undefined> = process.env): Promise<AICheck[]> {
  const checks: AICheck[] = [];
  const secret = env.SUPABASE_SECRET_KEY?.trim() ?? "";

  checks.push({
    id: "secret_present",
    label: "SUPABASE_SECRET_KEY is set",
    ok: !!secret,
    detail: secret ? "Found." : "Missing in this deployment. Add it in Vercel (Production), then redeploy.",
  });
  if (secret && secret.startsWith("sb_publishable_")) {
    checks.push({ id: "secret_kind", label: "SUPABASE_SECRET_KEY is a secret key", ok: false, detail: "This is the publishable key. Use the sb_secret_… key from Supabase → Settings → API Keys." });
  } else if (secret && !looksLikeSecret(secret)) {
    checks.push({ id: "secret_kind", label: "SUPABASE_SECRET_KEY looks valid", ok: false, detail: "The value doesn't look like a Supabase secret key. Re-copy it (no quotes or spaces)." });
  }

  let rows: RouteRow[] | null = null;
  if (secret) {
    const svc = createServiceClient();
    const { data, error } = svc
      ? await svc.from("ai_model_routes").select("tier, provider, model, enabled, max_output_tokens, timeout_ms, reasoning_effort")
      : { data: null, error: { message: "no client" } };
    rows = error ? null : ((data ?? []) as RouteRow[]);
    checks.push({
      id: "secret_works",
      label: "Server can read AI settings from Supabase",
      ok: !error,
      detail: error ? "Supabase rejected the secret key. Re-copy SUPABASE_SECRET_KEY from Supabase → Settings → API Keys, then redeploy." : "Connected.",
    });
  }

  for (const p of activeProviders()) {
    const spec = PROVIDER_ALLOWLIST[p];
    const key = env[spec.envKey]?.trim() ?? "";
    checks.push({
      id: `${p}_key_present`,
      label: `${spec.envKey} is set`,
      ok: !!key,
      detail: key ? "Found." : "Missing in this deployment. Add it in Vercel (Production, Sensitive), then redeploy.",
    });
  }

  if (rows) {
    const r = resolveRoute(rows, "primary", env);
    checks.push({
      id: "route",
      label: "Primary model route",
      ok: r.ok,
      detail: r.ok ? `${r.route.provider} / ${r.route.model} (reasoning ${r.route.reasoningEffort ?? "n/a"})` : `Not usable: ${r.reason.replace(/_/g, " ")}.`,
    });
    if (r.ok && r.route.adapter === "openai_responses") {
      let detail = "";
      let ok = false;
      try {
        const res = await fetch(`${r.route.baseUrl}/v1/models/${encodeURIComponent(r.route.model)}`, {
          headers: { authorization: `Bearer ${r.route.apiKey}` },
          signal: AbortSignal.timeout(8000),
          cache: "no-store",
        });
        ok = res.ok;
        detail = res.ok
          ? "OpenAI accepted the key and the model is available to this account."
          : res.status === 401
            ? "OpenAI rejected the key (401). Create a new key and replace AI_PROVIDER_OPENAI_KEY."
            : res.status === 403
              ? "The key has no access to this model or the Models API (403). Check the key's permissions / project."
              : res.status === 404
                ? "This OpenAI account can't see gpt-6-luna (404)."
                : res.status === 429
                  ? "OpenAI says quota/billing limit reached (429). Add credit in OpenAI → Billing."
                  : `OpenAI returned ${res.status}.`;
      } catch {
        detail = "Couldn't reach OpenAI from the server (network/timeout).";
      }
      checks.push({ id: "provider_live", label: "OpenAI key works", ok, detail });
    }
  }
  return checks;
}

/** One real, metered, tiny model call (≈100 tokens, a fraction of a US cent) — only when an owner clicks "Run live test". */
export async function runLiveTest(organisationId: string, userId: string): Promise<AICheck> {
  const { runModel } = await import("./gateway");
  const r = await runModel({
    organisationId, userId, category: "diagnostic", system: "Reply with the single word OK.",
    messages: [{ role: "user", content: [{ type: "text", text: "Test" }] }], tools: [],
  });
  if (r.ok) return { id: "live", label: "Live test call", ok: true, detail: `Success via ${r.provider} / ${r.model}. The assistant is working.` };
  if (r.code === "blocked") return { id: "live", label: "Live test call", ok: false, detail: `Blocked by limits: ${r.reason.replace(/_/g, " ")}.` };
  if (r.code === "not_configured") return { id: "live", label: "Live test call", ok: false, detail: r.reason };
  const pe = r.providerError;
  const why =
    pe?.status === 401 ? "OpenAI rejected the key (401) — replace AI_PROVIDER_OPENAI_KEY."
    : pe?.status === 429 ? "OpenAI refused: rate limit or no credit/quota (429) — add credit in OpenAI → Billing."
    : pe?.status === 404 ? "Model not available to this OpenAI account (404)."
    : pe?.status === 400 ? "OpenAI rejected the request (400)."
    : pe?.kind === "timeout" ? "OpenAI timed out."
    : `Provider error${pe?.status ? ` (${pe.status})` : ""}.`;
  return { id: "live", label: "Live test call", ok: false, detail: why };
}
