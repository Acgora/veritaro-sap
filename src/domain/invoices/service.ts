import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import { effectiveInvoiceStatus } from "@/lib/status";
import type { ServiceContext } from "@/domain/context";
import type { Json, Tables } from "@/types/database.types";
import { sanitiseSearch } from "@/domain/customers/schema";
import { orgToday, orgTimezone, todayInZone } from "@/domain/commercial/dates";
import { matchCustomerIds } from "@/domain/commercial/parties";
import { lineFieldErrors, planItemSync, money2 } from "@/domain/commercial/line-items";
import { getDocumentDefaults } from "@/domain/financial-settings/service";
import { createInvoiceFromQuote as createInvoiceFromQuoteImpl } from "@/domain/quotes/service";
import {
  createInvoiceDraftSchema, listInvoicesSchema, saveInvoiceDraftSchema, voidInvoiceSchema,
  type CreateInvoiceDraftInput, type ListInvoicesInput, type SaveInvoiceDraftInput,
} from "./schema";

/**
 * Invoices — single implementation for screens and AI tools. Numbers (at issue), totals,
 * amount paid/due, snapshots and transitions are enforced by Postgres (migration 20261016000600).
 */

export type Invoice = Tables<"invoices">;
export type InvoiceItem = Tables<"invoice_items">;
export type Payment = Tables<"payments">;

export interface InvoiceListItem {
  id: string;
  invoice_number: string | null;
  title: string | null;
  status: string;
  effective_status: string;
  issue_date: string;
  due_date: string | null;
  total: string;
  amount_due: string;
  amount_paid: string;
  currency: string;
  customer_id: string;
  customer_name: string;
}

const LIST_COLUMNS =
  "id, invoice_number, title, status, issue_date, due_date, total, amount_due, amount_paid, currency, customer_id, customer_name_snapshot, customer:customers!invoices_customer_fk(display_name)" as const;

type ListRow = {
  id: string; invoice_number: string | null; title: string | null; status: string; issue_date: string; due_date: string | null;
  total: number; amount_due: number; amount_paid: number; currency: string; customer_id: string;
  customer_name_snapshot: string | null; customer: { display_name: string } | null;
};

function toListItem(r: ListRow, today: string): InvoiceListItem {
  return {
    id: r.id, invoice_number: r.invoice_number, title: r.title, status: r.status,
    effective_status: effectiveInvoiceStatus(r.status, r.due_date, r.amount_due, today),
    issue_date: r.issue_date, due_date: r.due_date, total: money2(r.total), amount_due: money2(r.amount_due),
    amount_paid: money2(r.amount_paid), currency: r.currency, customer_id: r.customer_id,
    customer_name: r.customer_name_snapshot ?? r.customer?.display_name ?? "Customer",
  };
}

export async function listInvoices(
  ctx: ServiceContext,
  input: ListInvoicesInput = {},
): Promise<ActionResult<{ invoices: InvoiceListItem[]; total: number; page: number; pageSize: number; today: string }>> {
  const parsed = listInvoicesSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid filter");
  const { status, customerId, q, page, pageSize } = parsed.data;
  const today = await orgToday(ctx);

  let query = ctx.supabase.from("invoices").select(LIST_COLUMNS, { count: "exact" }).eq("organisation_id", ctx.organisationId);
  switch (status) {
    case "all": query = query.neq("status", "archived"); break;
    // due_date is never null on an issued invoice (issue_invoice sets it), so no null branch is needed.
    case "unpaid": query = query.in("status", ["issued", "partially_paid"]).gte("due_date", today); break;
    case "overdue": query = query.in("status", ["issued", "partially_paid"]).gt("amount_due", 0).lt("due_date", today); break;
    default: query = query.eq("status", status);
  }
  if (customerId) query = query.eq("customer_id", customerId);
  if (q) {
    const term = sanitiseSearch(q);
    if (term) {
      const ids = await matchCustomerIds(ctx, term);
      const parts = [`invoice_number.ilike.*${term}*`, `title.ilike.*${term}*`, `customer_name_snapshot.ilike.*${term}*`];
      if (ids.length) parts.push(`customer_id.in.(${ids.join(",")})`);
      query = query.or(parts.join(","));
    }
  }
  const from = (page - 1) * pageSize;
  const ordered = status === "overdue" || status === "unpaid"
    ? query.order("due_date", { ascending: true })
    : query.order("created_at", { ascending: false });
  const { data, error, count } = await ordered.range(from, from + pageSize - 1);
  if (error) {
    logServerError("invoices.list", error);
    return fail(toUserMessage(error, "We couldn't load invoices."));
  }
  return ok({ invoices: ((data ?? []) as ListRow[]).map((r) => toListItem(r, today)), total: count ?? 0, page, pageSize, today });
}

export interface InvoiceDetail {
  invoice: Invoice;
  items: InvoiceItem[];
  payments: Payment[];
  effectiveStatus: string;
  today: string;
  customer: { id: string; display_name: string } | null;
  contact: { id: string; name: string } | null;
  site: { id: string; label: string } | null;
  job: { id: string; job_number: string } | null;
  quote: { id: string; quote_number: string } | null;
}

export async function getInvoice(ctx: ServiceContext, id: string): Promise<ActionResult<InvoiceDetail>> {
  const [inv, items, payments, tz] = await Promise.all([
    ctx.supabase.from("invoices").select("*").eq("organisation_id", ctx.organisationId).eq("id", id).maybeSingle(),
    ctx.supabase.from("invoice_items").select("*").eq("organisation_id", ctx.organisationId).eq("invoice_id", id)
      .order("sort_order").order("created_at").limit(500),
    ctx.permissions.can("payments.read")
      ? ctx.supabase.from("payments").select("*").eq("organisation_id", ctx.organisationId).eq("invoice_id", id)
        .order("payment_date", { ascending: false }).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as Payment[], error: null }),
    orgTimezone(ctx),
  ]);
  const error = inv.error ?? items.error ?? payments.error;
  if (error) {
    logServerError("invoices.get", error);
    return fail(toUserMessage(error, "We couldn't load this invoice."));
  }
  if (!inv.data) return fail("We couldn't find that invoice, or you don't have access to it.");
  const invoice = inv.data;
  const today = todayInZone(tz);
  const none = Promise.resolve({ data: null });
  const [customer, contact, site, job, quote] = await Promise.all([
    ctx.supabase.from("customers").select("id, display_name").eq("organisation_id", ctx.organisationId).eq("id", invoice.customer_id).maybeSingle(),
    invoice.contact_id
      ? ctx.supabase.from("customer_contacts").select("id, first_name, last_name").eq("organisation_id", ctx.organisationId).eq("id", invoice.contact_id).maybeSingle()
      : none,
    invoice.site_address_id
      ? ctx.supabase.from("customer_addresses").select("id, label, line1, suburb, city").eq("organisation_id", ctx.organisationId).eq("id", invoice.site_address_id).maybeSingle()
      : none,
    invoice.job_id && ctx.permissions.can("jobs.read_all")
      ? ctx.supabase.from("jobs").select("id, job_number").eq("organisation_id", ctx.organisationId).eq("id", invoice.job_id).maybeSingle()
      : none,
    invoice.quote_id && ctx.permissions.can("quotes.read")
      ? ctx.supabase.from("quotes").select("id, quote_number").eq("organisation_id", ctx.organisationId).eq("id", invoice.quote_id).maybeSingle()
      : none,
  ]);
  const ct = contact.data as { id: string; first_name: string; last_name: string | null } | null;
  const st = site.data as { id: string; label: string | null; line1: string; suburb: string | null; city: string | null } | null;
  return ok({
    invoice,
    items: items.data ?? [],
    payments: (payments.data ?? []) as Payment[],
    effectiveStatus: effectiveInvoiceStatus(invoice.status, invoice.due_date, invoice.amount_due, today),
    today,
    customer: customer.data ?? null,
    contact: ct ? { id: ct.id, name: [ct.first_name, ct.last_name].filter(Boolean).join(" ") } : null,
    site: st ? { id: st.id, label: [st.label, [st.line1, st.suburb, st.city].filter(Boolean).join(", ")].filter(Boolean).join(" — ") } : null,
    job: (job.data as { id: string; job_number: string } | null) ?? null,
    quote: (quote.data as { id: string; quote_number: string } | null) ?? null,
  });
}

/** Blank draft invoice for a customer (no job/quote). Due date defaults in the DB from customer terms or settings. */
export async function createInvoiceDraft(ctx: ServiceContext, input: CreateInvoiceDraftInput): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("invoices.write")) return fail("You don't have permission to create invoices.");
  const parsed = createInvoiceDraftSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const [defaults, today] = await Promise.all([getDocumentDefaults(ctx), orgToday(ctx)]);
  const { data, error } = await ctx.supabase.from("invoices").insert({
    organisation_id: ctx.organisationId,
    customer_id: v.customerId,
    contact_id: v.contactId,
    site_address_id: v.siteAddressId,
    title: v.title,
    issue_date: today,
    prices_include_tax: v.pricesIncludeTax ?? defaults.pricesIncludeTaxDefault,
    notes: v.notes,
  }).select("id").single();
  if (error) {
    logServerError("invoices.create", error);
    return fail(toUserMessage(error, "We couldn't create the invoice."));
  }
  return ok({ id: data.id });
}

function rpcObject(data: Json | null): Record<string, Json | undefined> {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, Json | undefined>) : {};
}

/** Completed job → draft invoice (copies the quote's lines when the job came from a quote). Idempotent. */
export async function createInvoiceFromJob(ctx: ServiceContext, jobId: string): Promise<ActionResult<{ invoiceId: string; created: boolean }>> {
  if (!ctx.permissions.can("invoices.write")) return fail("You don't have permission to create invoices.");
  const { data, error } = await ctx.supabase.rpc("create_invoice_from_job", { p_job_id: jobId });
  if (error) {
    logServerError("invoices.fromJob", error);
    return fail(toUserMessage(error, "We couldn't create the invoice."));
  }
  const r = rpcObject(data);
  if (typeof r.invoice_id !== "string") return fail("We couldn't create the invoice.");
  return ok({ invoiceId: r.invoice_id, created: r.created === true });
}

/** Accepted quote → draft invoice. Idempotent. */
export const createInvoiceFromQuote = createInvoiceFromQuoteImpl;

export async function saveInvoiceDraft(
  ctx: ServiceContext,
  id: string,
  input: SaveInvoiceDraftInput,
): Promise<ActionResult<{ id: string; subtotal: string; discountTotal: string; taxTotal: string; total: string }>> {
  if (!ctx.permissions.can("invoices.write")) return fail("You don't have permission to edit invoices.");
  const parsed = saveInvoiceDraftSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", lineFieldErrors(parsed.error));
  const { header: h, items } = parsed.data;

  const { data: current, error: curErr } = await ctx.supabase.from("invoices").select("id, status")
    .eq("organisation_id", ctx.organisationId).eq("id", id).maybeSingle();
  if (curErr) {
    logServerError("invoices.save.read", curErr);
    return fail(toUserMessage(curErr, "We couldn't save the invoice."));
  }
  if (!current) return fail("We couldn't find that invoice, or you don't have access to it.");
  if (current.status !== "draft") return fail("This invoice has been issued and can no longer be edited.");

  const { error: hErr } = await ctx.supabase.from("invoices").update({
    customer_id: h.customerId, contact_id: h.contactId, site_address_id: h.siteAddressId, title: h.title,
    issue_date: h.issueDate, due_date: h.dueDate, prices_include_tax: h.pricesIncludeTax, notes: h.notes, terms: h.terms,
  }).eq("organisation_id", ctx.organisationId).eq("id", id);
  if (hErr) {
    logServerError("invoices.save.header", hErr);
    return fail(toUserMessage(hErr, "We couldn't save the invoice."));
  }

  const { data: existing, error: exErr } = await ctx.supabase.from("invoice_items").select("id")
    .eq("organisation_id", ctx.organisationId).eq("invoice_id", id);
  if (exErr) {
    logServerError("invoices.save.items", exErr);
    return fail(toUserMessage(exErr, "We couldn't save the invoice lines."));
  }
  const plan = planItemSync((existing ?? []).map((r) => r.id), items);
  if (plan.rows.length) {
    const { error } = await ctx.supabase.from("invoice_items")
      .upsert(plan.rows.map((r) => ({ ...r, organisation_id: ctx.organisationId, invoice_id: id })), { onConflict: "id" });
    if (error) {
      logServerError("invoices.save.upsert", error);
      return fail(toUserMessage(error, "We couldn't save the invoice lines."));
    }
  }
  if (plan.removeIds.length) {
    const { error } = await ctx.supabase.from("invoice_items").delete()
      .eq("organisation_id", ctx.organisationId).eq("invoice_id", id).in("id", plan.removeIds);
    if (error) {
      logServerError("invoices.save.delete", error);
      return fail(toUserMessage(error, "We couldn't remove deleted lines."));
    }
  }
  const { data: t, error: tErr } = await ctx.supabase.from("invoices").select("subtotal, discount_total, tax_total, total")
    .eq("organisation_id", ctx.organisationId).eq("id", id).single();
  if (tErr) {
    logServerError("invoices.save.totals", tErr);
    return fail(toUserMessage(tErr, "The invoice was saved, but we couldn't reload its totals."));
  }
  return ok({ id, subtotal: money2(t.subtotal), discountTotal: money2(t.discount_total), taxTotal: money2(t.tax_total), total: money2(t.total) });
}

export async function issueInvoice(ctx: ServiceContext, id: string): Promise<ActionResult<{ id: string; invoiceNumber: string; status: string; already: boolean }>> {
  if (!ctx.permissions.can("invoices.issue")) return fail("You don't have permission to issue invoices.");
  const { data, error } = await ctx.supabase.rpc("issue_invoice", { p_invoice_id: id });
  if (error) {
    logServerError("invoices.issue", error);
    return fail(toUserMessage(error, "We couldn't issue the invoice."));
  }
  const r = rpcObject(data);
  return ok({ id, invoiceNumber: String(r.invoice_number ?? ""), status: String(r.status ?? "issued"), already: r.already === true });
}

export async function voidInvoice(ctx: ServiceContext, id: string, reason: string): Promise<ActionResult<{ id: string; already: boolean }>> {
  if (!ctx.permissions.can("invoices.issue")) return fail("You don't have permission to void invoices.");
  const parsed = voidInvoiceSchema.safeParse({ reason });
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const { data, error } = await ctx.supabase.rpc("void_invoice", { p_invoice_id: id, p_reason: parsed.data.reason });
  if (error) {
    logServerError("invoices.void", error);
    return fail(toUserMessage(error, "We couldn't void the invoice."));
  }
  return ok({ id, already: rpcObject(data).already === true });
}

export async function archiveInvoice(ctx: ServiceContext, id: string): Promise<ActionResult<{ id: string; already: boolean }>> {
  if (!ctx.permissions.can("invoices.write")) return fail("You don't have permission to archive invoices.");
  const { data, error } = await ctx.supabase.rpc("archive_invoice", { p_invoice_id: id });
  if (error) {
    logServerError("invoices.archive", error);
    return fail(toUserMessage(error, "We couldn't archive the invoice."));
  }
  return ok({ id, already: rpcObject(data).already === true });
}

export interface UnpaidInvoice {
  id: string; invoice_number: string | null; customer_id: string; customer_name: string; due_date: string | null;
  total: string; amount_due: string; currency: string; effective_status: string;
}

const UNPAID_COLUMNS = "id, invoice_number, customer_id, customer_name_snapshot, due_date, total, amount_due, currency, status" as const;

/** Unpaid (issued / part-paid, amount due > 0) invoices, optionally for one customer — payment pickers and AI disambiguation. */
export async function listUnpaidInvoicesForCustomer(ctx: ServiceContext, customerId?: string | null, limit = 50): Promise<ActionResult<UnpaidInvoice[]>> {
  const today = await orgToday(ctx);
  let q = ctx.supabase.from("invoices").select(UNPAID_COLUMNS).eq("organisation_id", ctx.organisationId)
    .in("status", ["issued", "partially_paid"]).gt("amount_due", 0);
  if (customerId) q = q.eq("customer_id", customerId);
  const { data, error } = await q.order("due_date", { ascending: true }).limit(Math.min(Math.max(limit, 1), 200));
  if (error) {
    logServerError("invoices.unpaid", error);
    return fail(toUserMessage(error, "We couldn't load unpaid invoices."));
  }
  return ok((data ?? []).map((r) => ({
    id: r.id, invoice_number: r.invoice_number, customer_id: r.customer_id, customer_name: r.customer_name_snapshot ?? "Customer",
    due_date: r.due_date, total: money2(r.total), amount_due: money2(r.amount_due), currency: r.currency,
    effective_status: effectiveInvoiceStatus(r.status, r.due_date, r.amount_due, today),
  })));
}

/** Oldest-first overdue invoices. */
export async function listOverdueInvoices(ctx: ServiceContext, limit = 20): Promise<ActionResult<UnpaidInvoice[]>> {
  const today = await orgToday(ctx);
  const { data, error } = await ctx.supabase.from("invoices").select(UNPAID_COLUMNS).eq("organisation_id", ctx.organisationId)
    .in("status", ["issued", "partially_paid"]).gt("amount_due", 0).lt("due_date", today)
    .order("due_date", { ascending: true }).limit(Math.min(Math.max(limit, 1), 100));
  if (error) {
    logServerError("invoices.overdue", error);
    return fail(toUserMessage(error, "We couldn't load overdue invoices."));
  }
  return ok((data ?? []).map((r) => ({
    id: r.id, invoice_number: r.invoice_number, customer_id: r.customer_id, customer_name: r.customer_name_snapshot ?? "Customer",
    due_date: r.due_date, total: money2(r.total), amount_due: money2(r.amount_due), currency: r.currency, effective_status: "overdue",
  })));
}

export interface InvoiceMatch {
  id: string; invoice_number: string | null; title: string | null; customer_name: string; status: string; effective_status: string;
  total: string; amount_due: string; currency: string; due_date: string | null;
}

/** Lookup for AI disambiguation ("INV-0042", "the ABC invoice"). Newest first. */
export async function findInvoices(ctx: ServiceContext, q: string, limit = 8): Promise<ActionResult<InvoiceMatch[]>> {
  const r = await listInvoices(ctx, { q, status: "all", pageSize: Math.min(Math.max(limit, 1), 20) });
  if (!r.ok) return r;
  return ok(r.data.invoices.map((x) => ({
    id: x.id, invoice_number: x.invoice_number, title: x.title, customer_name: x.customer_name, status: x.status,
    effective_status: x.effective_status, total: x.total, amount_due: x.amount_due, currency: x.currency, due_date: x.due_date,
  })));
}

/** Completed jobs with no live invoice, and accepted quotes with no live invoice — sources for "New invoice". */
export async function listInvoiceSources(ctx: ServiceContext): Promise<ActionResult<{
  jobs: { id: string; job_number: string; title: string; customer_name: string; completed_at: string | null }[];
  quotes: { id: string; quote_number: string; title: string | null; customer_name: string; total: string; currency: string }[];
}>> {
  const [jobs, quotes, invoiced] = await Promise.all([
    ctx.permissions.can("jobs.read_all")
      ? ctx.supabase.from("jobs").select("id, job_number, title, quote_id, completed_at, customer:customers!jobs_customer_fk(display_name)")
        .eq("organisation_id", ctx.organisationId).eq("status", "completed").order("completed_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [], error: null }),
    ctx.permissions.can("quotes.read")
      ? ctx.supabase.from("quotes").select("id, quote_number, title, total, currency, customer_name_snapshot")
        .eq("organisation_id", ctx.organisationId).eq("status", "accepted").order("accepted_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [], error: null }),
    ctx.supabase.from("invoices").select("job_id, quote_id").eq("organisation_id", ctx.organisationId).neq("status", "void")
      .or("job_id.not.is.null,quote_id.not.is.null").order("created_at", { ascending: false }).limit(1000),
  ]);
  const error = jobs.error ?? quotes.error ?? invoiced.error;
  if (error) {
    logServerError("invoices.sources", error);
    return fail(toUserMessage(error, "We couldn't load jobs and quotes to invoice."));
  }
  const jobIds = new Set((invoiced.data ?? []).map((r) => r.job_id).filter(Boolean));
  const quoteIds = new Set((invoiced.data ?? []).map((r) => r.quote_id).filter(Boolean));
  type JobRow = { id: string; job_number: string; title: string; quote_id: string | null; completed_at: string | null; customer: { display_name: string } | null };
  type QuoteRow = { id: string; quote_number: string; title: string | null; total: number; currency: string; customer_name_snapshot: string | null };
  return ok({
    jobs: ((jobs.data ?? []) as JobRow[])
      .filter((j) => !jobIds.has(j.id) && !(j.quote_id && quoteIds.has(j.quote_id)))
      .map((j) => ({ id: j.id, job_number: j.job_number, title: j.title, customer_name: j.customer?.display_name ?? "Customer", completed_at: j.completed_at })),
    quotes: ((quotes.data ?? []) as QuoteRow[])
      .filter((q) => !quoteIds.has(q.id))
      .map((q) => ({ id: q.id, quote_number: q.quote_number, title: q.title, customer_name: q.customer_name_snapshot ?? "Customer", total: money2(q.total), currency: q.currency })),
  });
}
