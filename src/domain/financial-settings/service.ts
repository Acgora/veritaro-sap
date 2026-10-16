import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { Tables } from "@/types/database.types";
import { updateFinancialSettingsSchema, type UpdateFinancialSettingsInput } from "./schema";

/**
 * Organisation financial settings (tax, defaults, banking, follow-up thresholds) and the
 * business address on organisations.address_*. Issued documents keep their own snapshots;
 * nothing here changes an already-issued quote or invoice.
 */

export type FinancialSettings = Tables<"organisation_financial_settings">;

export interface BusinessProfile {
  name: string;
  legalName: string | null;
  vatNumber: string | null;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
  timezone: string;
  logoUrl: string | null;
  address: {
    addressLine1: string | null; addressLine2: string | null; suburb: string | null;
    city: string | null; province: string | null; postalCode: string | null;
  };
}

export async function getFinancialSettings(ctx: ServiceContext): Promise<ActionResult<{ settings: FinancialSettings; business: BusinessProfile }>> {
  const [s, o] = await Promise.all([
    ctx.supabase.from("organisation_financial_settings").select("*").eq("organisation_id", ctx.organisationId).maybeSingle(),
    ctx.supabase.from("organisations")
      .select("name, legal_name, vat_number, registration_number, email, phone, currency, timezone, logo_url, address_line1, address_line2, suburb, city, province, postal_code")
      .eq("id", ctx.organisationId).maybeSingle(),
  ]);
  const error = s.error ?? o.error;
  if (error) {
    logServerError("financialSettings.get", error);
    return fail(toUserMessage(error, "We couldn't load your quote and invoice settings."));
  }
  if (!s.data || !o.data) return fail("We couldn't find the settings for this organisation.");
  const org = o.data;
  return ok({
    settings: s.data,
    business: {
      name: org.name, legalName: org.legal_name, vatNumber: org.vat_number, registrationNumber: org.registration_number,
      email: org.email, phone: org.phone, currency: org.currency, timezone: org.timezone, logoUrl: org.logo_url,
      address: {
        addressLine1: org.address_line1, addressLine2: org.address_line2, suburb: org.suburb,
        city: org.city, province: org.province, postalCode: org.postal_code,
      },
    },
  });
}

export async function updateFinancialSettings(ctx: ServiceContext, input: UpdateFinancialSettingsInput): Promise<ActionResult<{ saved: true }>> {
  if (!ctx.permissions.can("settings.update")) return fail("You don't have permission to change these settings.");
  const parsed = updateFinancialSettingsSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  if (v.address && !ctx.permissions.can("organisation.update")) {
    return fail("Only someone who can edit the organisation can change the business address.");
  }

  const { data, error } = await ctx.supabase.from("organisation_financial_settings").update({
    vat_registered: v.vatRegistered,
    tax_label: v.taxLabel,
    tax_rate: Number(v.taxRate),
    prices_include_tax_default: v.pricesIncludeTaxDefault,
    quote_validity_days: v.quoteValidityDays,
    invoice_due_days: v.invoiceDueDays,
    default_quote_terms: v.defaultQuoteTerms,
    default_invoice_terms: v.defaultInvoiceTerms,
    bank_name: v.bankName,
    bank_account_holder: v.bankAccountHolder,
    bank_account_number: v.bankAccountNumber,
    bank_branch_code: v.bankBranchCode,
    bank_account_type: v.bankAccountType,
    lead_followup_days: v.leadFollowupDays,
    quote_followup_days: v.quoteFollowupDays,
    invoice_due_soon_days: v.invoiceDueSoonDays,
  }).eq("organisation_id", ctx.organisationId).select("organisation_id").maybeSingle();
  if (error) {
    logServerError("financialSettings.update", error);
    return fail(toUserMessage(error, "We couldn't save your settings."));
  }
  if (!data) return fail("You don't have permission to change these settings.");

  if (v.address) {
    const a = v.address;
    const { data: org, error: orgError } = await ctx.supabase.from("organisations").update({
      address_line1: a.addressLine1, address_line2: a.addressLine2, suburb: a.suburb,
      city: a.city, province: a.province, postal_code: a.postalCode,
    }).eq("id", ctx.organisationId).select("id").maybeSingle();
    if (orgError || !org) {
      logServerError("financialSettings.address", orgError);
      return fail(toUserMessage(orgError, "Your settings were saved, but we couldn't save the business address."));
    }
  }
  return ok({ saved: true });
}

/** Defaults used when creating drafts (DB guards apply most of them; we read prices_include_tax_default explicitly). */
export async function getDocumentDefaults(ctx: ServiceContext) {
  const { data } = await ctx.supabase.from("organisation_financial_settings")
    .select("vat_registered, tax_label, tax_rate, prices_include_tax_default, quote_validity_days, invoice_due_days")
    .eq("organisation_id", ctx.organisationId).maybeSingle();
  return {
    vatRegistered: data?.vat_registered ?? false,
    taxLabel: data?.tax_label ?? "VAT",
    taxRate: data?.tax_rate ?? 0,
    pricesIncludeTaxDefault: data?.prices_include_tax_default ?? false,
    quoteValidityDays: data?.quote_validity_days ?? 30,
    invoiceDueDays: data?.invoice_due_days ?? 30,
  };
}
