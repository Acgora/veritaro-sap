import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { ServerSupabase } from "@/lib/supabase/server";
import { onboardingSchema, organisationUpdateSchema, type OnboardingInput, type OrganisationUpdateInput } from "./schema";

/** Onboarding: the DB function creates org + owner membership + settings + audit atomically. */
export async function createOrganisation(
  supabase: ServerSupabase,
  input: OnboardingInput,
): Promise<ActionResult<{ organisationId: string }>> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;

  const { data, error } = await supabase.rpc("create_organisation", {
    p_name: v.name,
    p_country: v.country,
    p_currency: v.currency,
    p_timezone: v.timezone,
    p_legal_name: v.legalName ?? undefined,
    p_registration_number: v.registrationNumber ?? undefined,
    p_tax_number: v.taxNumber ?? undefined,
    p_vat_number: v.vatNumber ?? undefined,
  });
  if (error || !data) {
    logServerError("organisations.create", error);
    return fail(toUserMessage(error, "We couldn't create your organisation."));
  }
  return ok({ organisationId: data });
}

export async function updateOrganisation(
  ctx: ServiceContext,
  input: OrganisationUpdateInput,
): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("organisation.update")) return fail("You don't have permission to edit the organisation.");
  const parsed = organisationUpdateSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;

  const { data, error } = await ctx.supabase
    .from("organisations")
    .update({
      name: v.name,
      legal_name: v.legalName,
      registration_number: v.registrationNumber,
      tax_number: v.taxNumber,
      vat_number: v.vatNumber,
      email: v.email,
      phone: v.phone,
      website: v.website,
      timezone: v.timezone,
      financial_year_end_month: v.financialYearEndMonth,
    })
    .eq("id", ctx.organisationId)
    .select("id")
    .maybeSingle();
  if (error) {
    logServerError("organisations.update", error);
    return fail(toUserMessage(error, "We couldn't save the organisation."));
  }
  if (!data) return fail("You don't have permission to edit the organisation.");
  return ok({ id: data.id });
}
