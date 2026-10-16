import { z } from "zod";
import type { ServiceContext } from "@/domain/context";
import { formatMoney } from "@/lib/money";
import { zonedToUtcIso } from "@/domain/jobs/calendar";
import { getOrganisationTimezone } from "@/domain/jobs/service";

/** Shared helpers for Phase 003 AI tools. Tools never compute money — they pass user-stated amounts through. */

export const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm (24h)");
/** Amount exactly as the user stated it, as a decimal string ("1250", "1250.50"). */
export const AMOUNT = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Decimal amount like 1250 or 1250.50, no currency symbol or spaces");
export const QTY = z.string().trim().regex(/^\d{1,7}(\.\d{1,3})?$/, "Quantity like 1 or 2.5");

export function money(amount: string | number | null | undefined, currency = "ZAR"): string {
  const n = typeof amount === "number" ? amount.toFixed(2) : String(amount ?? "0");
  try {
    return formatMoney(/^-?\d+(\.\d+)?$/.test(n) ? n : "0", currency);
  } catch {
    return n;
  }
}

/** Organisation-local date + time (what the user said) → UTC ISO for the database. */
export async function localToIso(ctx: ServiceContext, date: string, time: string): Promise<string> {
  const tz = await getOrganisationTimezone(ctx);
  return zonedToUtcIso(date, time, tz);
}

export const lineIn = z.object({
  description: z.string().trim().min(1).max(1000),
  quantity: QTY.optional().describe("Defaults to 1"),
  unit: z.string().trim().max(20).optional(),
  unitPrice: AMOUNT.describe("Price per unit exactly as the user stated it"),
  discountPercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional(),
  taxable: z.boolean().optional().describe("Defaults to true (VAT applies if the business is VAT registered)"),
});
export type LineIn = z.output<typeof lineIn>;

export function toLineItem(l: LineIn) {
  return {
    description: l.description,
    quantity: l.quantity ?? "1",
    unit: l.unit ?? null,
    unitPrice: l.unitPrice,
    discountType: l.discountPercent ? ("percent" as const) : ("none" as const),
    discountValue: l.discountPercent ?? "",
    taxable: l.taxable ?? true,
  };
}
