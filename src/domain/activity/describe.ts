import type { ActivityItem } from "./service";
import { formatMoney } from "@/lib/money";

type DescribeInput = Pick<ActivityItem, "action" | "metadata" | "actorType" | "actorName"> & { actorUserId?: string | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

const LEAD_STATUS_WORDS: Record<string, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", quote_needed: "Quote needed", quote_sent: "Quote sent", won: "Won", lost: "Lost",
};
const COMM_KIND_WORDS: Record<string, string> = {
  call: "Call", meeting: "Meeting", message: "Message", email: "Email", note: "Note", whatsapp: "WhatsApp message", sms: "SMS",
};

/**
 * " by Sam" / " by AI on behalf of Sam" / "" (system). Phase 003 lifecycle sentences put the
 * record first ("Quote Q-0003 accepted") and the actor last.
 */
function byline(item: DescribeInput): string {
  if (item.actorType === "ai") return item.actorName ? ` by AI on behalf of ${item.actorName}` : " by AI";
  if (item.actorType === "user") return item.actorName ? ` by ${item.actorName}` : "";
  return "";
}

function money(v: unknown, currency: string): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return formatMoney(n.toFixed(2), currency);
}

/** Sentences for Phase 003 lifecycle actions (leads, inbox, quotes, jobs, invoices, payments). null = not a lifecycle action. */
function describeLifecycle(item: DescribeInput, currency: string): string | null {
  const m = item.metadata;
  const by = byline(item);
  const quote = `Quote ${str(m.quote_number) ?? ""}`.trim();
  const job = `Job ${str(m.job_number) ?? ""}`.trim();
  const invNo = str(m.invoice_number);
  const invoice = invNo ? `Invoice ${invNo}` : "Draft invoice";
  const lead = str(m.title) ? `Lead “${str(m.title)}”` : "Lead";
  switch (item.action) {
    // Leads
    case "lead_created":
      return `New lead${str(m.title) ? ` “${str(m.title)}”` : ""} added${by}`;
    case "lead_status_changed": {
      const to = str(m.to);
      return `${lead} moved to ${to ? (LEAD_STATUS_WORDS[to] ?? to.replace(/_/g, " ")) : "a new stage"}${by}`;
    }
    case "lead_archived":
      return `${lead} archived${by}`;
    case "lead_converted":
      return `${lead} converted to customer${by}`;
    // Inbox
    case "communication_logged": {
      const kind = str(m.kind);
      const label = (kind && COMM_KIND_WORDS[kind]) || "Communication";
      return `${label} logged${by}`;
    }
    // Quotes
    case "quote_created":
      return `${quote} created${by}`;
    case "quote_issued":
      return `${quote} sent${by}`;
    case "quote_viewed":
      return `${quote} viewed by the customer`;
    case "quote_accepted":
      return `${quote} accepted${by}`;
    case "quote_declined":
      return `${quote} declined${by}`;
    case "quote_expired":
      return `${quote} expired`;
    case "quote_archived":
      return `${quote} archived${by}`;
    case "quote_status_changed":
      return `${quote} marked ${String(m.to ?? "updated").replace(/_/g, " ")}${by}`;
    // Jobs
    case "job_created":
      return `${job} created${m.quote_id ? " from a quote" : ""}${by}`;
    case "job_scheduled":
      return `${job} ${m.previous ? "rescheduled" : "scheduled"}${by}`;
    case "job_started":
      return `${job} started${by}`;
    case "job_completed":
      return `${job} completed${by}`;
    case "job_cancelled":
      return `${job} cancelled${by}`;
    case "job_assigned":
      return `Team member assigned to ${job.replace(/^Job/, "job")}${by}`;
    case "job_unassigned":
      return `Team member removed from ${job.replace(/^Job/, "job")}${by}`;
    case "job_note_added":
      return `Note added to ${job.replace(/^Job/, "job")}${by}`;
    case "job_photo_added":
      return `Photo added to ${job.replace(/^Job/, "job")}${by}`;
    // Invoices
    case "invoice_created":
      return `${invNo ? `Invoice ${invNo}` : "Draft invoice"} created${m.job_id ? " from a job" : m.quote_id ? " from a quote" : ""}${by}`;
    case "invoice_issued":
      return `${invoice} issued${by}`;
    case "invoice_paid":
      return `${invoice} paid in full`;
    case "invoice_voided":
      return `${invoice} voided${by}`;
    case "invoice_archived":
      return `${invoice} archived${by}`;
    case "invoice_status_changed": {
      const to = str(m.to);
      if (to === "partially_paid") return `${invoice} is now part paid`;
      if (to === "issued") return `${invoice} is unpaid again`;
      return `${invoice} marked ${to ? to.replace(/_/g, " ") : "updated"}${by}`;
    }
    // Payments
    case "payment_recorded": {
      const amt = money(m.amount, currency);
      return `Payment${amt ? ` of ${amt}` : ""} recorded against ${invNo ?? "an invoice"}${by}`;
    }
    case "payment_voided": {
      const amt = money(m.amount, currency);
      return `Payment${amt ? ` of ${amt}` : ""} on ${invNo ?? "an invoice"} voided${by}`;
    }
    default:
      return null;
  }
}

/** Human-readable sentence for an activity entry. Pure + unit-tested. */
export function describeActivity(item: DescribeInput, opts: { currency?: string } = {}): string {
  const lifecycle = describeLifecycle(item, opts.currency ?? "ZAR");
  if (lifecycle !== null) return lifecycle;
  const who = item.actorType === "ai" ? "The assistant" : item.actorType === "system" ? "System" : (item.actorName ?? "Someone");
  const title = typeof item.metadata.title === "string" ? `“${item.metadata.title}”` : "a task";
  const name = typeof item.metadata.name === "string" ? `“${item.metadata.name}”` : "a customer";
  const role = typeof item.metadata.role === "string" ? item.metadata.role.replace("_", " ") : null;
  switch (item.action) {
    case "organisation_created":
      return `${who} created the organisation`;
    case "organisation_updated":
      return `${who} updated organisation details`;
    case "settings_updated":
      return `${who} changed organisation preferences`;
    case "member_added":
      if (item.actorUserId && item.metadata.user_id === item.actorUserId) return `${who} joined${role ? ` as ${role}` : ""}`;
      return `${who} added a member${role ? ` as ${role}` : ""}`;
    case "member_removed":
      return `${who} removed a member`;
    case "member_role_changed":
      return `${who} changed a member's role to ${String(item.metadata.to_role ?? "").replace("_", " ")}`;
    case "member_status_changed":
      return `${who} changed a member's status to ${String(item.metadata.to_status ?? "")}`;
    case "task_created":
      return `${who} created task ${title}`;
    case "task_updated":
      return `${who} updated task ${title}`;
    case "task_completed":
      return `${who} completed task ${title}`;
    case "task_reopened":
      return `${who} reopened task ${title}`;
    case "task_archived":
      return `${who} archived task ${title}`;
    case "task_deleted":
      return `${who} deleted task ${title}`;
    case "customer_created":
      return `${who} added customer ${name}`;
    case "customer_updated":
      return `${who} updated customer ${name}`;
    case "customer_archived":
      return `${who} archived customer ${name}`;
    case "customer_restored":
      return `${who} restored customer ${name}`;
    case "contact_added":
      return `${who} added a contact to ${name}`;
    case "contact_updated":
      return `${who} updated a contact for ${name}`;
    case "contact_removed":
      return `${who} removed a contact from ${name}`;
    case "address_added":
      return `${who} added an address to ${name}`;
    case "address_updated":
      return `${who} updated an address for ${name}`;
    case "address_removed":
      return `${who} removed an address from ${name}`;
    case "ai_soft_budget_exceeded":
      return "AI usage passed this month's soft budget";
    case "ai_hard_limit_reached":
      return "AI paused: monthly AI spending ceiling reached";
    default:
      return `${who} · ${item.action.replaceAll("_", " ")}`;
  }
}
