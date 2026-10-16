import type { BadgeTone } from "@/components/common/status-badge";

/**
 * One status vocabulary for the whole app. Tones carry MEANING, not decoration:
 *   neutral  — not started / inactive / closed without outcome (draft, archived, cancelled, lost)
 *   info     — in motion, waiting on someone (sent, scheduled, in progress, contacted)
 *   warning  — needs your action (quote needed, unscheduled, partially paid, expiring)
 *   success  — done and good (accepted, completed, paid, won)
 *   danger   — a problem (overdue, failed)
 * Badges ALWAYS render the text label, so status is readable without colour.
 */
export interface StatusMeta { label: string; tone: BadgeTone }

type Map<K extends string> = Record<K, StatusMeta>;

export const LEAD_STATUSES = ["new", "contacted", "qualified", "quote_needed", "quote_sent", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS: Map<LeadStatus> = {
  new: { label: "New", tone: "warning" },
  contacted: { label: "Contacted", tone: "info" },
  qualified: { label: "Qualified", tone: "info" },
  quote_needed: { label: "Quote needed", tone: "warning" },
  quote_sent: { label: "Quote sent", tone: "info" },
  won: { label: "Won", tone: "success" },
  lost: { label: "Lost", tone: "neutral" },
};

export const QUOTE_STATUSES = ["draft", "sent", "viewed", "accepted", "declined", "expired", "archived"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_STATUS: Map<QuoteStatus> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  viewed: { label: "Viewed", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "neutral" },
  expired: { label: "Expired", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

export const JOB_STATUSES = ["unscheduled", "scheduled", "in_progress", "completed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS: Map<JobStatus | "invoiced"> = {
  unscheduled: { label: "Unscheduled", tone: "warning" },
  scheduled: { label: "Scheduled", tone: "info" },
  in_progress: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  invoiced: { label: "Invoiced", tone: "success" },
};

export const INVOICE_STATUSES = ["draft", "issued", "partially_paid", "paid", "overdue", "void", "archived"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS: Map<InvoiceStatus> = {
  draft: { label: "Draft", tone: "neutral" },
  issued: { label: "Unpaid", tone: "info" },
  partially_paid: { label: "Part paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  overdue: { label: "Overdue", tone: "danger" },
  void: { label: "Void", tone: "neutral" },
  archived: { label: "Archived", tone: "neutral" },
};

export const TASK_STATUS: Map<"open" | "in_progress" | "completed" | "cancelled"> = {
  open: { label: "Open", tone: "info" },
  in_progress: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const ALL = { lead: LEAD_STATUS, quote: QUOTE_STATUS, job: JOB_STATUS, invoice: INVOICE_STATUS, task: TASK_STATUS } as const;
export type StatusEntity = keyof typeof ALL;

export function statusMeta(entity: StatusEntity, status: string | null | undefined): StatusMeta {
  const m = (ALL[entity] as Record<string, StatusMeta>)[status ?? ""];
  return m ?? { label: status ? status.replace(/_/g, " ") : "—", tone: "neutral" };
}

/** Derived quote status (mirrors public.quote_effective_status): sent/viewed past expiry → expired. */
export function effectiveQuoteStatus(status: string, expiryDate: string | null, today: string): string {
  return (status === "sent" || status === "viewed") && expiryDate && expiryDate < today ? "expired" : status;
}

/** Derived invoice status (mirrors public.invoice_effective_status): unpaid past due → overdue. */
export function effectiveInvoiceStatus(status: string, dueDate: string | null, amountDue: string | number, today: string): string {
  return (status === "issued" || status === "partially_paid") && Number(amountDue) > 0 && dueDate && dueDate < today ? "overdue" : status;
}

export const LEAD_SOURCES = ["manual", "whatsapp", "email", "website", "phone", "referral", "other"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  manual: "Manual", whatsapp: "WhatsApp", email: "Email", website: "Website", phone: "Phone", referral: "Referral", other: "Other",
};

export const PAYMENT_METHODS = ["bank_transfer", "cash", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer (EFT)", cash: "Cash", card: "Card", other: "Other",
};
