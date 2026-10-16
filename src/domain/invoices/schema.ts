import { z } from "zod";
import { ISO_DATE } from "@/domain/commercial/dates";
import { lineItemsSchema } from "@/domain/commercial/line-items";

export { lineItemSchema as invoiceLineSchema } from "@/domain/commercial/line-items";

const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const optUuid = z.union([z.uuid(), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));

/** List filter chips. "unpaid" = issued/part-paid and not yet overdue. "all" excludes archived. */
export const INVOICE_FILTERS = ["all", "draft", "unpaid", "overdue", "paid", "void", "archived"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];
export const INVOICE_FILTER_LABELS: Record<InvoiceFilter, string> = {
  all: "All", draft: "Drafts", unpaid: "Unpaid", overdue: "Overdue", paid: "Paid", void: "Void", archived: "Archived",
};

export const listInvoicesSchema = z.object({
  status: z.enum(INVOICE_FILTERS).default("all"),
  customerId: z.uuid().optional(),
  q: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const createInvoiceDraftSchema = z.object({
  customerId: z.uuid("Choose a customer"),
  contactId: optUuid,
  siteAddressId: optUuid,
  title: opt(200),
  pricesIncludeTax: z.boolean().optional(),
  notes: opt(4000),
});

export const invoiceHeaderSchema = z
  .object({
    customerId: z.uuid("Choose a customer"),
    contactId: optUuid,
    siteAddressId: optUuid,
    title: opt(200),
    issueDate: z.string().regex(ISO_DATE, "Use a valid date"),
    dueDate: z.string().regex(ISO_DATE, "Choose the date payment is due"),
    pricesIncludeTax: z.boolean(),
    notes: opt(4000),
    terms: opt(4000),
  })
  .refine((v) => v.dueDate >= v.issueDate, { path: ["dueDate"], message: "The due date can't be before the invoice date" });

export const saveInvoiceDraftSchema = z.object({ header: invoiceHeaderSchema, items: lineItemsSchema });

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(1, "Give a reason for voiding the invoice").max(500, "Keep the reason under 500 characters"),
});

export type ListInvoicesInput = z.input<typeof listInvoicesSchema>;
export type CreateInvoiceDraftInput = z.input<typeof createInvoiceDraftSchema>;
export type InvoiceHeaderInput = z.input<typeof invoiceHeaderSchema>;
export type SaveInvoiceDraftInput = z.input<typeof saveInvoiceDraftSchema>;
