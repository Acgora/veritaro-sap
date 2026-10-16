import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";

/** Contacts and sites of one customer, for quote/invoice pickers. */
export interface CustomerParties {
  customer: { id: string; display_name: string; payment_terms_days: number | null; status: string };
  contacts: { id: string; label: string; is_primary: boolean }[];
  sites: { id: string; label: string; kind: string; is_default_billing: boolean }[];
}

export function addressLabel(a: { label?: string | null; line1: string; suburb?: string | null; city?: string | null }): string {
  const place = [a.line1, a.suburb, a.city].filter(Boolean).join(", ");
  return a.label ? `${a.label} — ${place}` : place;
}

export async function listCustomerParties(ctx: ServiceContext, customerId: string): Promise<ActionResult<CustomerParties>> {
  const [c, contacts, sites] = await Promise.all([
    ctx.supabase.from("customers").select("id, display_name, payment_terms_days, status")
      .eq("organisation_id", ctx.organisationId).eq("id", customerId).maybeSingle(),
    ctx.supabase.from("customer_contacts").select("id, first_name, last_name, role, is_primary")
      .eq("organisation_id", ctx.organisationId).eq("customer_id", customerId)
      .order("is_primary", { ascending: false }).order("first_name").limit(100),
    ctx.supabase.from("customer_addresses").select("id, label, line1, suburb, city, kind, is_default_billing")
      .eq("organisation_id", ctx.organisationId).eq("customer_id", customerId)
      .order("kind", { ascending: false }).order("created_at").limit(100),
  ]);
  const error = c.error ?? contacts.error ?? sites.error;
  if (error) {
    logServerError("commercial.parties", error);
    return fail(toUserMessage(error, "We couldn't load this customer's contacts and sites."));
  }
  if (!c.data) return fail("We couldn't find that customer, or you don't have access to it.");
  return ok({
    customer: c.data,
    contacts: (contacts.data ?? []).map((x) => ({
      id: x.id,
      label: [x.first_name, x.last_name].filter(Boolean).join(" ") + (x.role ? ` (${x.role})` : ""),
      is_primary: x.is_primary,
    })),
    sites: (sites.data ?? []).map((a) => ({ id: a.id, label: addressLabel(a), kind: a.kind, is_default_billing: a.is_default_billing })),
  });
}

/** Customer ids whose name matches a search term (used to search documents by customer name). */
export async function matchCustomerIds(ctx: ServiceContext, term: string, limit = 50): Promise<string[]> {
  if (!term) return [];
  const { data } = await ctx.supabase.from("customers").select("id")
    .eq("organisation_id", ctx.organisationId).ilike("display_name", `%${term}%`).limit(limit);
  return (data ?? []).map((r) => r.id);
}
