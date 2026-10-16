import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import { effectiveQuoteStatus } from "@/lib/status";
import type { ServiceContext } from "@/domain/context";
import type { Json, Tables } from "@/types/database.types";
import { sanitiseSearch } from "@/domain/customers/schema";
import { orgToday, orgTimezone, todayInZone } from "@/domain/commercial/dates";
import { matchCustomerIds } from "@/domain/commercial/parties";
import { lineFieldErrors, lineItemSchema, planItemSync, toItemRow, money2, type LineItemInput } from "@/domain/commercial/line-items";
import { getDocumentDefaults } from "@/domain/financial-settings/service";
import {
  createQuoteSchema, listQuotesSchema, quoteOutcomeSchema, saveQuoteDraftSchema,
  type AcceptMethod, type CreateQuoteInput, type IssueMethod, type ListQuotesInput, type QuoteOutcome, type SaveQuoteDraftInput,
} from "./schema";

/**
 * Quotes — single implementation for screens and AI tools. Numbering, totals, snapshots,
 * defaults and every status transition are enforced by Postgres (migration 20261016000400).
 */

export type Quote = Tables<"quotes">;
export type QuoteItem = Tables<"quote_items">;

export interface QuoteListItem {
  id: string;
  quote_number: string;
  title: string | null;
  status: string;
  effective_status: string;
  issue_date: string;
  expiry_date: string | null;
  total: string;
  currency: string;
  customer_id: string;
  customer_name: string;
}

const LIST_COLUMNS =
  "id, quote_number, title, status, issue_date, expiry_date, total, currency, customer_id, customer_name_snapshot, customer:customers!quotes_customer_fk(display_name)" as const;

type ListRow = {
  id: string; quote_number: string; title: string | null; status: string; issue_date: string; expiry_date: string | null;
  total: number; currency: string; customer_id: string; customer_name_snapshot: string | null; customer: { display_name: string } | null;
};

function toListItem(r: ListRow, today: string): QuoteListItem {
  return {
    id: r.id, quote_number: r.quote_number, title: r.title, status: r.status,
    effective_status: effectiveQuoteStatus(r.status, r.expiry_date, today),
    issue_date: r.issue_date, expiry_date: r.expiry_date, total: money2(r.total), currency: r.currency,
    customer_id: r.customer_id, customer_name: r.customer_name_snapshot ?? r.customer?.display_name ?? "Customer",
  };
}

export async function listQuotes(
  ctx: ServiceContext,
  input: ListQuotesInput = {},
): Promise<ActionResult<{ quotes: QuoteListItem[]; total: number; page: number; pageSize: number; today: string }>> {
  const parsed = listQuotesSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid filter");
  const { status, customerId, q, page, pageSize } = parsed.data;
  const today = await orgToday(ctx);

  let query = ctx.supabase.from("quotes").select(LIST_COLUMNS, { count: "exact" }).eq("organisation_id", ctx.organisationId);
  switch (status) {
    case "all": query = query.neq("status", "archived"); break;
    // Expiry is always set (DB default on insert; required when saving a draft), so no null branch is needed
    // and the single PostgREST `or` stays free for the text search below.
    case "open": query = query.in("status", ["sent", "viewed"]).gte("expiry_date", today); break;
    case "expired": query = query.in("status", ["sent", "viewed"]).lt("expiry_date", today); break;
    default: query = query.eq("status", status);
  }
  if (customerId) query = query.eq("customer_id", customerId);
  if (q) {
    const term = sanitiseSearch(q);
    if (term) {
      const ids = await matchCustomerIds(ctx, term);
      const parts = [`quote_number.ilike.*${term}*`, `title.ilike.*${term}*`, `customer_name_snapshot.ilike.*${term}*`];
      if (ids.length) parts.push(`customer_id.in.(${ids.join(",")})`);
      query = query.or(parts.join(","));
    }
  }
  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) {
    logServerError("quotes.list", error);
    return fail(toUserMessage(error, "We couldn't load quotes."));
  }
  return ok({ quotes: ((data ?? []) as ListRow[]).map((r) => toListItem(r, today)), total: count ?? 0, page, pageSize, today });
}

export interface QuoteDetail {
  quote: Quote;
  items: QuoteItem[];
  effectiveStatus: string;
  today: string;
  customer: { id: string; display_name: string } | null;
  contact: { id: string; name: string } | null;
  site: { id: string; label: string } | null;
  lead: { id: string; title: string } | null;
  revisionOf: { id: string; quote_number: string } | null;
  jobId: string | null;
  invoiceId: string | null;
}

export async function getQuote(ctx: ServiceContext, id: string): Promise<ActionResult<QuoteDetail>> {
  const [q, items, tz] = await Promise.all([
    ctx.supabase.from("quotes").select("*").eq("organisation_id", ctx.organisationId).eq("id", id).maybeSingle(),
    ctx.supabase.from("quote_items").select("*").eq("organisation_id", ctx.organisationId).eq("quote_id", id)
      .order("sort_order").order("created_at").limit(500),
    orgTimezone(ctx),
  ]);
  const error = q.error ?? items.error;
  if (error) {
    logServerError("quotes.get", error);
    return fail(toUserMessage(error, "We couldn't load this quote."));
  }
  if (!q.data) return fail("We couldn't find that quote, or you don't have access to it.");
  const quote = q.data;
  const today = todayInZone(tz);

  const none = Promise.resolve({ data: null });
  const [customer, contact, site, lead, revision, job, invoice] = await Promise.all([
    ctx.supabase.from("customers").select("id, display_name").eq("organisation_id", ctx.organisationId).eq("id", quote.customer_id).maybeSingle(),
    quote.contact_id
      ? ctx.supabase.from("customer_contacts").select("id, first_name, last_name").eq("organisation_id", ctx.organisationId).eq("id", quote.contact_id).maybeSingle()
      : none,
    quote.site_address_id
      ? ctx.supabase.from("customer_addresses").select("id, label, line1, suburb, city").eq("organisation_id", ctx.organisationId).eq("id", quote.site_address_id).maybeSingle()
      : none,
    quote.lead_id && ctx.permissions.can("leads.read")
      ? ctx.supabase.from("leads").select("id, title").eq("organisation_id", ctx.organisationId).eq("id", quote.lead_id).maybeSingle()
      : none,
    quote.revision_of_id
      ? ctx.supabase.from("quotes").select("id, quote_number").eq("organisation_id", ctx.organisationId).eq("id", quote.revision_of_id).maybeSingle()
      : none,
    ctx.permissions.canAny("jobs.read_all")
      ? ctx.supabase.from("jobs").select("id").eq("organisation_id", ctx.organisationId).eq("quote_id", id).neq("status", "cancelled").limit(1).maybeSingle()
      : none,
    ctx.permissions.can("invoices.read")
      ? ctx.supabase.from("invoices").select("id").eq("organisation_id", ctx.organisationId).eq("quote_id", id).neq("status", "void").limit(1).maybeSingle()
      : none,
  ]);
  const ct = contact.data as { id: string; first_name: string; last_name: string | null } | null;
  const st = site.data as { id: string; label: string | null; line1: string; suburb: string | null; city: string | null } | null;
  return ok({
    quote,
    items: items.data ?? [],
    effectiveStatus: effectiveQuoteStatus(quote.status, quote.expiry_date, today),
    today,
    customer: customer.data ?? null,
    contact: ct ? { id: ct.id, name: [ct.first_name, ct.last_name].filter(Boolean).join(" ") } : null,
    site: st ? { id: st.id, label: [st.label, [st.line1, st.suburb, st.city].filter(Boolean).join(", ")].filter(Boolean).join(" — ") } : null,
    lead: (lead.data as { id: string; title: string } | null) ?? null,
    revisionOf: (revision.data as { id: string; quote_number: string } | null) ?? null,
    jobId: (job.data as { id: string } | null)?.id ?? null,
    invoiceId: (invoice.data as { id: string } | null)?.id ?? null,
  });
}

export async function createQuote(ctx: ServiceContext, input: CreateQuoteInput): Promise<ActionResult<{ id: string; quoteNumber: string }>> {
  if (!ctx.permissions.can("quotes.write")) return fail("You don't have permission to create quotes.");
  const parsed = createQuoteSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const [defaults, today] = await Promise.all([getDocumentDefaults(ctx), orgToday(ctx)]);

  const { data, error } = await ctx.supabase.from("quotes").insert({
    organisation_id: ctx.organisationId,
    // Placeholder: the DB guard always assigns the next Q- number on insert.
    quote_number: "pending",
    customer_id: v.customerId,
    contact_id: v.contactId,
    site_address_id: v.siteAddressId,
    lead_id: v.leadId,
    title: v.title,
    // Explicit: CURRENT_DATE in the DB is UTC, not the organisation's day.
    issue_date: v.issueDate ?? today,
    // Expiry left empty → the DB guard sets issue date + quote validity days.
    expiry_date: v.expiryDate ?? undefined,
    // Explicit: the column default (false) would otherwise mask the organisation's setting.
    prices_include_tax: v.pricesIncludeTax ?? defaults.pricesIncludeTaxDefault,
    notes: v.notes,
  }).select("id, quote_number").single();
  if (error) {
    logServerError("quotes.create", error);
    return fail(toUserMessage(error, "We couldn't create the quote."));
  }
  return ok({ id: data.id, quoteNumber: data.quote_number });
}

/**
 * Save a draft's header and replace its lines. Order: header (may re-price lines on a tax-basis
 * change) → upsert every line by id → delete removed lines. Each step leaves DB totals consistent
 * and a retry of the same payload converges (lines carry stable ids).
 */
export async function saveQuoteDraft(
  ctx: ServiceContext,
  id: string,
  input: SaveQuoteDraftInput,
): Promise<ActionResult<{ id: string; subtotal: string; discountTotal: string; taxTotal: string; total: string }>> {
  if (!ctx.permissions.can("quotes.write")) return fail("You don't have permission to edit quotes.");
  const parsed = saveQuoteDraftSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", lineFieldErrors(parsed.error));
  const { header: h, items } = parsed.data;

  const { data: current, error: curErr } = await ctx.supabase.from("quotes").select("id, status")
    .eq("organisation_id", ctx.organisationId).eq("id", id).maybeSingle();
  if (curErr) {
    logServerError("quotes.save.read", curErr);
    return fail(toUserMessage(curErr, "We couldn't save the quote."));
  }
  if (!current) return fail("We couldn't find that quote, or you don't have access to it.");
  if (current.status !== "draft") return fail("This quote has been issued and can no longer be edited. Duplicate it to make a revision.");

  const { error: hErr } = await ctx.supabase.from("quotes").update({
    customer_id: h.customerId, contact_id: h.contactId, site_address_id: h.siteAddressId, title: h.title,
    issue_date: h.issueDate, expiry_date: h.expiryDate, prices_include_tax: h.pricesIncludeTax, notes: h.notes, terms: h.terms,
  }).eq("organisation_id", ctx.organisationId).eq("id", id);
  if (hErr) {
    logServerError("quotes.save.header", hErr);
    return fail(toUserMessage(hErr, "We couldn't save the quote."));
  }

  const { data: existing, error: exErr } = await ctx.supabase.from("quote_items").select("id")
    .eq("organisation_id", ctx.organisationId).eq("quote_id", id);
  if (exErr) {
    logServerError("quotes.save.items", exErr);
    return fail(toUserMessage(exErr, "We couldn't save the quote lines."));
  }
  const plan = planItemSync((existing ?? []).map((r) => r.id), items);
  if (plan.rows.length) {
    const { error } = await ctx.supabase.from("quote_items")
      .upsert(plan.rows.map((r) => ({ ...r, organisation_id: ctx.organisationId, quote_id: id })), { onConflict: "id" });
    if (error) {
      logServerError("quotes.save.upsert", error);
      return fail(toUserMessage(error, "We couldn't save the quote lines."));
    }
  }
  if (plan.removeIds.length) {
    const { error } = await ctx.supabase.from("quote_items").delete()
      .eq("organisation_id", ctx.organisationId).eq("quote_id", id).in("id", plan.removeIds);
    if (error) {
      logServerError("quotes.save.delete", error);
      return fail(toUserMessage(error, "We couldn't remove deleted lines."));
    }
  }
  const { data: totals, error: tErr } = await ctx.supabase.from("quotes").select("subtotal, discount_total, tax_total, total")
    .eq("organisation_id", ctx.organisationId).eq("id", id).single();
  if (tErr) {
    logServerError("quotes.save.totals", tErr);
    return fail(toUserMessage(tErr, "The quote was saved, but we couldn't reload its totals."));
  }
  return ok({ id, subtotal: money2(totals.subtotal), discountTotal: money2(totals.discount_total), taxTotal: money2(totals.tax_total), total: money2(totals.total) });
}

function rpcObject(data: Json | null): Record<string, Json | undefined> {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, Json | undefined>) : {};
}

export async function issueQuote(ctx: ServiceContext, id: string, method: IssueMethod = "manual"): Promise<ActionResult<{ id: string; quoteNumber: string; status: string; already: boolean }>> {
  if (!ctx.permissions.can("quotes.issue")) return fail("You don't have permission to issue quotes.");
  if (method !== "manual" && method !== "download") return fail("No messaging channel is connected yet.");
  const { data, error } = await ctx.supabase.rpc("issue_quote", { p_quote_id: id, p_method: method });
  if (error) {
    logServerError("quotes.issue", error);
    return fail(toUserMessage(error, "We couldn't issue the quote."));
  }
  const r = rpcObject(data);
  return ok({ id, quoteNumber: String(r.quote_number ?? ""), status: String(r.status ?? "sent"), already: r.already === true });
}

export async function setQuoteOutcome(
  ctx: ServiceContext,
  id: string,
  outcome: QuoteOutcome,
  method?: AcceptMethod,
  reason?: string,
): Promise<ActionResult<{ id: string; status: string; already: boolean }>> {
  if (!ctx.permissions.can("quotes.issue")) return fail("You don't have permission to change this quote.");
  const parsed = quoteOutcomeSchema.safeParse({ outcome, method, reason });
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const { data, error } = await ctx.supabase.rpc("set_quote_outcome", {
    p_quote_id: id, p_outcome: v.outcome, p_method: v.method ?? undefined, p_reason: v.reason ?? undefined,
  });
  if (error) {
    logServerError("quotes.outcome", error);
    return fail(toUserMessage(error, "We couldn't update the quote."));
  }
  const r = rpcObject(data);
  return ok({ id, status: String(r.status ?? v.outcome), already: r.already === true });
}

export const archiveQuote = (ctx: ServiceContext, id: string) => setQuoteOutcome(ctx, id, "archived");

/** New draft revision with the same lines; the original stays untouched. */
export async function duplicateQuote(ctx: ServiceContext, id: string): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("quotes.write")) return fail("You don't have permission to create quotes.");
  const { data, error } = await ctx.supabase.rpc("duplicate_quote", { p_quote_id: id });
  if (error || !data) {
    logServerError("quotes.duplicate", error);
    return fail(toUserMessage(error, "We couldn't duplicate the quote."));
  }
  return ok({ id: data });
}

/** Accepted quote → draft invoice (idempotent; returns the existing invoice if there is one). */
export async function createInvoiceFromQuote(ctx: ServiceContext, quoteId: string): Promise<ActionResult<{ invoiceId: string; created: boolean }>> {
  if (!ctx.permissions.can("invoices.write")) return fail("You don't have permission to create invoices.");
  const { data, error } = await ctx.supabase.rpc("create_invoice_from_quote", { p_quote_id: quoteId });
  if (error) {
    logServerError("quotes.toInvoice", error);
    return fail(toUserMessage(error, "We couldn't create the invoice."));
  }
  const r = rpcObject(data);
  if (typeof r.invoice_id !== "string") return fail("We couldn't create the invoice.");
  return ok({ invoiceId: r.invoice_id, created: r.created === true });
}

export interface QuoteMatch {
  id: string; quote_number: string; title: string | null; customer_name: string; status: string; effective_status: string; total: string; currency: string; issue_date: string;
}

/** Lookup for AI disambiguation ("the Smith quote", "Q-0042"). Newest first, max 8. */
export async function findQuotes(ctx: ServiceContext, q: string, limit = 8): Promise<ActionResult<QuoteMatch[]>> {
  const r = await listQuotes(ctx, { q, status: "all", pageSize: Math.min(Math.max(limit, 1), 20) });
  if (!r.ok) return r;
  return ok(r.data.quotes.map((x) => ({
    id: x.id, quote_number: x.quote_number, title: x.title, customer_name: x.customer_name, status: x.status,
    effective_status: x.effective_status, total: x.total, currency: x.currency, issue_date: x.issue_date,
  })));
}

/** Append one line to a draft quote (AI tool). Returns the DB-computed totals. */
export async function addQuoteLine(ctx: ServiceContext, quoteId: string, line: LineItemInput): Promise<ActionResult<{ itemId: string; total: string }>> {
  if (!ctx.permissions.can("quotes.write")) return fail("You don't have permission to edit quotes.");
  const parsed = lineItemSchema.safeParse(line);
  if (!parsed.success) return fail("Please check the line details.", lineFieldErrors(parsed.error));
  const { data: q, error: qErr } = await ctx.supabase.from("quotes").select("id, status")
    .eq("organisation_id", ctx.organisationId).eq("id", quoteId).maybeSingle();
  if (qErr) {
    logServerError("quotes.addLine.read", qErr);
    return fail(toUserMessage(qErr, "We couldn't add the line."));
  }
  if (!q) return fail("We couldn't find that quote, or you don't have access to it.");
  if (q.status !== "draft") return fail("Only draft quotes can be changed. Duplicate the quote to revise it.");
  const { data: last } = await ctx.supabase.from("quote_items").select("sort_order")
    .eq("organisation_id", ctx.organisationId).eq("quote_id", quoteId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { id: _ignored, ...lineValue } = parsed.data;
  void _ignored;
  const { data, error } = await ctx.supabase.from("quote_items").insert({
    ...toItemRow({ ...lineValue }, (last?.sort_order ?? -1) + 1), organisation_id: ctx.organisationId, quote_id: quoteId,
  }).select("id").single();
  if (error) {
    logServerError("quotes.addLine", error);
    return fail(toUserMessage(error, "We couldn't add the line."));
  }
  const { data: t } = await ctx.supabase.from("quotes").select("total").eq("organisation_id", ctx.organisationId).eq("id", quoteId).single();
  return ok({ itemId: data.id, total: money2(t?.total) });
}

/** Lead → prefill data for a new quote. If the lead has no customer yet the UI asks to convert it first. */
export async function getLeadForQuote(ctx: ServiceContext, leadId: string): Promise<ActionResult<{ id: string; title: string; customerId: string | null; contactId: string | null; siteAddressId: string | null; summary: string | null }>> {
  const { data, error } = await ctx.supabase.from("leads").select("id, title, customer_id, contact_id, site_address_id, service_summary")
    .eq("organisation_id", ctx.organisationId).eq("id", leadId).maybeSingle();
  if (error) {
    logServerError("quotes.lead", error);
    return fail(toUserMessage(error, "We couldn't load the lead."));
  }
  if (!data) return fail("We couldn't find that lead, or you don't have access to it.");
  return ok({ id: data.id, title: data.title, customerId: data.customer_id, contactId: data.contact_id, siteAddressId: data.site_address_id, summary: data.service_summary });
}
