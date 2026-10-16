import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { Json } from "@/types/database.types";
import { money2 } from "@/domain/commercial/line-items";
import { listPaymentsSchema, recordPaymentSchema, voidPaymentSchema, type ListPaymentsInput, type RecordPaymentInput } from "./schema";

/**
 * Payments — recorded and reversed ONLY via record_payment / void_payment (row-locked,
 * idempotent, overpayment rejected; amount paid/due and invoice status maintained by the DB).
 */

function rpcObject(data: Json | null): Record<string, Json | undefined> {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, Json | undefined>) : {};
}

export interface RecordPaymentResult {
  paymentId: string;
  invoiceId: string;
  status: string;
  amountDue: string;
  /** true when this idempotency key was already used: nothing new was recorded. */
  already: boolean;
}

export async function recordPayment(ctx: ServiceContext, input: RecordPaymentInput): Promise<ActionResult<RecordPaymentResult>> {
  if (!ctx.permissions.can("payments.record")) return fail("You don't have permission to record payments.");
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const { data, error } = await ctx.supabase.rpc("record_payment", {
    p_invoice_id: v.invoiceId,
    // Validated ≤2dp decimal string → JSON number round-trips exactly; the DB rounds to cents again.
    p_amount: Number(v.amount),
    p_payment_date: v.paymentDate,
    p_method: v.method,
    p_reference: v.reference ?? undefined,
    p_notes: v.notes ?? undefined,
    p_idempotency_key: v.idempotencyKey,
  });
  if (error) {
    logServerError("payments.record", error);
    return fail(toUserMessage(error, "We couldn't record the payment."));
  }
  const r = rpcObject(data);
  if (typeof r.payment_id !== "string") return fail("We couldn't record the payment.");
  return ok({
    paymentId: r.payment_id,
    invoiceId: String(r.invoice_id ?? v.invoiceId),
    status: String(r.status ?? ""),
    amountDue: money2(r.amount_due as number | undefined),
    already: r.already === true,
  });
}

export async function voidPayment(ctx: ServiceContext, paymentId: string, reason: string): Promise<ActionResult<{ paymentId: string; invoiceId: string | null; already: boolean }>> {
  if (!ctx.permissions.can("payments.record")) return fail("You don't have permission to reverse payments.");
  const parsed = voidPaymentSchema.safeParse({ reason });
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const { data, error } = await ctx.supabase.rpc("void_payment", { p_payment_id: paymentId, p_reason: parsed.data.reason });
  if (error) {
    logServerError("payments.void", error);
    return fail(toUserMessage(error, "We couldn't reverse the payment."));
  }
  const r = rpcObject(data);
  return ok({ paymentId, invoiceId: typeof r.invoice_id === "string" ? r.invoice_id : null, already: r.already === true });
}

export interface PaymentListItem {
  id: string;
  invoice_id: string;
  invoice_number: string | null;
  customer_id: string;
  customer_name: string;
  amount: string;
  currency: string;
  payment_date: string;
  payment_method: string;
  reference: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}

const PAYMENT_COLUMNS =
  "id, invoice_id, customer_id, amount, payment_date, payment_method, reference, voided_at, void_reason, created_at, invoice:invoices!payments_invoice_fk(invoice_number, currency, customer_name_snapshot)" as const;

type PaymentRow = {
  id: string; invoice_id: string; customer_id: string; amount: number; payment_date: string; payment_method: string;
  reference: string | null; voided_at: string | null; void_reason: string | null; created_at: string;
  invoice: { invoice_number: string | null; currency: string; customer_name_snapshot: string | null } | null;
};

const toItem = (p: PaymentRow): PaymentListItem => ({
  id: p.id, invoice_id: p.invoice_id, invoice_number: p.invoice?.invoice_number ?? null, customer_id: p.customer_id,
  customer_name: p.invoice?.customer_name_snapshot ?? "Customer", amount: money2(p.amount), currency: p.invoice?.currency ?? "ZAR",
  payment_date: p.payment_date, payment_method: p.payment_method, reference: p.reference, voided_at: p.voided_at,
  void_reason: p.void_reason, created_at: p.created_at,
});

export async function listPayments(
  ctx: ServiceContext,
  input: ListPaymentsInput = {},
): Promise<ActionResult<{ payments: PaymentListItem[]; total: number; page: number; pageSize: number }>> {
  const parsed = listPaymentsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid filter");
  const { customerId, invoiceId, includeVoided, page, pageSize } = parsed.data;
  let q = ctx.supabase.from("payments").select(PAYMENT_COLUMNS, { count: "exact" }).eq("organisation_id", ctx.organisationId);
  if (customerId) q = q.eq("customer_id", customerId);
  if (invoiceId) q = q.eq("invoice_id", invoiceId);
  if (!includeVoided) q = q.is("voided_at", null);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await q.order("payment_date", { ascending: false }).order("created_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) {
    logServerError("payments.list", error);
    return fail(toUserMessage(error, "We couldn't load payments."));
  }
  return ok({ payments: ((data ?? []) as PaymentRow[]).map(toItem), total: count ?? 0, page, pageSize });
}

export interface CustomerBalance {
  customerId: string;
  outstanding: string;
  overdue: string;
  openInvoices: number;
  paidTotal: string;
  currency: string | null;
}

export async function getCustomerBalance(ctx: ServiceContext, customerId: string): Promise<ActionResult<CustomerBalance>> {
  const { data, error } = await ctx.supabase.rpc("customer_balance", { p_customer_id: customerId });
  if (error) {
    logServerError("payments.balance", error);
    return fail(toUserMessage(error, "We couldn't work out this customer's balance."));
  }
  const r = rpcObject(data);
  return ok({
    customerId,
    outstanding: money2(r.outstanding as number | undefined),
    overdue: money2(r.overdue as number | undefined),
    openInvoices: Number(r.open_invoices ?? 0),
    paidTotal: money2(r.paid_total as number | undefined),
    currency: typeof r.currency === "string" ? r.currency : null,
  });
}

export interface MoneyOverview {
  outstanding: string;
  overdueCount: number;
  overdueAmount: string;
  dueSoonCount: number;
  overdueInvoices: { id: string; invoice_number: string; customer_name: string; amount_due: string; due_date: string; days_overdue: number }[];
  recentPayments: PaymentListItem[];
  draftCount: number;
}

/** Aggregates from today_summary() (no row fetching) + the 5 latest payments + draft count. */
export async function getMoneyOverview(ctx: ServiceContext): Promise<ActionResult<MoneyOverview>> {
  const [summary, payments, drafts] = await Promise.all([
    ctx.supabase.rpc("today_summary", { p_organisation_id: ctx.organisationId }),
    ctx.permissions.can("payments.read")
      ? ctx.supabase.from("payments").select(PAYMENT_COLUMNS).eq("organisation_id", ctx.organisationId).is("voided_at", null)
        .order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [], error: null }),
    ctx.supabase.from("invoices").select("id", { count: "exact", head: true }).eq("organisation_id", ctx.organisationId).eq("status", "draft"),
  ]);
  const error = summary.error ?? payments.error ?? drafts.error;
  if (error) {
    logServerError("money.overview", error);
    return fail(toUserMessage(error, "We couldn't load the money overview."));
  }
  const s = rpcObject(summary.data);
  const list = Array.isArray(s.overdue_invoices) ? (s.overdue_invoices as Record<string, Json>[]) : [];
  return ok({
    outstanding: money2(s.money_outstanding as number | undefined),
    overdueCount: Number(s.overdue_invoices_count ?? 0),
    overdueAmount: money2(s.overdue_amount as number | undefined),
    dueSoonCount: Number(s.due_soon_count ?? 0),
    overdueInvoices: list.map((x) => ({
      id: String(x.id), invoice_number: String(x.invoice_number ?? ""), customer_name: String(x.customer_name ?? "Customer"),
      amount_due: money2(x.amount_due as number), due_date: String(x.due_date ?? ""), days_overdue: Number(x.days_overdue ?? 0),
    })),
    recentPayments: ((payments.data ?? []) as PaymentRow[]).map(toItem),
    draftCount: drafts.count ?? 0,
  });
}
