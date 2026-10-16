import { z } from "zod";

const opt = (max: number) =>
  z.string().trim().max(max, `Keep this under ${max} characters`).optional().nullable().transform((v) => (v ? v : null));
const int = (min: number, max: number, label: string) =>
  z.coerce.number({ error: `Enter ${label}` }).int(`Enter a whole number of ${label}`)
    .min(min, `${label[0]!.toUpperCase()}${label.slice(1)} must be at least ${min}`)
    .max(max, `${label[0]!.toUpperCase()}${label.slice(1)} can be at most ${max}`);

export const BANK_ACCOUNT_TYPES = ["Cheque / current", "Savings", "Transmission", "Business"] as const;

export const businessAddressSchema = z.object({
  addressLine1: opt(200),
  addressLine2: opt(200),
  suburb: opt(100),
  city: opt(100),
  province: opt(100),
  postalCode: opt(20),
});

export const financialSettingsSchema = z.object({
  vatRegistered: z.boolean(),
  taxLabel: z.string().trim().min(1, "Enter a tax label, e.g. VAT").max(20, "Keep the label under 20 characters"),
  taxRate: z.union([z.string(), z.number()]).transform((v) => String(v).trim())
    .refine((v) => /^\d{1,2}(\.\d{1,4})?$/.test(v) && Number(v) >= 0 && Number(v) < 100, "Enter a rate like 15 (0 to 99.9999)"),
  pricesIncludeTaxDefault: z.boolean(),
  quoteValidityDays: int(1, 365, "days"),
  invoiceDueDays: int(0, 365, "days"),
  defaultQuoteTerms: opt(4000),
  defaultInvoiceTerms: opt(4000),
  bankName: opt(100),
  bankAccountHolder: opt(200),
  bankAccountNumber: opt(40).refine((v) => !v || /^[0-9 -]+$/.test(v), "Use digits only"),
  bankBranchCode: opt(20).refine((v) => !v || /^[0-9 -]+$/.test(v), "Use digits only"),
  bankAccountType: opt(40),
  leadFollowupDays: int(1, 90, "days"),
  quoteFollowupDays: int(1, 90, "days"),
  invoiceDueSoonDays: int(0, 60, "days"),
});

export const updateFinancialSettingsSchema = financialSettingsSchema.extend({
  /** Omit to leave the business address unchanged (needs organisation.update). */
  address: businessAddressSchema.optional(),
});

export type FinancialSettingsInput = z.input<typeof financialSettingsSchema>;
export type BusinessAddressInput = z.input<typeof businessAddressSchema>;
export type UpdateFinancialSettingsInput = z.input<typeof updateFinancialSettingsSchema>;
