import type { z } from "zod";
import type { ServiceContext } from "@/domain/context";
import type { ActionResult } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";

/**
 * AI ACTION SAFETY MODEL — every AI tool MUST declare one class.
 *
 *  READ          Reads data. May execute without confirmation.
 *                e.g. "How much does ABC owe?"
 *  DRAFT         Creates/edits records in a non-final state (draft invoice, task,
 *                unsent message). May execute without confirmation but must NEVER
 *                send, post, or finalise anything.
 *  CONSEQUENTIAL Leaves the system or is hard to undo: send invoice/email/WhatsApp,
 *                delete records, issue credit notes, modify posted financial records.
 *                ALWAYS requires explicit user confirmation for the exact input.
 *
 * Autonomous consequential actions are prohibited.
 */
export const ACTION_CLASSES = ["read", "draft", "consequential"] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

export const ACTION_CLASS_POLICY: Record<ActionClass, { requiresConfirmation: boolean; description: string }> = {
  read: { requiresConfirmation: false, description: "Reads information. Runs immediately." },
  draft: { requiresConfirmation: false, description: "Prepares a draft you can review. Never sends or finalises." },
  consequential: { requiresConfirmation: true, description: "Changes or sends something important. Requires your confirmation." },
};

export interface AIToolDefinition<TSchema extends z.ZodType = z.ZodType, TOutput = unknown> {
  /** snake_case verb_noun, stable — used by the model and in ai_actions logs. */
  name: string;
  description: string;
  actionClass: ActionClass;
  /** User must hold ALL of these (checked before execution; RLS still applies). */
  requiredPermissions: Permission[];
  /** …and at least ONE of these, when set (e.g. customers.read OR customers.read_linked). */
  requiredAnyOf?: Permission[];
  inputSchema: TSchema;
  /** Must call the SAME domain service the UI uses. Never re-implement logic here. */
  execute: (ctx: ServiceContext, input: z.output<TSchema>) => Promise<ActionResult<TOutput>>;
  /** Human-readable preview shown in the confirmation dialog. */
  summarise: (input: z.output<TSchema>) => string;
  /** Optional richer preview built from real data (e.g. the customer's actual name). */
  describe?: (ctx: ServiceContext, input: z.output<TSchema>) => Promise<string>;
  /** Optional UI card for a successful result (link + undo). */
  card?: (input: z.output<TSchema>, output: TOutput) => AICard | null;
  /**
   * Records this result touched — kept as conversation context so follow-ups like
   * "add a line to that quote" or "invoice them" resolve without repeating names.
   */
  focus?: (input: z.output<TSchema>, output: TOutput) => FocusRef[];
  /**
   * When this returns a reason, the tool cannot run in this deployment (e.g. no messaging channel).
   * Checked BEFORE asking for confirmation, so users are never asked to approve something that cannot happen.
   */
  unavailable?: (ctx: ServiceContext) => string | null;
}

export type FocusEntity = "customer" | "lead" | "quote" | "job" | "invoice";

export interface FocusRef {
  type: FocusEntity;
  id: string;
  /** Short human label (number or name). DB data — always framed as data in prompts. */
  label: string;
}

export interface AICard {
  label: string;
  href: string;
  undo?: { kind: "customer" | "task"; id: string };
}

/** Capabilities from the product spec that are designed but NOT implemented. */
export interface PlannedTool {
  name: string;
  actionClass: ActionClass;
  phase: "future";
  description: string;
}

export interface ConfirmationGrant {
  toolName: string;
  /** Stable hash of the exact validated input the user saw and approved. */
  inputFingerprint: string;
  confirmedByUserId: string;
}

export type ToolExecutionOutcome<T = unknown> =
  | { status: "executed"; actionClass: ActionClass; result: T; card?: AICard | null; focus?: FocusRef[] }
  | { status: "needs_confirmation"; actionClass: "consequential"; summary: string; inputFingerprint: string; input: Record<string, unknown> }
  | { status: "denied"; reason: string }
  | { status: "invalid_input"; reason: string }
  | { status: "unknown_tool"; reason: string }
  | { status: "not_implemented"; reason: string }
  | { status: "error"; reason: string };
