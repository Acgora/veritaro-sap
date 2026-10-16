import { z } from "zod";
import { findInvoices, getInvoice, issueInvoice, listOverdueInvoices, listUnpaidInvoicesForCustomer, voidInvoice } from "@/domain/invoices/service";
import { getCustomerBalance, recordPayment } from "@/domain/payments/service";
import { newIdempotencyKey } from "@/domain/payments/schema";
import { getTodaySummary } from "@/domain/today/service";
import { getOrganisationTimezone } from "@/domain/jobs/service";
import { localDateInZone } from "@/domain/today/format";
import { PAYMENT_METHODS } from "@/lib/status";
import { ok, fail, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { AIToolDefinition } from "../types";
import { AMOUNT, DATE, money } from "./shared";

const n2 = (v: unknown) => Number(v ?? 0).toFixed(2);

async function invoiceSummary(ctx: ServiceContext, id: string): Promise<ActionResult<Record<string, unknown>>> {
  const r = await getInvoice(ctx, id);
  if (!r.ok) return r;
  const { invoice: i, items, payments, effectiveStatus, customer } = r.data;
  return ok({
    id: i.id, invoiceNumber: i.invoice_number ?? "draft (numbered when issued)", status: effectiveStatus,
    customer: customer?.display_name ?? i.customer_name_snapshot, customerId: i.customer_id, dueDate: i.due_date, currency: i.currency,
    lines: items.slice(0, 30).map((x) => ({ description: x.description, quantity: Number(x.quantity), lineTotal: n2(x.line_total) })),
    total: money(n2(i.total), i.currency), amountPaid: money(n2(i.amount_paid), i.currency), amountDue: money(n2(i.amount_due), i.currency),
    payments: payments.filter((p) => !p.voided_at).slice(0, 10).map((p) => ({ date: p.payment_date, amount: money(n2(p.amount), i.currency), method: p.payment_method })),
  });
}

async function invoiceLabel(ctx: ServiceContext, id: string): Promise<{ text: string; due?: string }> {
  const r = await getInvoice(ctx, id);
  if (!r.ok) return { text: "this invoice" };
  const i = r.data.invoice;
  const who = r.data.customer?.display_name ?? i.customer_name_snapshot ?? "the customer";
  return { text: `${i.invoice_number ?? "the draft invoice"} for ${who}`, due: money(n2(i.amount_due), i.currency) };
}

const invoiceFocus = (out: Record<string, unknown>) => [
  { type: "invoice" as const, id: String(out.id), label: String(out.invoiceNumber ?? "invoice") },
  ...(out.customerId ? [{ type: "customer" as const, id: String(out.customerId), label: String(out.customer ?? "customer") }] : []),
];

const findInput = z.object({ query: z.string().trim().min(1).max(100).describe("Invoice number (INV-0042) or customer name") });

export const findInvoicesTool: AIToolDefinition<typeof findInput> = {
  name: "find_invoices",
  description: "Find invoices by number or customer. Up to 8, newest first, with effective status (overdue derived), total and amount due.",
  actionClass: "read",
  requiredPermissions: ["invoices.read"],
  inputSchema: findInput,
  execute: async (ctx, i) => {
    const r = await findInvoices(ctx, i.query, 8);
    if (!r.ok) return r;
    return ok({ invoices: r.data.map((x) => ({ id: x.id, number: x.invoice_number ?? "draft", customer: x.customer_name, status: x.effective_status, total: money(x.total, x.currency), amountDue: money(x.amount_due, x.currency), dueDate: x.due_date })) });
  },
  summarise: (i) => `Find invoices “${i.query}”`,
};

const idInput = z.object({ invoiceId: z.uuid() });

export const getInvoiceTool: AIToolDefinition<typeof idInput, Record<string, unknown>> = {
  name: "get_invoice",
  description: "Show one invoice: number, status, lines, total, paid and amount due (all calculated by the app).",
  actionClass: "read",
  requiredPermissions: ["invoices.read"],
  inputSchema: idInput,
  execute: (ctx, i) => invoiceSummary(ctx, i.invoiceId),
  summarise: () => "Show invoice",
  card: (i, out) => ({ label: `Open ${String(out.invoiceNumber).startsWith("draft") ? "draft invoice" : String(out.invoiceNumber)}`, href: `/app/money/invoices/${i.invoiceId}` }),
  focus: (_i, out) => invoiceFocus(out),
};

const customerInput = z.object({ customerId: z.uuid().describe("From search_customers; ask if several customers match") });

export const getCustomerBalanceTool: AIToolDefinition<typeof customerInput> = {
  name: "get_customer_balance",
  description: "How much a customer owes: outstanding, overdue, number of open invoices and total paid — calculated by the database.",
  actionClass: "read",
  requiredPermissions: ["invoices.read"],
  inputSchema: customerInput,
  execute: async (ctx, i) => {
    const r = await getCustomerBalance(ctx, i.customerId);
    if (!r.ok) return r;
    const c = r.data.currency ?? "ZAR";
    return ok({ outstanding: money(r.data.outstanding, c), overdue: money(r.data.overdue, c), openInvoices: r.data.openInvoices, paid: money(r.data.paidTotal, c) });
  },
  summarise: () => "Get customer balance",
  card: (i) => ({ label: "Open customer", href: `/app/sales/customers/${i.customerId}?tab=invoices` }),
  focus: (i) => [{ type: "customer", id: i.customerId, label: "customer" }],
};

const unpaidInput = z.object({ customerId: z.uuid().optional() });

export const listUnpaidInvoicesTool: AIToolDefinition<typeof unpaidInput> = {
  name: "list_unpaid_invoices",
  description: "Unpaid issued invoices, optionally for one customer. Use before recording a payment: if more than one could apply, ask the user which invoice.",
  actionClass: "read",
  requiredPermissions: ["invoices.read"],
  inputSchema: unpaidInput,
  execute: async (ctx, i) => {
    const r = await listUnpaidInvoicesForCustomer(ctx, i.customerId ?? null, 15);
    if (!r.ok) return r;
    return ok({ invoices: r.data.map((x) => ({ id: x.id, number: x.invoice_number, customer: x.customer_name, status: x.effective_status, amountDue: money(x.amount_due, x.currency), dueDate: x.due_date })) });
  },
  summarise: () => "List unpaid invoices",
};

export const listOverdueInvoicesTool: AIToolDefinition<z.ZodObject<Record<string, never>>> = {
  name: "list_overdue_invoices",
  description: "Overdue invoices (unpaid past due date), most overdue first.",
  actionClass: "read",
  requiredPermissions: ["invoices.read"],
  inputSchema: z.object({}),
  execute: async (ctx) => {
    const r = await listOverdueInvoices(ctx, 15);
    if (!r.ok) return r;
    return ok({ invoices: r.data.map((x) => ({ id: x.id, number: x.invoice_number, customer: x.customer_name, amountDue: money(x.amount_due, x.currency), dueDate: x.due_date })) });
  },
  summarise: () => "List overdue invoices",
  card: () => ({ label: "Overdue invoices", href: "/app/money/invoices?status=overdue" }),
};

export const issueInvoiceTool: AIToolDefinition<typeof idInput> = {
  name: "issue_invoice",
  description: "Issue a draft invoice: assigns the next invoice number and locks it. Nothing is sent (no channel connected). Requires confirmation.",
  actionClass: "consequential",
  requiredPermissions: ["invoices.issue"],
  inputSchema: idInput,
  execute: (ctx, i) => issueInvoice(ctx, i.invoiceId),
  summarise: () => "Issue this invoice",
  describe: async (ctx, i) => {
    const l = await invoiceLabel(ctx, i.invoiceId);
    return `Issue ${l.text}${l.due ? ` for ${l.due}` : ""} (it gets its invoice number and can no longer be edited)`;
  },
  card: (i) => ({ label: "Open invoice", href: `/app/money/invoices/${i.invoiceId}` }),
  focus: (i) => [{ type: "invoice", id: i.invoiceId, label: "issued invoice" }],
};

const voidInput = z.object({ invoiceId: z.uuid(), reason: z.string().trim().min(2).max(500) });

export const voidInvoiceTool: AIToolDefinition<typeof voidInput> = {
  name: "void_invoice",
  description: "Void an issued invoice that has no payments (kept for the record). Requires a reason and confirmation.",
  actionClass: "consequential",
  requiredPermissions: ["invoices.issue"],
  inputSchema: voidInput,
  execute: (ctx, i) => voidInvoice(ctx, i.invoiceId, i.reason),
  summarise: () => "Void this invoice",
  describe: async (ctx, i) => `Void ${(await invoiceLabel(ctx, i.invoiceId)).text} — reason: ${i.reason}`,
  card: (i) => ({ label: "Open invoice", href: `/app/money/invoices/${i.invoiceId}` }),
};

const payInput = z.object({
  invoiceId: z.uuid().describe("A specific unpaid invoice. If the user named only a customer with several unpaid invoices, ask which one first."),
  amount: AMOUNT.describe("Exactly the amount the user said they received"),
  paymentDate: DATE.optional().describe("Defaults to today"),
  method: z.enum(PAYMENT_METHODS).optional().describe("Defaults to bank_transfer"),
  reference: z.string().trim().max(200).optional(),
});

export const recordPaymentTool: AIToolDefinition<typeof payInput> = {
  name: "record_payment",
  description: "Record money received against an issued invoice (partial payments allowed; overpayment is rejected). Requires the user's confirmation.",
  actionClass: "consequential",
  requiredPermissions: ["payments.record"],
  inputSchema: payInput,
  execute: async (ctx, i) => {
    const date = i.paymentDate ?? localDateInZone(new Date(), await getOrganisationTimezone(ctx));
    const r = await recordPayment(ctx, {
      invoiceId: i.invoiceId, amount: i.amount, paymentDate: date, method: i.method ?? "bank_transfer", reference: i.reference ?? null,
      // One key per confirmed action: the confirmation row is claimed atomically, so a double click cannot run this twice.
      idempotencyKey: newIdempotencyKey(),
    });
    if (!r.ok) return r;
    return ok({ status: r.data.status, amountDue: r.data.amountDue, already: r.data.already });
  },
  summarise: (i) => `Record ${i.amount} received`,
  describe: async (ctx, i) => {
    const r = await getInvoice(ctx, i.invoiceId);
    if (!r.ok) return `Record ${i.amount} received`;
    const inv = r.data.invoice;
    const who = r.data.customer?.display_name ?? inv.customer_name_snapshot ?? "the customer";
    return `Record ${money(i.amount, inv.currency)} received from ${who} against ${inv.invoice_number ?? "the invoice"} (${money(n2(inv.amount_due), inv.currency)} outstanding)`;
  },
  card: (i) => ({ label: "Open invoice", href: `/app/money/invoices/${i.invoiceId}` }),
  focus: (i) => [{ type: "invoice", id: i.invoiceId, label: "invoice" }],
};

export const getTodaySummaryTool: AIToolDefinition<z.ZodObject<Record<string, never>>> = {
  name: "get_today_summary",
  description: "Today's deterministic attention items: money outstanding/overdue, leads and quotes needing follow-up, jobs today, unassigned jobs, tasks due. Only sections the user may see.",
  actionClass: "read",
  requiredPermissions: [],
  inputSchema: z.object({}),
  execute: async (ctx) => {
    const r = await getTodaySummary(ctx);
    if (!r.ok) return r;
    const s = r.data;
    return ok({
      today: s.today,
      money: s.money ? { outstanding: money(n2(s.money.outstanding)), overdueCount: s.money.overdueCount, overdueAmount: money(n2(s.money.overdueAmount)),
        overdue: s.money.overdueInvoices.slice(0, 5).map((o) => ({ number: o.invoice_number, customer: o.customer_name, amountDue: money(n2(o.amount_due)), daysOverdue: o.days_overdue })) } : undefined,
      leads: s.leads ? { new: s.leads.newCount, needFollowUp: s.leads.followupCount } : undefined,
      quotes: s.quotes ? { needFollowUp: s.quotes.followupCount, expiringSoon: s.quotes.expiringCount } : undefined,
      jobs: s.jobs ? { today: s.jobs.today.length, inProgress: s.jobs.inProgressCount, unassignedUpcoming: s.jobs.unassignedUpcoming.length, unscheduled: s.jobs.unscheduledCount } : undefined,
      tasks: s.tasks,
    });
  },
  summarise: () => "Today's summary",
  card: () => ({ label: "Open Today", href: "/app/today" }),
};

const NO_CHANNEL = "No email or WhatsApp channel is connected yet, so nothing was sent. Download the PDF or copy the text and send it yourself, then log it.";

/** Honest stand-in so "send it to them" gets a truthful answer instead of a pretend send. */
export const sendMessageTool: AIToolDefinition<z.ZodObject<{ text: z.ZodOptional<z.ZodString> }>> = {
  name: "send_message",
  description: "Send an email/WhatsApp to a customer. NO channel is connected in this version, so this reports that nothing can be sent. Offer to download the PDF, draft the text, or log it after they send it themselves.",
  actionClass: "consequential",
  requiredPermissions: ["inbox.write"],
  inputSchema: z.object({ text: z.string().max(2000).optional() }),
  unavailable: () => NO_CHANNEL,
  execute: async () => fail(NO_CHANNEL),
  summarise: () => "Send a message",
};
