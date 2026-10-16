/**
 * Error handling: never surface raw Supabase/Postgres errors to end users.
 * Domain services return ActionResult; UI shows `error` via toast/inline message.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string, fieldErrors?: Record<string, string[] | undefined>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

interface PgLikeError {
  code?: string;
  message?: string;
}

// Messages raised deliberately by our own DB guards are safe to show verbatim.
const SAFE_DB_MESSAGES = [
  "You cannot add yourself to an organisation",
  "Only an owner can grant the owner role",
  "Membership organisation and user cannot be changed",
  "You cannot change your own role or status",
  "Only an owner can grant or remove the owner role",
  "Only an owner can change another owner's status",
  "An organisation must keep at least one active owner",
  "Only an owner can remove an owner",
  "A task cannot move between organisations",
  "Assignee is not an active member of this organisation",
  "You do not have permission to assign tasks to others",
  "Organisation limit reached",
  // Phase 003 lifecycle guards (raised by our own RPCs/triggers with human wording)
  "A completed job cannot be cancelled",
  "A conversation cannot move between organisations",
  "A job can only be created from an accepted quote for the same customer",
  "A job's quote cannot be changed",
  "A lead cannot move between organisations",
  "A line cannot move to another invoice",
  "A line cannot move to another quote",
  "AI request is not open",
  "Add at least one line before issuing the invoice",
  "Add at least one line before issuing the quote",
  "An invoice cannot move between organisations",
  "An invoice's job or quote cannot be changed",
  "Assignee is not an active member of this organisation",
  "Complete the job before invoicing it",
  "Contact does not belong to the linked customer",
  "Contact does not belong to this customer",
  "Customer not found in this organisation",
  "Generated documents cannot be changed",
  "Give a reason for reversing the payment",
  "Give a reason for voiding the invoice",
  "Inbound channel messages can only come from a connected integration",
  "Invalid acceptance method",
  "Invalid job action",
  "Invalid quote outcome",
  "Invalid send method",
  "Invoice not found",
  "Invoice totals are calculated automatically",
  "Job not found",
  "Job number and organisation cannot be changed",
  "Lead not found",
  "Linked record not found in this organisation",
  "Messages cannot be changed",
  "No messaging channel is connected yet",
  "Not a member of this organisation",
  "Only a completed job can be reopened",
  "Only a draft's text can be edited",
  "Only a scheduled or unscheduled job can be started",
  "Only a sent quote can be accepted or declined",
  "Only a sent quote can be marked viewed",
  "Only an accepted quote can be invoiced",
  "Only an accepted quote can become a job",
  "Only an issued invoice can be voided. Archive a draft instead",
  "Only draft invoices can be changed",
  "Only draft quotes can be changed. Duplicate the quote to revise it.",
  "Only draft, paid or void invoices can be archived",
  "Payment not found",
  "Payments can only be recorded against an issued, unpaid invoice",
  "Payments cannot be changed",
  "Payments cannot be deleted. Reverse the payment instead",
  "Quote not found",
  "Quote number and organisation cannot be changed",
  "Quote totals are calculated automatically",
  "Site does not belong to the linked customer",
  "Site does not belong to this customer",
  "That is more than the",
  "The invoice total must be more than zero",
  "The payment amount must be more than zero",
  "This invoice has been issued and can no longer be edited",
  "This job cannot be completed",
  "This job has been invoiced and cannot be reopened",
  "This job is cancelled",
  "This job is closed and can no longer be edited",
  "This quote has been issued and can no longer be edited. Duplicate it to make a revision.",
  "This quote has expired. Duplicate it to re-issue with a new expiry date",
  "Unsupported related entity type:",
  "Use the invoice actions to change its status",
  "Use the job actions to start, complete or cancel a job",
  "Use the quote actions to change its status",
  "Void the payments on this invoice first",
  "You do not have permission to do that",
];

export function toUserMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!error || typeof error !== "object") return fallback;
  const { code, message } = error as PgLikeError;

  if (message) {
    const safe = SAFE_DB_MESSAGES.find((m) => message.includes(m));
    if (safe) {
      // Our own guard messages are written for users; show the full sentence (it may carry an amount).
      const full = message.length <= 200 ? message : safe;
      return /[.!?]$/.test(full) ? full : `${full}.`;
    }
    if (message.startsWith("Invalid timezone")) return "Please choose a valid timezone.";
  }

  switch (code) {
    case "42501":
      return "You don't have permission to do that.";
    case "23505":
      return "That already exists.";
    case "23503":
      return "This refers to something that no longer exists.";
    case "23514":
    case "22023":
    case "22P02":
      return "Some of the information isn't valid. Please check and try again.";
    case "PGRST116":
      return "We couldn't find that record, or you no longer have access to it.";
    case "54000":
      return "You've reached the limit for this action.";
    default:
      return fallback;
  }
}

/** Server-side logging that never prints tokens or secrets. */
export function logServerError(context: string, error: unknown) {
  const e = error as PgLikeError & { details?: string; hint?: string };
  console.error(`[${context}]`, { code: e?.code, message: e?.message, details: e?.details, hint: e?.hint });
}
