import { formatMoney } from "@/lib/money";
import type { TodaySummary } from "./schema";
import { countWord, dayLabel, joinList, plural } from "./format";

/**
 * Deterministic Today logic. Everything here is PURE: same summary in → same list out.
 * The SQL decides what is overdue / due; this file only orders and words it.
 * Money is never summed here — amounts come pre-aggregated from today_summary.
 */

export type AttentionSeverity = "danger" | "warning" | "info";

export interface AttentionItem {
  key: AttentionKey;
  severity: AttentionSeverity;
  /** Plain-language headline, e.g. "3 invoices are overdue (R4,500.00)". */
  title: string;
  /** Optional supporting line (may contain customer names — UI only, never sent to AI). */
  detail: string | null;
  href: string;
  count: number;
  /** Short lowercase phrase for the briefing sentence, e.g. "2 overdue invoices (R3,200.00)". */
  phrase: string;
}

export type AttentionKey =
  | "overdue_invoices"
  | "overdue_tasks"
  | "unassigned_jobs"
  | "quotes_followup"
  | "conversations_attention"
  | "new_leads"
  | "leads_followup"
  | "completed_not_invoiced"
  | "unscheduled_jobs"
  | "jobs_today"
  | "tasks_due_today"
  | "invoices_due_soon"
  | "quotes_expiring";

/** Fixed priority within a severity band (lower first). */
const ORDER: AttentionKey[] = [
  "overdue_invoices",
  "overdue_tasks",
  "unassigned_jobs",
  "quotes_followup",
  "conversations_attention",
  "new_leads",
  "leads_followup",
  "completed_not_invoiced",
  "unscheduled_jobs",
  "jobs_today",
  "tasks_due_today",
  "invoices_due_soon",
  "quotes_expiring",
];
const SEVERITY_RANK: Record<AttentionSeverity, number> = { danger: 0, warning: 1, info: 2 };

export interface AttentionOptions {
  currency: string;
  /**
   * "all" for people who manage the schedule (jobs.read_all). "assigned" for field agents:
   * team/scheduling/invoicing items are not theirs to act on, so they're left out.
   */
  jobsScope?: "all" | "assigned";
}

const money = (n: number, currency: string) => formatMoney(n.toFixed(2), currency);

export function buildAttentionItems(summary: TodaySummary, opts: AttentionOptions): AttentionItem[] {
  const { currency } = opts;
  const scope = opts.jobsScope ?? "all";
  const items: AttentionItem[] = [];
  const push = (i: AttentionItem) => {
    if (i.count > 0) items.push(i);
  };

  // Money
  const m = summary.money;
  if (m) {
    const amt = money(m.overdueAmount, currency);
    const oldest = m.overdueInvoices[0];
    push({
      key: "overdue_invoices",
      severity: "danger",
      count: m.overdueCount,
      title: `${plural(m.overdueCount, "invoice")} ${m.overdueCount === 1 ? "is" : "are"} overdue (${amt})`,
      detail: oldest
        ? `Oldest: ${oldest.invoice_number ?? "invoice"}${oldest.customer_name ? ` for ${oldest.customer_name}` : ""}, ${plural(oldest.days_overdue, "day")} overdue`
        : null,
      href: "/app/money/invoices?status=overdue",
      phrase: `${plural(m.overdueCount, "overdue invoice")} (${amt})`,
    });
    push({
      key: "invoices_due_soon",
      severity: "info",
      count: m.dueSoonCount,
      title: `${plural(m.dueSoonCount, "invoice")} ${m.dueSoonCount === 1 ? "is" : "are"} due in the next few days`,
      detail: null,
      href: "/app/money/invoices?status=issued",
      phrase: `${plural(m.dueSoonCount, "invoice")} due soon`,
    });
  }

  // Tasks
  const t = summary.tasks;
  push({
    key: "overdue_tasks",
    severity: "danger",
    count: t.overdueCount,
    title: `${plural(t.overdueCount, "task")} ${t.overdueCount === 1 ? "is" : "are"} overdue`,
    detail: null,
    href: "/app/work/tasks",
    phrase: plural(t.overdueCount, "overdue task"),
  });
  push({
    key: "tasks_due_today",
    severity: "info",
    count: t.dueTodayCount,
    title: `${plural(t.dueTodayCount, "task")} due today`,
    detail: null,
    href: "/app/work/tasks",
    phrase: `${plural(t.dueTodayCount, "task")} due today`,
  });

  // Quotes
  const q = summary.quotes;
  if (q) {
    const first = q.followup[0];
    const single = q.followupCount === 1 && first;
    push({
      key: "quotes_followup",
      severity: "warning",
      count: q.followupCount,
      title: single
        ? `Quote ${first.quote_number} has been waiting ${plural(first.days_waiting, "day")} for a reply`
        : `${plural(q.followupCount, "quote")} ${q.followupCount === 1 ? "is" : "are"} waiting for a reply`,
      detail: first
        ? `${single ? "" : "Longest wait: "}${first.quote_number}${first.customer_name ? ` for ${first.customer_name}` : ""} · ${money(first.total, currency)}${single ? "" : ` · ${plural(first.days_waiting, "day")}`}`
        : null,
      href: "/app/sales/quotes?status=sent",
      phrase: single
        ? `1 quote waiting ${plural(first.days_waiting, "day")} for a reply`
        : `${plural(q.followupCount, "quote")} waiting for a reply`,
    });
    push({
      key: "quotes_expiring",
      severity: "info",
      count: q.expiringCount,
      title: `${plural(q.expiringCount, "quote")} ${q.expiringCount === 1 ? "expires" : "expire"} in the next 3 days`,
      detail: null,
      href: "/app/sales/quotes?status=sent",
      phrase: `${plural(q.expiringCount, "quote")} about to expire`,
    });
  }

  // Leads
  const l = summary.leads;
  if (l) {
    push({
      key: "new_leads",
      severity: "warning",
      count: l.newCount,
      title: `${plural(l.newCount, "new lead")} ${l.newCount === 1 ? "hasn't" : "haven't"} been contacted yet`,
      detail: null,
      href: "/app/sales/leads",
      phrase: plural(l.newCount, "new lead"),
    });
    const first = l.followup[0];
    push({
      key: "leads_followup",
      severity: "warning",
      count: l.followupCount,
      title: `${plural(l.followupCount, "lead")} ${l.followupCount === 1 ? "needs" : "need"} a follow-up`,
      detail: first ? `Next: ${first.name ?? first.title ?? "a lead"}${first.reason === "no_response" ? " (no recent contact)" : ""}` : null,
      href: "/app/sales/leads",
      phrase: `${plural(l.followupCount, "lead")} to follow up`,
    });
  }

  // Jobs
  const j = summary.jobs;
  if (j) {
    push({
      key: "jobs_today",
      severity: "info",
      count: j.today.length,
      title: `${plural(j.today.length, "job")} scheduled today`,
      detail: j.inProgressCount > 0 ? `${j.inProgressCount} in progress right now` : null,
      href: "/app/work/calendar?view=day",
      phrase: `${plural(j.today.length, "job")} today`,
    });
    if (scope === "all") {
      const un = j.unassignedUpcoming;
      const firstUn = un[0];
      const when = firstUn ? dayLabel(firstUn.scheduled_start, summary.today, summary.timezone) : "";
      const possessive = when === "today" || when === "tomorrow" ? `${when}'s` : /^[A-Z][a-z]+day$/.test(when) ? `${when}'s` : null;
      push({
        key: "unassigned_jobs",
        severity: "warning",
        count: un.length,
        title:
          un.length === 1 && firstUn
            ? `Job ${firstUn.job_number} (${when}) has no team assigned`
            : `${plural(un.length, "upcoming job")} ${un.length === 1 ? "has" : "have"} no team assigned`,
        detail: firstUn ? `${un.length === 1 ? "" : "First: "}${firstUn.job_number} · ${firstUn.title}` : null,
        href: un.length === 1 && firstUn ? `/app/work/jobs/${firstUn.id}` : "/app/work/jobs?status=scheduled",
        phrase:
          un.length === 1 && firstUn
            ? possessive
              ? `${possessive} job ${firstUn.job_number} has no team`
              : `job ${firstUn.job_number} on ${when} has no team`
            : `${plural(un.length, "upcoming job")} with no team`,
      });
      push({
        key: "unscheduled_jobs",
        severity: "warning",
        count: j.unscheduledCount,
        title: `${plural(j.unscheduledCount, "job")} ${j.unscheduledCount === 1 ? "still needs" : "still need"} a date`,
        detail: null,
        href: "/app/work/jobs?status=unscheduled",
        phrase: `${plural(j.unscheduledCount, "job")} to schedule`,
      });
      const cni = j.completedNotInvoicedCount ?? 0;
      push({
        key: "completed_not_invoiced",
        severity: "warning",
        count: cni,
        title: `${plural(cni, "completed job")} ${cni === 1 ? "hasn't" : "haven't"} been invoiced`,
        detail: null,
        href: "/app/work/jobs?status=completed",
        phrase: `${plural(cni, "completed job")} to invoice`,
      });
    }
  }

  // Inbox
  if (summary.inbox) {
    const c = summary.inbox.attentionCount;
    push({
      key: "conversations_attention",
      severity: "warning",
      count: c,
      title: `${plural(c, "conversation")} ${c === 1 ? "needs" : "need"} your attention`,
      detail: null,
      href: "/app/inbox?filter=attention",
      phrase: `${plural(c, "conversation")} needing a reply`,
    });
  }

  return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
}

/** Items that need action (danger + warning). Info items are context, not problems. */
export function actionableItems(items: AttentionItem[]): AttentionItem[] {
  return items.filter((i) => i.severity !== "info");
}

/**
 * The deterministic briefing — ALWAYS shown, no AI needed. Mentions at most three
 * actionable items, then the day's context.
 *   "Three things need your attention: 2 overdue invoices (R3,200.00), 1 quote waiting 4 days for a reply and tomorrow's job J-0007 has no team."
 */
export function buildBriefingSentence(items: AttentionItem[]): string {
  const act = actionableItems(items);
  const info = items.filter((i) => i.severity === "info");
  const parts: string[] = [];
  if (act.length === 0) {
    parts.push("Nothing needs your attention right now.");
  } else {
    const top = act.slice(0, 3).map((i) => i.phrase);
    const head = act.length === 1 ? "One thing needs your attention" : `${countWord(act.length)} things need your attention`;
    const more = act.length > 3 ? `, plus ${plural(act.length - 3, "more item")} below` : "";
    parts.push(`${head}: ${joinList(top)}${more}.`);
  }
  const ctx = info.filter((i) => i.key === "jobs_today" || i.key === "tasks_due_today").map((i) => i.phrase);
  if (ctx.length) parts.push(`On the schedule: ${joinList(ctx)}.`);
  return parts.join(" ");
}

/**
 * What the AI is allowed to see: severity + pre-formatted headline/phrase. No ids, no
 * customer names (details are dropped), no contact data. Numbers are already strings.
 */
export function briefingPayload(items: AttentionItem[]): { severity: AttentionSeverity; headline: string; phrase: string }[] {
  return items.slice(0, 10).map((i) => ({ severity: i.severity, headline: i.title, phrase: i.phrase }));
}

/**
 * Guard: every number in the AI text must appear verbatim in the input. If the model
 * invents or recalculates a figure, the AI text is discarded. Pure — unit-tested.
 */
export function usesOnlyGivenNumbers(output: string, input: string): boolean {
  const tokens = output.match(/\d[\d,.\s]*\d|\d/g) ?? [];
  const norm = (s: string) => s.replace(/[\s,]/g, "");
  const allowed = new Set((input.match(/\d[\d,.\s]*\d|\d/g) ?? []).map(norm));
  const allowedText = norm(input);
  return tokens.every((tok) => {
    const n = norm(tok).replace(/\.$/, "");
    return allowed.has(n) || allowedText.includes(n);
  });
}

/** KPI tiles shown only when their section exists. */
export interface TodayKpi {
  key: "money_outstanding" | "overdue_invoices" | "new_leads" | "quotes_followup" | "jobs_today" | "tasks_due";
  label: string;
  value: string;
  hint: string | null;
  href: string;
  tone: "default" | "danger" | "warning";
}

export function buildKpis(summary: TodaySummary, opts: { currency: string }): TodayKpi[] {
  const k: TodayKpi[] = [];
  const m = summary.money;
  if (m) {
    k.push({ key: "money_outstanding", label: "Money outstanding", value: money(m.outstanding, opts.currency), hint: "Unpaid on issued invoices", href: "/app/money/invoices?status=issued", tone: "default" });
    k.push({
      key: "overdue_invoices",
      label: "Overdue invoices",
      value: String(m.overdueCount),
      hint: m.overdueCount ? money(m.overdueAmount, opts.currency) : "None overdue",
      href: "/app/money/invoices?status=overdue",
      tone: m.overdueCount ? "danger" : "default",
    });
  }
  if (summary.leads) {
    const n = summary.leads.newCount;
    k.push({ key: "new_leads", label: "New leads", value: String(n), hint: n ? "Not contacted yet" : "None waiting", href: "/app/sales/leads", tone: n ? "warning" : "default" });
  }
  if (summary.quotes) {
    const n = summary.quotes.followupCount;
    k.push({ key: "quotes_followup", label: "Quotes to follow up", value: String(n), hint: n ? "No reply yet" : "All answered", href: "/app/sales/quotes?status=sent", tone: n ? "warning" : "default" });
  }
  if (summary.jobs) {
    const n = summary.jobs.today.length;
    k.push({ key: "jobs_today", label: "Jobs today", value: String(n), hint: summary.jobs.inProgressCount ? `${summary.jobs.inProgressCount} in progress` : n ? "On the schedule" : "Nothing booked", href: "/app/work/calendar?view=day", tone: "default" });
  }
  const t = summary.tasks;
  const due = t.overdueCount + t.dueTodayCount;
  k.push({
    key: "tasks_due",
    label: "Tasks due",
    value: String(due),
    hint: t.overdueCount ? `${t.overdueCount} overdue` : due ? "Due today" : "Nothing due",
    href: "/app/work/tasks",
    tone: t.overdueCount ? "danger" : "default",
  });
  return k;
}
