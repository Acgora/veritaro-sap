import { z } from "zod";
import { isDecimalString } from "@/lib/money-calc";

/**
 * Line items shared by quotes and invoices. Inputs are decimal STRINGS (numbers are
 * accepted for AI callers and stringified). The DB computes every stored amount.
 */
export const DISCOUNT_KINDS = ["none", "percent", "amount"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];
export const DISCOUNT_LABELS: Record<DiscountKind, string> = { none: "None", percent: "%", amount: "R" };

const decimalInput = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

export const lineItemSchema = z
  .object({
    /** Existing line id, or a client-generated UUID for a new line (makes saves retry-safe). */
    id: z.uuid().optional(),
    description: z.string().trim().min(1, "Describe this line").max(1000, "Keep the description under 1000 characters"),
    quantity: decimalInput,
    unit: z.string().trim().max(20, "Keep the unit short").optional().nullable().transform((v) => (v ? v : null)),
    unitPrice: decimalInput,
    discountType: z.enum(DISCOUNT_KINDS).default("none"),
    discountValue: z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v === null || v === undefined ? "" : String(v).trim())),
    taxable: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (!isDecimalString(v.quantity, 3) || Number(v.quantity) <= 0 || Number(v.quantity) > 1_000_000) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter a quantity above 0 (up to 3 decimals)" });
    }
    if (!isDecimalString(v.unitPrice, 2) || Number(v.unitPrice) > 1_000_000_000) {
      ctx.addIssue({ code: "custom", path: ["unitPrice"], message: "Enter a price like 450 or 450.50" });
    }
    if (v.discountType !== "none") {
      if (!isDecimalString(v.discountValue, 2)) {
        ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Enter a discount like 10 or 10.50" });
      } else if (v.discountType === "percent" && Number(v.discountValue) > 100) {
        ctx.addIssue({ code: "custom", path: ["discountValue"], message: "A percentage discount can't be more than 100" });
      }
    }
  });

export type LineItemInput = z.input<typeof lineItemSchema>;
export type LineItemValue = z.output<typeof lineItemSchema>;

export const lineItemsSchema = z.array(lineItemSchema).max(200, "A document can have at most 200 lines");

/** Insert/update payload for quote_items / invoice_items (amount columns are trigger-computed). */
export function toItemRow(v: LineItemValue, sortOrder: number) {
  const hasDiscount = v.discountType !== "none" && v.discountValue !== "" && Number(v.discountValue) > 0;
  return {
    description: v.description,
    // Decimal strings with ≤3/2 dp below 1e9 round-trip exactly through JSON numbers.
    quantity: Number(v.quantity),
    unit: v.unit,
    unit_price: Number(v.unitPrice),
    discount_type: hasDiscount ? (v.discountType as "percent" | "amount") : null,
    discount_value: hasDiscount ? Number(v.discountValue) : null,
    taxable: v.taxable,
    sort_order: sortOrder,
  };
}

/**
 * Plan a draft's line replacement. Every line carries an id (existing, or a client UUID for a
 * new line), so the save is: upsert all lines by id, then delete the ones no longer present.
 * Re-running the same save after a partial failure converges to the same state (no duplicates),
 * and DB triggers keep the totals consistent after every statement.
 */
export function planItemSync(existingIds: readonly string[], items: readonly LineItemValue[], newId: () => string = () => crypto.randomUUID()) {
  const rows = items.map((it, i) => ({ id: it.id ?? newId(), ...toItemRow(it, i) }));
  const keep = new Set(rows.map((r) => r.id));
  const removeIds = existingIds.filter((id) => !keep.has(id));
  return { rows, removeIds };
}

/** A stored item row → editor/input shape (strings). */
export function fromItemRow(row: {
  id: string; description: string; quantity: number; unit: string | null; unit_price: number;
  discount_type: string | null; discount_value: number | null; taxable: boolean;
}): Required<Omit<LineItemValue, "unit">> & { unit: string } {
  return {
    id: row.id,
    description: row.description,
    quantity: String(Number(row.quantity)),
    unit: row.unit ?? "",
    unitPrice: Number(row.unit_price).toFixed(2),
    discountType: row.discount_type === "percent" || row.discount_type === "amount" ? row.discount_type : "none",
    discountValue: row.discount_value === null ? "" : String(Number(row.discount_value)),
    taxable: row.taxable,
  };
}

/** Flatten zod issues on lines to "lines.0.quantity" → message for inline display. */
export function lineFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** DB numeric → decimal string for display/transport. */
export const money2 = (n: number | string | null | undefined): string => Number(n ?? 0).toFixed(2);
