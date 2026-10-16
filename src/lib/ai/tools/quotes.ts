import { z } from "zod";
import {
  addQuoteLine, createInvoiceFromQuote, createQuote, findQuotes, getQuote, issueQuote, setQuoteOutcome,
} from "@/domain/quotes/service";
import { getTodaySummary } from "@/domain/today/service";
import { ok, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { AIToolDefinition } from "../types";
import { lineIn, money, toLineItem } from "./shared";

const n2 = (v: unknown) => Number(v ?? 0).toFixed(2);

/** Compact, DB-computed view of a quote for the model (totals come from Postgres, never from the model). */
async function quoteSummary(ctx: ServiceContext, id: string): Promise<ActionResult<Record<string, unknown>>> {
  const r = await getQuote(ctx, id);
  if (!r.ok) return r;
  const { quote: q, items, effectiveStatus, customer, jobId, invoiceId } = r.data;
  return ok({
    id: q.id, quoteNumber: q.quote_number, status: effectiveStatus, customer: customer?.display_name ?? q.customer_name_snapshot,
    customerId: q.customer_id, title: q.title, issueDate: q.issue_date, expiryDate: q.expiry_date, currency: q.currency,
    pricesIncludeVat: q.prices_include_tax,
    lines: items.slice(0, 30).map((i) => ({ description: i.description, quantity: Number(i.quantity), unitPrice: money(n2(i.unit_price), q.currency), lineTotal: money(n2(i.line_total), q.currency) })),
    subtotal: money(n2(q.subtotal), q.currency), vat: money(n2(q.tax_total), q.currency), total: money(n2(q.total), q.currency),
    totalFormatted: money(n2(q.total), q.currency), jobId, invoiceId,
  });
}

async function quoteLabel(ctx: ServiceContext, id: string): Promise<string> {
  const r = await getQuote(ctx, id);
  if (!r.ok) return "this quote";
  const q = r.data.quote;
  return `${q.quote_number} for ${r.data.customer?.display_name ?? q.customer_name_snapshot ?? "the customer"} (${money(n2(q.total), q.currency)})`;
}

const quoteFocus = (out: Record<string, unknown>) => {
  const f = [{ type: "quote" as const, id: String(out.id), label: String(out.quoteNumber ?? "quote") }];
  if (out.customerId) f.push({ type: "customer" as const, id: String(out.customerId), label: String(out.customer ?? "customer") } as never);
  return f;
};

const findInput = z.object({ query: z.string().trim().min(1).max(100).describe("Quote number (Q-0003), customer name or title") });

export const findQuotesTool: AIToolDefinition<typeof findInput> = {
  name: "find_quotes",
  description: "Find quotes by number, customer name or title. Newest first, up to 8, with id, number, customer, effective status and total.",
  actionClass: "read",
  requiredPermissions: ["quotes.read"],
  inputSchema: findInput,
  execute: async (ctx, i) => {
    const r = await findQuotes(ctx, i.query, 8);
    if (!r.ok) return r;
    return ok({ quotes: r.data.map((q) => ({ id: q.id, number: q.quote_number, customer: q.customer_name, title: q.title, status: q.effective_status, total: money(q.total, q.currency) })) });
  },
  summarise: (i) => `Find quotes “${i.query}”`,
};

const idInput = z.object({ quoteId: z.uuid() });

export const getQuoteTool: AIToolDefinition<typeof idInput, Record<string, unknown>> = {
  name: "get_quote",
  description: "Show one quote: number, status, customer, lines and the totals calculated by the app.",
  actionClass: "read",
  requiredPermissions: ["quotes.read"],
  inputSchema: idInput,
  execute: (ctx, i) => quoteSummary(ctx, i.quoteId),
  summarise: () => "Show quote",
  card: (i, out) => ({ label: `Open ${String(out.quoteNumber ?? "quote")}`, href: `/app/sales/quotes/${i.quoteId}` }),
  focus: (_i, out) => quoteFocus(out),
};

export const listQuotesNeedingFollowUpTool: AIToolDefinition<z.ZodObject<Record<string, never>>> = {
  name: "list_quotes_needing_followup",
  description: "Sent quotes with no reply after the configured number of days (deterministic rule), plus how many expire soon.",
  actionClass: "read",
  requiredPermissions: ["quotes.read"],
  inputSchema: z.object({}),
  execute: async (ctx) => {
    const r = await getTodaySummary(ctx);
    if (!r.ok) return r;
    const q = r.data.quotes;
    return ok({ count: q?.followupCount ?? 0, expiringSoon: q?.expiringCount ?? 0, quotes: q?.followup ?? [] });
  },
  summarise: () => "List quotes needing follow-up",
  card: () => ({ label: "Open quotes", href: "/app/sales/quotes?status=open" }),
};

const createInput = z.object({
  customerId: z.uuid().describe("From search_customers; ask the user if several match"),
  title: z.string().trim().max(200).optional().describe("Short description, e.g. 'Pest control'"),
  lines: z.array(lineIn).min(1).max(30),
  pricesIncludeVat: z.boolean().optional().describe("true only if the user said the prices include VAT; 'excluding VAT' → false"),
  leadId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  siteAddressId: z.uuid().optional(),
});

export const createQuoteDraftTool: AIToolDefinition<typeof createInput, Record<string, unknown>> = {
  name: "create_quote_draft",
  description: "Create a DRAFT quote for a customer with line items. Totals and VAT are calculated by the app — report the returned totals, never your own maths.",
  actionClass: "draft",
  requiredPermissions: ["quotes.write"],
  inputSchema: createInput,
  execute: async (ctx, i) => {
    const c = await createQuote(ctx, {
      customerId: i.customerId, title: i.title, leadId: i.leadId, contactId: i.contactId, siteAddressId: i.siteAddressId, pricesIncludeTax: i.pricesIncludeVat,
    });
    if (!c.ok) return c;
    for (const l of i.lines) {
      const a = await addQuoteLine(ctx, c.data.id, toLineItem(l));
      if (!a.ok) return a;
    }
    return quoteSummary(ctx, c.data.id);
  },
  summarise: (i) => `Draft quote with ${i.lines.length} line(s)`,
  card: (_i, out) => ({ label: `Draft ${String(out.quoteNumber ?? "quote")}`, href: `/app/sales/quotes/${String(out.id)}` }),
  focus: (_i, out) => quoteFocus(out),
};

const addLineInput = lineIn.extend({ quoteId: z.uuid() });

export const addQuoteLineTool: AIToolDefinition<typeof addLineInput, Record<string, unknown>> = {
  name: "add_quote_line",
  description: "Add a line (e.g. a call-out fee) to a DRAFT quote. Returns the app-calculated totals.",
  actionClass: "draft",
  requiredPermissions: ["quotes.write"],
  inputSchema: addLineInput,
  execute: async (ctx, { quoteId, ...l }) => {
    const a = await addQuoteLine(ctx, quoteId, toLineItem(l));
    if (!a.ok) return a;
    return quoteSummary(ctx, quoteId);
  },
  summarise: (i) => `Add “${i.description}” to the quote`,
  card: (i, out) => ({ label: `Open ${String(out.quoteNumber ?? "quote")}`, href: `/app/sales/quotes/${i.quoteId}` }),
  focus: (_i, out) => quoteFocus(out),
};

export const markQuoteSentTool: AIToolDefinition<typeof idInput> = {
  name: "mark_quote_sent",
  description: "Issue a draft quote and mark it as sent manually (locks it; numbers and tax are snapshotted). No message is sent — no channel is connected. Requires confirmation.",
  actionClass: "consequential",
  requiredPermissions: ["quotes.issue"],
  inputSchema: idInput,
  execute: (ctx, i) => issueQuote(ctx, i.quoteId, "manual"),
  summarise: () => "Issue this quote and mark it as sent",
  describe: async (ctx, i) => `Issue quote ${await quoteLabel(ctx, i.quoteId)} and mark it as sent (you send it yourself)`,
  card: (i) => ({ label: "Open quote", href: `/app/sales/quotes/${i.quoteId}` }),
};

const acceptInput = z.object({
  quoteId: z.uuid(),
  method: z.enum(["verbal", "email", "whatsapp", "signed", "other"]).optional().describe("How the customer accepted; default verbal"),
});

export const acceptQuoteTool: AIToolDefinition<typeof acceptInput> = {
  name: "accept_quote",
  description: "Record that the customer accepted a sent quote. Requires confirmation. Afterwards offer to create a job from it.",
  actionClass: "consequential",
  requiredPermissions: ["quotes.issue"],
  inputSchema: acceptInput,
  execute: (ctx, i) => setQuoteOutcome(ctx, i.quoteId, "accepted", i.method ?? "verbal"),
  summarise: () => "Mark this quote accepted",
  describe: async (ctx, i) => `Mark quote ${await quoteLabel(ctx, i.quoteId)} as accepted (${i.method ?? "verbal"})`,
  card: (i) => ({ label: "Open quote", href: `/app/sales/quotes/${i.quoteId}` }),
};

const declineInput = z.object({ quoteId: z.uuid(), reason: z.string().trim().max(500).optional() });

export const declineQuoteTool: AIToolDefinition<typeof declineInput> = {
  name: "decline_quote",
  description: "Record that the customer declined a sent quote. Requires confirmation.",
  actionClass: "consequential",
  requiredPermissions: ["quotes.issue"],
  inputSchema: declineInput,
  execute: (ctx, i) => setQuoteOutcome(ctx, i.quoteId, "declined", undefined, i.reason),
  summarise: () => "Mark this quote declined",
  describe: async (ctx, i) => `Mark quote ${await quoteLabel(ctx, i.quoteId)} as declined${i.reason ? ` (${i.reason})` : ""}`,
  card: (i) => ({ label: "Open quote", href: `/app/sales/quotes/${i.quoteId}` }),
};

export const createInvoiceFromQuoteTool: AIToolDefinition<typeof idInput, { invoiceId: string; created: boolean }> = {
  name: "create_invoice_from_quote",
  description: "Create a DRAFT invoice directly from an accepted quote (when no job is needed). Idempotent: returns the existing invoice if there is one.",
  actionClass: "draft",
  requiredPermissions: ["invoices.write"],
  inputSchema: idInput,
  execute: (ctx, i) => createInvoiceFromQuote(ctx, i.quoteId),
  summarise: () => "Draft an invoice from this quote",
  card: (_i, out) => ({ label: out.created ? "Draft invoice" : "Existing invoice", href: `/app/money/invoices/${out.invoiceId}` }),
  focus: (_i, out) => [{ type: "invoice", id: out.invoiceId, label: "draft invoice" }],
};
