/**
 * Unit tests are hermetic (SECURITY.md §6.1). They also run inside the Vercel build (`prebuild`), where the
 * real server secrets are present in the environment. So: strip every secret, and block real network calls,
 * so no test can ever send a production credential anywhere.
 */
for (const k of Object.keys(process.env)) {
  if (/SECRET|SERVICE_ROLE|_TOKEN$|^AI_PROVIDER_|^OPENAI|^ANTHROPIC|^VERCEL_OIDC|^SUPABASE_DB_URL/.test(k)) delete process.env[k];
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(`Network access blocked in unit tests: ${url.hostname}. Inject a fetch stub instead.`);
  }
  return realFetch(input, init);
}) as typeof fetch;
