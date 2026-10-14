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
];

export function toUserMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!error || typeof error !== "object") return fallback;
  const { code, message } = error as PgLikeError;

  if (message) {
    const safe = SAFE_DB_MESSAGES.find((m) => message.includes(m));
    if (safe) return safe.endsWith(".") ? safe : `${safe}.`;
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
