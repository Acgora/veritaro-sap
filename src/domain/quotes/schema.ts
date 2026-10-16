import { z } from "zod";
import { ISO_DATE } from "@/domain/commercial/dates";
import { lineItemSchema, lineItemsSchema } from "@/domain/commercial/line-items";

export { lineItemSchema as quoteLineSchema };

const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const optUuid = z.union([z.uuid(), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));
const optDate = z.union([z.string().regex(ISO_DATE, "Use a valid date"), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));

/** List filter chips. "open" = sent or viewed and not expired. "all" excludes archived. */
export const QUOTE_FILTERS = ["all", "draft", "open", "accepted", "declined", "expired", "archived"] as const;
export type QuoteFilter = (typeof QUOTE_FILTERS)[number];
export const QUOTE_FILTER_LABELS: Record<QuoteFilter, string> = {
  all: "All", draft: "Drafts", open: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired", archived: "Archived",
};

export const listQuotesSchema = z.object({
  status: z.enum(QUOTE_FILTERS).default("all"),
  customerId: z.uuid().optional(),
  q: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const createQuoteSchema = z.object({
  customerId: z.uuid("Choose a customer"),
  contactId: optUuid,
  siteAddressId: optUuid,
  leadId: optUuid,
  title: opt(200),
  /** Defaults to today in the organisation's timezone. */
  issueDate: optDate,
  /** Defaults (in the DB) to issue date + quote validity days. */
  expiryDate: optDate,
  /** Defaults to the organisation's "prices include VAT" setting. */
  pricesIncludeTax: z.boolean().optional(),
  notes: opt(4000),
});

export const quoteHeaderSchema = z
  .object({
    customerId: z.uuid("Choose a customer"),
    contactId: optUuid,
    siteAddressId: optUuid,
    title: opt(200),
    issueDate: z.string().regex(ISO_DATE, "Use a valid date"),
    expiryDate: z.string().regex(ISO_DATE, "Choose the date this quote is valid until"),
    pricesIncludeTax: z.boolean(),
    notes: opt(4000),
    terms: opt(4000),
  })
  .refine((v) => v.expiryDate >= v.issueDate, { path: ["expiryDate"], message: "The expiry date can't be before the quote date" });

export const saveQuoteDraftSchema = z.object({ header: quoteHeaderSchema, items: lineItemsSchema });

export const ISSUE_METHODS = ["manual", "download"] as const;
export const QUOTE_OUTCOMES = ["accepted", "declined", "viewed", "archived"] as const;
export const ACCEPT_METHODS = ["verbal", "email", "whatsapp", "signed", "other"] as const;
export const ACCEPT_METHOD_LABELS: Record<(typeof ACCEPT_METHODS)[number], string> = {
  verbal: "Verbally / in person", email: "By email", whatsapp: "On WhatsApp", signed: "Signed copy", other: "Other",
};

export const quoteOutcomeSchema = z
  .object({
    outcome: z.enum(QUOTE_OUTCOMES),
    method: z.enum(ACCEPT_METHODS).optional(),
    reason: z.string().trim().max(500, "Keep the reason under 500 characters").optional().transform((v) => (v ? v : undefined)),
  })
  .refine((v) => v.outcome !== "accepted" || !!v.method, { path: ["method"], message: "How did the customer accept?" });

export type ListQuotesInput = z.input<typeof listQuotesSchema>;
export type CreateQuoteInput = z.input<typeof createQuoteSchema>;
export type QuoteHeaderInput = z.input<typeof quoteHeaderSchema>;
export type SaveQuoteDraftInput = z.input<typeof saveQuoteDraftSchema>;
export type QuoteOutcomeInput = z.input<typeof quoteOutcomeSchema>;
export type IssueMethod = (typeof ISSUE_METHODS)[number];
export type QuoteOutcome = (typeof QUOTE_OUTCOMES)[number];
export type AcceptMethod = (typeof ACCEPT_METHODS)[number];
