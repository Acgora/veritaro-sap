import { z } from "zod";
import { isDecimalString } from "@/lib/money-calc";
import { PAYMENT_METHODS } from "@/lib/status";
import { ISO_DATE } from "@/domain/commercial/dates";

/**
 * Idempotency key for one payment-recording INTENT. Generate it once when the user opens the
 * record-payment dialog (or once per AI tool call) and reuse it for every retry/double-submit:
 * record_payment() returns the existing payment for a repeated key instead of inserting twice.
 */
export function newIdempotencyKey(): string {
  return `pay_${crypto.randomUUID()}`;
}

/** "R 2 500,50" / "2,500.50" / 2500.5 → "2500.50"-style decimal string (validated separately). */
export function normaliseAmount(v: string | number): string {
  return String(v).trim()
    .replace(/^R\s?/i, "")
    .replace(/[\s ,](?=\d{3}(\D|$))/g, "") // thousands separators
    .replace(",", "."); // en-ZA decimal comma
}

export const IDEMPOTENCY_KEY =/^[A-Za-z0-9_:-]{8,100}$/;

export const recordPaymentSchema = z.object({
  invoiceId: z.uuid("Choose an invoice"),
  amount: z.union([z.string(), z.number()]).transform(normaliseAmount)
    .refine((v) => isDecimalString(v, 2) && Number(v) > 0, "Enter an amount above 0, like 2500 or 2500.50"),
  paymentDate: z.string().regex(ISO_DATE, "Choose the date you received the money"),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(200, "Keep the reference under 200 characters").optional().nullable().transform((v) => (v ? v : null)),
  notes: z.string().trim().max(1000, "Keep notes under 1000 characters").optional().nullable().transform((v) => (v ? v : null)),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY, "Missing or invalid idempotency key"),
});

export const voidPaymentSchema = z.object({
  reason: z.string().trim().min(1, "Give a reason for reversing the payment").max(500, "Keep the reason under 500 characters"),
});

export const listPaymentsSchema = z.object({
  customerId: z.uuid().optional(),
  invoiceId: z.uuid().optional(),
  includeVoided: z.coerce.boolean().default(true),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;
export type ListPaymentsInput = z.input<typeof listPaymentsSchema>;
