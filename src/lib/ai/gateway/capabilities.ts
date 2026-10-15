import "server-only";
import { z } from "zod";
import { runModel, type GatewayDeps, type GatewayFailure } from "./gateway";

/**
 * PROVIDER-NEUTRAL CAPABILITIES. Application features call these (or the orchestrator),
 * never a provider adapter. Every call goes through runModel → allowlist, metering, limits.
 *
 *   generate()      free-text answer (summaries, replies)
 *   extract()       structured data validated by a zod schema (receipts, quote/invoice instructions, leads)
 *   classify()      one label from a fixed list (message/lead classification, intent)
 *   selectTool / executeIntent → src/lib/ai/orchestrator.ts (tool registry + READ/DRAFT/CONSEQUENTIAL)
 *
 * The model only INTERPRETS. Anything extracted is a proposal that deterministic code must
 * validate (zod here, then domain services/RLS) before it can become a record.
 */
export interface CapabilityScope {
  organisationId: string;
  userId: string;
  /** Analytics category recorded in ai_usage_events, e.g. "extract.receipt". */
  category: string;
}

export type CapabilityResult<T> = { ok: true; data: T } | GatewayFailure | { ok: false; code: "invalid_output"; reason: string };

const MAX_INPUT_CHARS = 12_000;

export async function generate(
  scope: CapabilityScope,
  args: { instructions: string; input: string },
  deps?: Partial<GatewayDeps>,
): Promise<CapabilityResult<string>> {
  const r = await runModel(
    {
      ...scope,
      system: args.instructions,
      messages: [{ role: "user", content: [{ type: "text", text: args.input.slice(0, MAX_INPUT_CHARS) }] }],
      tools: [],
    },
    deps,
  );
  if (!r.ok) return r;
  const text = r.response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
  return text ? { ok: true, data: text } : { ok: false, code: "invalid_output", reason: "empty" };
}

/** Parse model text as JSON and validate it. Pure — exported for tests. */
export function parseStructured<T>(schema: z.ZodType<T>, text: string): { ok: true; data: T } | { ok: false; code: "invalid_output"; reason: string } {
  let raw: unknown;
  try {
    // Tolerate a fenced block from providers without native structured output.
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return { ok: false, code: "invalid_output", reason: "not_json" };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, code: "invalid_output", reason: "schema_mismatch" };
}

export async function extract<T>(
  scope: CapabilityScope,
  args: { name: string; schema: z.ZodType<T>; instructions: string; input: string },
  deps?: Partial<GatewayDeps>,
): Promise<CapabilityResult<T>> {
  const jsonSchema = z.toJSONSchema(args.schema, { io: "input" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const r = await runModel(
    {
      ...scope,
      system: `${args.instructions}\nReturn ONLY JSON matching the schema. Use null for anything not stated. Never calculate totals or tax.`,
      messages: [{ role: "user", content: [{ type: "text", text: args.input.slice(0, MAX_INPUT_CHARS) }] }],
      tools: [],
      responseFormat: { name: args.name, schema: jsonSchema },
    },
    deps,
  );
  if (!r.ok) return r;
  const text = r.response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return parseStructured(args.schema, text);
}

export async function classify<L extends string>(
  scope: CapabilityScope,
  args: { labels: readonly [L, ...L[]]; instructions: string; input: string },
  deps?: Partial<GatewayDeps>,
): Promise<CapabilityResult<L>> {
  const schema = z.object({ label: z.enum(args.labels) });
  const r = await extract(scope, { name: "classification", schema, instructions: args.instructions, input: args.input }, deps);
  return r.ok ? { ok: true, data: r.data.label as L } : r;
}
