import { z } from "zod";
import { fail, logServerError, ok, toUserMessage, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import { effectiveInvoiceStatus, effectiveQuoteStatus } from "@/lib/status";

/**
 * Customer lifecycle tabs (quotes, jobs, invoices, balance). Read-only, small queries.
 * Each function returns ok([]) / ok(null) when the user lacks the permission — UI hides the tab anyway.
 * Effective statuses (expired / overdue) are derived with src/lib/status.ts using the org's local date.
 */
const LIMIT = 50;

export interface CustomerQuoteRow { id: string; quoteNumber: string; status: string; total: number; currency: string; issueDate: string; expiryDate: string | null }
export interface CustomerJobRow { id: string; jobNumber: string; title: string; status: string; scheduledStart: string | null }
export interface CustomerInvoiceRow {
  id: string; invoiceNumber: string | null; status: string; total: number; amountDue: number; currency: string; dueDate: string | null;
}
export interface CustomerBalance { outstanding: number; overdue: number; openInvoices: number; paidTotal: number; currency: string | null }

export async function listCustomerQuotes(ctx: ServiceContext, customerId: string, today: string): Promise<ActionResult<CustomerQuoteRow[]>> {
  if (!ctx.permissions.can("quotes.read")) return ok([]);
  const { data, error } = await ctx.supabase
    .from("quotes")
    .select("id, quote_number, status, total, currency, issue_date, expiry_date")
    .eq("organisation_id", ctx.organisationId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) {
    logServerError("customers.lifecycle.quotes", error);
    return fail(toUserMessage(error, "We couldn't load this customer's quotes."));
  }
  return ok(
    (data ?? []).map((q) => ({
      id: q.id,
      quoteNumber: q.quote_number,
      status: effectiveQuoteStatus(q.status, q.expiry_date, today),
      total: q.total,
      currency: q.currency,
      issueDate: q.issue_date,
      expiryDate: q.expiry_date,
    })),
  );
}

export async function listCustomerJobs(ctx: ServiceContext, customerId: string): Promise<ActionResult<CustomerJobRow[]>> {
  if (!ctx.permissions.can("jobs.read_all")) return ok([]);
  const { data, error } = await ctx.supabase
    .from("jobs")
    .select("id, job_number, title, status, scheduled_start")
    .eq("organisation_id", ctx.organisationId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) {
    logServerError("customers.lifecycle.jobs", error);
    return fail(toUserMessage(error, "We couldn't load this customer's jobs."));
  }
  return ok((data ?? []).map((j) => ({ id: j.id, jobNumber: j.job_number, title: j.title, status: j.status, scheduledStart: j.scheduled_start })));
}

export async function listCustomerInvoices(ctx: ServiceContext, customerId: string, today: string): Promise<ActionResult<CustomerInvoiceRow[]>> {
  if (!ctx.permissions.can("invoices.read")) return ok([]);
  const { data, error } = await ctx.supabase
    .from("invoices")
    .select("id, invoice_number, status, total, amount_due, currency, due_date")
    .eq("organisation_id", ctx.organisationId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) {
    logServerError("customers.lifecycle.invoices", error);
    return fail(toUserMessage(error, "We couldn't load this customer's invoices."));
  }
  return ok(
    (data ?? []).map((i) => ({
      id: i.id,
      invoiceNumber: i.invoice_number,
      status: effectiveInvoiceStatus(i.status, i.due_date, i.amount_due, today),
      total: i.total,
      amountDue: i.amount_due,
      currency: i.currency,
      dueDate: i.due_date,
    })),
  );
}

const balanceSchema = z.object({
  outstanding: z.coerce.number(),
  overdue: z.coerce.number(),
  open_invoices: z.coerce.number(),
  paid_total: z.coerce.number(),
  currency: z.string().nullable().optional(),
});

/** public.customer_balance (invoker + RLS). Totals come from SQL — never summed in TS. */
export async function getCustomerBalance(ctx: ServiceContext, customerId: string): Promise<ActionResult<CustomerBalance | null>> {
  if (!ctx.permissions.can("invoices.read")) return ok(null);
  const { data, error } = await ctx.supabase.rpc("customer_balance", { p_customer_id: customerId });
  if (error) {
    logServerError("customers.lifecycle.balance", error);
    return fail(toUserMessage(error, "We couldn't load this customer's balance."));
  }
  const p = balanceSchema.safeParse(data);
  if (!p.success) return fail("We couldn't load this customer's balance.");
  return ok({ outstanding: p.data.outstanding, overdue: p.data.overdue, openInvoices: p.data.open_invoices, paidTotal: p.data.paid_total, currency: p.data.currency ?? null });
}
