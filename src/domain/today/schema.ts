import { z } from "zod";

/**
 * Shape of public.today_summary(org) jsonb. Every section is OPTIONAL: the SQL only
 * adds a section when the caller holds the permission (invoices.read, leads.read,
 * quotes.read, jobs.read_*, inbox.read). Tasks are always present (tasks RLS applies).
 * Counts are bigint and money is numeric(14,2) — both arrive as JSON numbers; coerce
 * defensively in case a driver ever stringifies them.
 */
const num = z.coerce.number();
const list = <T extends z.ZodType>(item: T) => z.array(item).nullish().transform((v) => v ?? []);

const overdueInvoice = z.object({
  id: z.string(),
  invoice_number: z.string().nullable(),
  customer_name: z.string().nullable(),
  amount_due: num,
  due_date: z.string().nullable(),
  days_overdue: num,
});

const leadFollowup = z.object({
  id: z.string(),
  title: z.string().nullable(),
  name: z.string().nullable(),
  status: z.string(),
  source: z.string().nullable(),
  due_at: z.string().nullable(),
  reason: z.string(),
});

const quoteFollowup = z.object({
  id: z.string(),
  quote_number: z.string(),
  customer_name: z.string().nullable(),
  total: num,
  issued_at: z.string().nullable(),
  days_waiting: num,
  expiry_date: z.string().nullable(),
});

const jobToday = z.object({
  id: z.string(),
  job_number: z.string(),
  title: z.string(),
  status: z.string(),
  scheduled_start: z.string().nullable(),
  scheduled_end: z.string().nullable(),
  team_size: num,
});

const unassignedJob = z.object({
  id: z.string(),
  job_number: z.string(),
  title: z.string(),
  scheduled_start: z.string(),
});

export const rawTodaySummarySchema = z.object({
  today: z.string(),
  timezone: z.string(),
  // money (invoices.read)
  money_outstanding: num.optional(),
  overdue_invoices_count: num.optional(),
  overdue_amount: num.optional(),
  due_soon_count: num.optional(),
  overdue_invoices: list(overdueInvoice),
  // leads (leads.read)
  new_leads_count: num.optional(),
  leads_followup: list(leadFollowup),
  leads_followup_count: num.optional(),
  // quotes (quotes.read)
  quotes_followup: list(quoteFollowup),
  quotes_followup_count: num.optional(),
  quotes_expiring_count: num.optional(),
  // jobs (jobs.read_all | jobs.read_assigned)
  jobs_today: z.array(jobToday).optional(),
  jobs_in_progress_count: num.optional(),
  unassigned_upcoming: list(unassignedJob),
  unscheduled_count: num.optional(),
  completed_not_invoiced_count: num.nullable().optional(),
  // tasks (always)
  tasks_overdue_count: num.optional().default(0),
  tasks_due_today_count: num.optional().default(0),
  // inbox (inbox.read)
  conversations_attention_count: num.optional(),
});

export type OverdueInvoice = z.infer<typeof overdueInvoice>;
export type LeadFollowup = z.infer<typeof leadFollowup>;
export type QuoteFollowup = z.infer<typeof quoteFollowup>;
export type JobToday = z.infer<typeof jobToday>;
export type UnassignedJob = z.infer<typeof unassignedJob>;

/** Typed Today summary. A section is undefined when the user lacks the permission for it. */
export interface TodaySummary {
  today: string;
  timezone: string;
  money?: { outstanding: number; overdueCount: number; overdueAmount: number; dueSoonCount: number; overdueInvoices: OverdueInvoice[] };
  leads?: { newCount: number; followupCount: number; followup: LeadFollowup[] };
  quotes?: { followupCount: number; expiringCount: number; followup: QuoteFollowup[] };
  jobs?: {
    today: JobToday[];
    inProgressCount: number;
    unassignedUpcoming: UnassignedJob[];
    unscheduledCount: number;
    /** null when the user can't read invoices (the SQL can't know what's invoiced). */
    completedNotInvoicedCount: number | null;
  };
  tasks: { overdueCount: number; dueTodayCount: number };
  inbox?: { attentionCount: number };
}

/** Parse the RPC jsonb into a TodaySummary; null when the payload is unusable. Pure — unit-tested. */
export function parseTodaySummary(raw: unknown): TodaySummary | null {
  const p = rawTodaySummarySchema.safeParse(raw);
  if (!p.success) return null;
  const r = p.data;
  const s: TodaySummary = {
    today: r.today,
    timezone: r.timezone,
    tasks: { overdueCount: r.tasks_overdue_count, dueTodayCount: r.tasks_due_today_count },
  };
  if (r.money_outstanding !== undefined) {
    s.money = {
      outstanding: r.money_outstanding,
      overdueCount: r.overdue_invoices_count ?? 0,
      overdueAmount: r.overdue_amount ?? 0,
      dueSoonCount: r.due_soon_count ?? 0,
      overdueInvoices: r.overdue_invoices,
    };
  }
  if (r.new_leads_count !== undefined) {
    s.leads = { newCount: r.new_leads_count, followupCount: r.leads_followup_count ?? r.leads_followup.length, followup: r.leads_followup };
  }
  if (r.quotes_followup_count !== undefined) {
    s.quotes = { followupCount: r.quotes_followup_count, expiringCount: r.quotes_expiring_count ?? 0, followup: r.quotes_followup };
  }
  if (r.jobs_today !== undefined) {
    s.jobs = {
      today: r.jobs_today,
      inProgressCount: r.jobs_in_progress_count ?? 0,
      unassignedUpcoming: r.unassigned_upcoming,
      unscheduledCount: r.unscheduled_count ?? 0,
      completedNotInvoicedCount: r.completed_not_invoiced_count ?? null,
    };
  }
  if (r.conversations_attention_count !== undefined) s.inbox = { attentionCount: r.conversations_attention_count };
  return s;
}
