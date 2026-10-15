import type { ServiceContext } from "@/domain/context";
import { ACTION_CLASS_POLICY, type ConfirmationGrant, type ToolExecutionOutcome } from "./types";
import { findPlannedTool, findTool } from "./registry";

/** Deterministic fingerprint of validated input (key-order independent). */
export function fingerprint(toolName: string, input: unknown): string {
  const canonical = (v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
      : Array.isArray(v)
        ? v.map(canonical)
        : v;
  const text = `${toolName}:${JSON.stringify(canonical(input))}`;
  let h = 0x811c9dc5; // FNV-1a 32-bit
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * The ONLY entry point through which AI may perform actions.
 * Enforces: known tool → valid input → permissions → safety class → execute via domain service.
 * The fingerprint is a UX consistency check (approved input == executed input); it is not a
 * security token — authorisation is permissions + RLS.
 */
export async function executeTool(
  ctx: ServiceContext,
  toolName: string,
  rawInput: unknown,
  confirmation?: ConfirmationGrant,
): Promise<ToolExecutionOutcome> {
  const tool = findTool(toolName);
  if (!tool) {
    if (findPlannedTool(toolName)) return { status: "not_implemented", reason: `“${toolName}” is planned for a future phase.` };
    return { status: "unknown_tool", reason: `Unknown tool “${toolName}”.` };
  }

  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) return { status: "invalid_input", reason: "The request was missing or had invalid details." };

  const missing = tool.requiredPermissions.filter((p) => !ctx.permissions.can(p));
  const anyOk = !tool.requiredAnyOf || tool.requiredAnyOf.some((p) => ctx.permissions.can(p));
  if (missing.length > 0 || !anyOk) return { status: "denied", reason: "You don't have permission to do that." };

  if (ACTION_CLASS_POLICY[tool.actionClass].requiresConfirmation) {
    const fp = fingerprint(tool.name, parsed.data);
    const valid =
      confirmation &&
      confirmation.toolName === tool.name &&
      confirmation.inputFingerprint === fp &&
      confirmation.confirmedByUserId === ctx.userId;
    if (!valid) {
      const summary = tool.describe ? await tool.describe(ctx, parsed.data).catch(() => tool.summarise(parsed.data)) : tool.summarise(parsed.data);
      return { status: "needs_confirmation", actionClass: "consequential", summary, inputFingerprint: fp, input: parsed.data as Record<string, unknown> };
    }
  }

  const aiCtx: ServiceContext = { ...ctx, actor: "ai" };
  const result = await tool.execute(aiCtx, parsed.data);
  if (!result.ok) return { status: "error", reason: result.error };
  const card = tool.card ? tool.card(parsed.data, result.data) : null;
  return { status: "executed", actionClass: tool.actionClass, result: result.data, card };
}
