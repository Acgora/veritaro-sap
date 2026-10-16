import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static security gate (SECURITY.md §6). Runs in `npm test` and in `prebuild`, so a failing check
 * blocks the Vercel production build as well as CI.
 */
/** Tracked files via git; on build machines without .git (e.g. Vercel), walk the source tree instead. */
function listFiles(): string[] {
  try {
    return execFileSync("git", ["ls-files"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  } catch {
    const skip = new Set(["node_modules", ".next", ".git", ".vercel", "test-results", ".parity-build"]);
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(path.relative(".", p).split(path.sep).join("/"));
      }
    };
    walk(".");
    return out.filter((f) => !/(^|\/)\.env(\.local|\.development|\.production)?$/.test(f)); // local env files are git-ignored, never deployed
  }
}
const tracked = listFiles();
const textFiles = tracked.filter((f) => /\.(ts|tsx|js|mjs|cjs|json|sql|md|yml|yaml|sh|env\.example|toml)$|^\.env/.test(f) && !f.endsWith("package-lock.json"));
const src = tracked.filter((f) => f.startsWith("src/") && /\.(ts|tsx)$/.test(f));
const read = (f: string) => readFileSync(f, "utf8");

const SECRET_PATTERNS: [string, RegExp][] = [
  ["GitHub token", /\b(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})\b/],
  ["OpenAI key", /\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{10,}\b/],
  ["JWT (service role?)", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

describe("secrets never enter source control", () => {
  it.each(SECRET_PATTERNS)("no %s in tracked files", (_name, re) => {
    const hits = textFiles.filter((f) => re.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("no real .env file is tracked", () => {
    expect(tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example"))).toEqual([]);
  });
});

describe("server-only credentials never reach the browser", () => {
  it("no NEXT_PUBLIC_ variable carries a secret", () => {
    const bad = src.flatMap((f) => [...read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)].map((m) => m[0]))
      .filter((v) => /SECRET|SERVICE|PRIVATE|TOKEN|OPENAI|ANTHROPIC|_KEY$/.test(v) && v !== "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect([...new Set(bad)]).toEqual([]);
  });

  it("client components never import the service-role client or read server secrets", () => {
    const client = src.filter((f) => /^\s*["']use client["']/m.test(read(f)));
    const bad = client.filter((f) => /supabase\/service|SUPABASE_SECRET_KEY|AI_PROVIDER_|gateway\/gateway/.test(read(f)));
    expect(bad).toEqual([]);
  });

  it("the service-role client is server-only and used only by the reviewed AI metering modules", () => {
    expect(read("src/lib/supabase/service.ts")).toMatch(/^import "server-only";/);
    const users = src.filter((f) => f !== "src/lib/supabase/service.ts" && /@\/lib\/supabase\/service/.test(read(f)));
    expect(users.sort()).toEqual(["src/lib/ai/gateway/diagnostics.ts", "src/lib/ai/gateway/gateway.ts"]);
  });

  it("SUPABASE_SECRET_KEY appears only in the service client and the configuration checks", () => {
    const readers = src.filter((f) => /process\.env\.SUPABASE_SECRET_KEY|SUPABASE_SECRET_KEY/.test(read(f)));
    // gateway.ts and diagnostics.ts only check that it is SET (configuration check); they never log or return it.
    expect(readers.sort()).toEqual(["src/lib/ai/gateway/diagnostics.ts", "src/lib/ai/gateway/gateway.ts", "src/lib/supabase/service.ts"]);
  });
});

describe("migrations never disable RLS or open storage", () => {
  const migrations = tracked.filter((f) => f.startsWith("supabase/migrations/") && f.endsWith(".sql"));
  const sql = (f: string) => read(f).replace(/--[^\n]*/g, "");
  it.each([
    ["disable row level security", /disable\s+row\s+level\s+security/i],
    ["public bucket", /insert\s+into\s+storage\.buckets[^;]*\btrue\b/i],
    ["grant to anon", /grant\s+[^;]*\bto\s+[^;]*\banon\b/i],
  ])("no migration does: %s", (_n, re) => {
    expect(migrations.filter((f) => re.test(sql(f)))).toEqual([]);
  });
});
