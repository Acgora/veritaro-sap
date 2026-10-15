import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { Tables, TablesUpdate } from "@/types/database.types";
import {
  addressSchema,
  contactSchema,
  createCustomerSchema,
  listCustomersSchema,
  sanitiseSearch,
  updateCustomerSchema,
  type AddressInput,
  type ContactInput,
  type CreateCustomerInput,
  type ListCustomersInput,
  type UpdateCustomerInput,
} from "./schema";

/**
 * Customer business logic — single implementation for screens, Quick Create and AI tools.
 * Tenancy, roles, normalisation, archive rules and audit are enforced in Postgres.
 */

export type Customer = Tables<"customers">;
export type CustomerContact = Tables<"customer_contacts">;
export type CustomerAddress = Tables<"customer_addresses">;

export interface CustomerListItem {
  id: string;
  type: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
}

const LIST_COLUMNS = "id, type, display_name, email, phone, status, created_at" as const;

export async function listCustomers(
  ctx: ServiceContext,
  input: ListCustomersInput = {},
): Promise<ActionResult<{ customers: CustomerListItem[]; total: number; page: number; pageSize: number }>> {
  const parsed = listCustomersSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid filter");
  const { q, status, type, page, pageSize } = parsed.data;

  let query = ctx.supabase
    .from("customers")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("organisation_id", ctx.organisationId)
    .eq("status", status);
  if (type !== "all") query = query.eq("type", type);
  if (q) {
    const term = sanitiseSearch(q);
    const digits = term.replace(/\D/g, "");
    const parts = [`display_name.ilike.*${term}*`, `email.ilike.*${term}*`];
    if (digits.length >= 4) parts.push(`phone_normalized.ilike.*${digits}*`);
    if (term) query = query.or(parts.join(","));
  }
  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.order("display_name").range(from, from + pageSize - 1);
  if (error) {
    logServerError("customers.list", error);
    return fail(toUserMessage(error, "We couldn't load customers."));
  }
  return ok({ customers: data ?? [], total: count ?? 0, page, pageSize });
}

/** Small option list for pickers (active customers only). */
export async function listCustomerOptions(ctx: ServiceContext, limit = 200): Promise<ActionResult<{ id: string; display_name: string }[]>> {
  const { data, error } = await ctx.supabase
    .from("customers")
    .select("id, display_name")
    .eq("organisation_id", ctx.organisationId)
    .eq("status", "active")
    .order("display_name")
    .limit(Math.min(limit, 500));
  if (error) {
    logServerError("customers.options", error);
    return fail(toUserMessage(error, "We couldn't load customers."));
  }
  return ok(data ?? []);
}

export interface CustomerDetail {
  customer: Customer;
  contacts: CustomerContact[];
  addresses: CustomerAddress[];
}

export async function getCustomer(ctx: ServiceContext, id: string): Promise<ActionResult<CustomerDetail>> {
  const [c, contacts, addresses] = await Promise.all([
    ctx.supabase.from("customers").select("*").eq("organisation_id", ctx.organisationId).eq("id", id).maybeSingle(),
    ctx.supabase.from("customer_contacts").select("*").eq("organisation_id", ctx.organisationId).eq("customer_id", id)
      .order("is_primary", { ascending: false }).order("first_name").limit(100),
    ctx.supabase.from("customer_addresses").select("*").eq("organisation_id", ctx.organisationId).eq("customer_id", id)
      .order("kind").order("created_at").limit(100),
  ]);
  const error = c.error ?? contacts.error ?? addresses.error;
  if (error) {
    logServerError("customers.get", error);
    return fail(toUserMessage(error, "We couldn't load this customer."));
  }
  if (!c.data) return fail("We couldn't find that customer, or you don't have access to it.");
  return ok({ customer: c.data, contacts: contacts.data ?? [], addresses: addresses.data ?? [] });
}

export interface DuplicateMatch {
  id: string;
  display_name: string;
  status: string;
  reason: string;
}

export async function findDuplicates(
  ctx: ServiceContext,
  input: { name?: string | null; email?: string | null; phone?: string | null; vat?: string | null; excludeId?: string },
): Promise<ActionResult<DuplicateMatch[]>> {
  if (!input.name && !input.email && !input.phone && !input.vat) return ok([]);
  const { data, error } = await ctx.supabase.rpc("find_customer_duplicates", {
    p_organisation_id: ctx.organisationId,
    p_name: input.name ?? undefined,
    p_email: input.email ?? undefined,
    p_phone: input.phone ?? undefined,
    p_vat: input.vat ?? undefined,
    p_exclude_id: input.excludeId ?? undefined,
  });
  if (error) {
    logServerError("customers.duplicates", error);
    return fail(toUserMessage(error, "We couldn't check for duplicates."));
  }
  return ok((data ?? []).map((d) => ({ id: d.id, display_name: d.display_name, status: d.status, reason: d.reason })));
}

function toCustomerRow(v: ReturnType<typeof createCustomerSchema.parse> | Partial<ReturnType<typeof createCustomerSchema.parse>>) {
  return {
    type: v.type,
    display_name: v.displayName,
    legal_name: v.legalName,
    registration_number: v.registrationNumber,
    vat_number: v.vatNumber,
    email: v.email,
    phone: v.phone,
    website: v.website,
    payment_terms_days: v.paymentTermsDays,
    preferred_channel: v.preferredChannel,
    notes: v.notes,
  };
}

export async function createCustomer(
  ctx: ServiceContext,
  input: CreateCustomerInput,
): Promise<ActionResult<{ id: string; displayName: string }>> {
  if (!ctx.permissions.can("customers.create")) return fail("You don't have permission to add customers.");
  const parsed = createCustomerSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;

  const contact = v.contact
    ? { first_name: v.contact.firstName, last_name: v.contact.lastName, role: v.contact.role, email: v.contact.email,
        phone: v.contact.phone, whatsapp_opt_in: v.contact.whatsappOptIn }
    : null;
  const address = v.address
    ? { kind: v.address.kind, label: v.address.label, line1: v.address.line1, line2: v.address.line2, suburb: v.address.suburb,
        city: v.address.city, province: v.address.province, postal_code: v.address.postalCode, country: v.address.country, notes: v.address.notes }
    : null;

  const { data, error } = await ctx.supabase.rpc("create_customer", {
    p_organisation_id: ctx.organisationId,
    p_customer: toCustomerRow(v),
    p_contact: contact ?? undefined,
    p_address: address ?? undefined,
  });
  if (error || !data) {
    logServerError("customers.create", error);
    return fail(toUserMessage(error, "We couldn't add the customer."));
  }
  return ok({ id: data, displayName: v.displayName });
}

export async function updateCustomer(ctx: ServiceContext, id: string, input: UpdateCustomerInput): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("customers.update")) return fail("You don't have permission to edit customers.");
  const parsed = updateCustomerSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const has = (k: keyof UpdateCustomerInput) => (input as Record<string, unknown>)[k] !== undefined;
  const row: TablesUpdate<"customers"> = {};
  if (has("type") && v.type) row.type = v.type;
  if (has("displayName") && v.displayName) row.display_name = v.displayName;
  if (has("legalName")) row.legal_name = v.legalName ?? null;
  if (has("registrationNumber")) row.registration_number = v.registrationNumber ?? null;
  if (has("vatNumber")) row.vat_number = v.vatNumber ?? null;
  if (has("email")) row.email = v.email ?? null;
  if (has("phone")) row.phone = v.phone ?? null;
  if (has("website")) row.website = v.website ?? null;
  if (has("paymentTermsDays") && v.paymentTermsDays !== undefined) row.payment_terms_days = v.paymentTermsDays;
  if (has("preferredChannel")) row.preferred_channel = v.preferredChannel ?? null;
  if (has("notes")) row.notes = v.notes ?? null;
  if (Object.keys(row).length === 0) return ok({ id });
  const { data, error } = await ctx.supabase.from("customers").update(row).eq("organisation_id", ctx.organisationId).eq("id", id).select("id").maybeSingle();
  if (error) {
    logServerError("customers.update", error);
    return fail(toUserMessage(error, "We couldn't save the customer."));
  }
  if (!data) return fail("We couldn't find that customer, or you don't have access to it.");
  return ok({ id: data.id });
}

async function setStatus(ctx: ServiceContext, id: string, status: "active" | "archived") {
  const { data, error } = await ctx.supabase.from("customers").update({ status }).eq("organisation_id", ctx.organisationId).eq("id", id).select("id").maybeSingle();
  if (error) {
    logServerError("customers.status", error);
    return fail(toUserMessage(error, "We couldn't update the customer."));
  }
  if (!data) return fail("We couldn't find that customer, or you don't have access to it.");
  return ok({ id: data.id });
}

/** Archive: customers.archive, or the creator undoing their own new record (DB enforces the 15-minute window). */
export const archiveCustomer = (ctx: ServiceContext, id: string): Promise<ActionResult<{ id: string }>> => setStatus(ctx, id, "archived");
export const restoreCustomer = (ctx: ServiceContext, id: string): Promise<ActionResult<{ id: string }>> => setStatus(ctx, id, "active");

export async function addContact(ctx: ServiceContext, customerId: string, input: ContactInput & { isPrimary?: boolean }): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("customers.update")) return fail("You don't have permission to edit customers.");
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  if (input.isPrimary) {
    await ctx.supabase.from("customer_contacts").update({ is_primary: false }).eq("organisation_id", ctx.organisationId).eq("customer_id", customerId).eq("is_primary", true);
  }
  const { data, error } = await ctx.supabase.from("customer_contacts").insert({
    organisation_id: ctx.organisationId, customer_id: customerId, first_name: v.firstName, last_name: v.lastName, role: v.role,
    email: v.email, phone: v.phone, whatsapp_opt_in: v.whatsappOptIn, is_primary: !!input.isPrimary,
  }).select("id").single();
  if (error) {
    logServerError("customers.addContact", error);
    return fail(toUserMessage(error, "We couldn't add the contact."));
  }
  return ok({ id: data.id });
}

export async function removeContact(ctx: ServiceContext, contactId: string): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("customers.update")) return fail("You don't have permission to edit customers.");
  const { data, error } = await ctx.supabase.from("customer_contacts").delete().eq("organisation_id", ctx.organisationId).eq("id", contactId).select("id").maybeSingle();
  if (error) {
    logServerError("customers.removeContact", error);
    return fail(toUserMessage(error, "We couldn't remove the contact."));
  }
  if (!data) return fail("We couldn't find that contact.");
  return ok({ id: data.id });
}

export async function addAddress(ctx: ServiceContext, customerId: string, input: AddressInput): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("customers.update")) return fail("You don't have permission to edit customers.");
  const parsed = addressSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  let makeDefault = false;
  if (v.kind === "billing") {
    const { count } = await ctx.supabase.from("customer_addresses").select("id", { count: "exact", head: true })
      .eq("organisation_id", ctx.organisationId).eq("customer_id", customerId).eq("is_default_billing", true);
    makeDefault = (count ?? 0) === 0;
  }
  const { data, error } = await ctx.supabase.from("customer_addresses").insert({
    organisation_id: ctx.organisationId, customer_id: customerId, kind: v.kind, label: v.label, line1: v.line1, line2: v.line2,
    suburb: v.suburb, city: v.city, province: v.province, postal_code: v.postalCode, country: v.country, notes: v.notes,
    is_default_billing: makeDefault,
  }).select("id").single();
  if (error) {
    logServerError("customers.addAddress", error);
    return fail(toUserMessage(error, "We couldn't add the address."));
  }
  return ok({ id: data.id });
}

export async function removeAddress(ctx: ServiceContext, addressId: string): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("customers.update")) return fail("You don't have permission to edit customers.");
  const { data, error } = await ctx.supabase.from("customer_addresses").delete().eq("organisation_id", ctx.organisationId).eq("id", addressId).select("id").maybeSingle();
  if (error) {
    logServerError("customers.removeAddress", error);
    return fail(toUserMessage(error, "We couldn't remove the address."));
  }
  if (!data) return fail("We couldn't find that address.");
  return ok({ id: data.id });
}

export async function countCustomersCreatedSince(ctx: ServiceContext, sinceIso: string): Promise<ActionResult<number>> {
  const { count, error } = await ctx.supabase.from("customers").select("id", { count: "exact", head: true })
    .eq("organisation_id", ctx.organisationId).gte("created_at", sinceIso);
  if (error) {
    logServerError("customers.countSince", error);
    return fail(toUserMessage(error, "We couldn't count new customers."));
  }
  return ok(count ?? 0);
}

export async function listCustomerTasks(ctx: ServiceContext, customerId: string) {
  const { data, error } = await ctx.supabase.from("tasks").select("id, title, status, priority, due_at, assigned_to")
    .eq("organisation_id", ctx.organisationId).eq("related_entity_type", "customer").eq("related_entity_id", customerId)
    .order("status").order("due_at", { ascending: true, nullsFirst: false }).limit(50);
  if (error) {
    logServerError("customers.tasks", error);
    return fail(toUserMessage(error, "We couldn't load tasks for this customer."));
  }
  return ok(data ?? []);
}
