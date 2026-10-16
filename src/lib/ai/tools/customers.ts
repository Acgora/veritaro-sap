import { z } from "zod";
import {
  addAddress, addContact, archiveCustomer, createCustomer, findDuplicates, getCustomer, listCustomers, restoreCustomer, updateCustomer,
} from "@/domain/customers/service";
import { CUSTOMER_TYPES } from "@/domain/customers/schema";
import { ok } from "@/lib/errors";
import type { AIToolDefinition } from "../types";

/**
 * Customer tools. Each wraps the SAME domain service the screens use and returns
 * only the minimum fields the model needs (data minimisation).
 */

const READ_ANY: AIToolDefinition["requiredAnyOf"] = ["customers.read", "customers.read_linked"];

const searchInput = z.object({
  query: z.string().trim().min(1).max(100).describe("Name, email or phone fragment"),
  includeArchived: z.boolean().optional().describe("Also include archived customers (active ones are always included)"),
});

export const searchCustomersTool: AIToolDefinition<typeof searchInput> = {
  name: "search_customers",
  description: "Find customers by name, email or phone. Returns at most 10 matches with id, name, type, phone, email, status.",
  actionClass: "read",
  requiredPermissions: [],
  requiredAnyOf: READ_ANY,
  inputSchema: searchInput,
  execute: async (ctx, input) => {
    // includeArchived means active AND archived (it used to search archived ONLY, so a restored customer vanished).
    const statuses = input.includeArchived ? (["active", "archived"] as const) : (["active"] as const);
    const results = await Promise.all(statuses.map((status) => listCustomers(ctx, { q: input.query, status, pageSize: 10 })));
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) return failed;
    const rows = results.flatMap((r) => (r.ok ? r.data.customers : []));
    return ok({
      total: results.reduce((n, r) => n + (r.ok ? r.data.total : 0), 0),
      customers: rows.slice(0, 10).map((c) => ({ id: c.id, name: c.display_name, type: c.type, phone: c.phone, email: c.email, status: c.status })),
    });
  },
  summarise: (i) => `Search customers for “${i.query}”`,
};

const getInput = z.object({ customerId: z.uuid() });

export const getCustomerTool: AIToolDefinition<typeof getInput> = {
  name: "get_customer",
  description: "Get one customer's details: contacts, site addresses and VAT number. Use the id from search_customers.",
  actionClass: "read",
  requiredPermissions: [],
  requiredAnyOf: READ_ANY,
  inputSchema: getInput,
  execute: async (ctx, input) => {
    const r = await getCustomer(ctx, input.customerId);
    if (!r.ok) return r;
    const { customer: c, contacts, addresses } = r.data;
    return ok({
      id: c.id, name: c.display_name, type: c.type, status: c.status, email: c.email, phone: c.phone,
      vatNumber: c.vat_number, paymentTermsDays: c.payment_terms_days, preferredChannel: c.preferred_channel,
      contacts: contacts.slice(0, 10).map((p) => ({ id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(" "), role: p.role, phone: p.phone, email: p.email, primary: p.is_primary })),
      sites: addresses.slice(0, 10).map((a) => ({ id: a.id, kind: a.kind, label: a.label, address: [a.line1, a.line2, a.suburb, a.city].filter(Boolean).join(", ") })),
    });
  },
  summarise: () => "Look up a customer",
  card: (i) => ({ label: "Open customer", href: `/app/sales/customers/${i.customerId}` }),
};

const contactIn = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).optional(),
  role: z.string().trim().max(100).optional(),
  email: z.string().trim().max(320).optional(),
  phone: z.string().trim().max(40).optional(),
});
const addressIn = z.object({
  line1: z.string().trim().min(1).max(200),
  suburb: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  label: z.string().trim().max(100).optional(),
});

const createInput = z.object({
  displayName: z.string().trim().min(1).max(200),
  type: z.enum(CUSTOMER_TYPES).optional(),
  email: z.string().trim().max(320).optional(),
  phone: z.string().trim().max(40).optional(),
  vatNumber: z.string().trim().max(60).optional(),
  contact: contactIn.optional(),
  siteAddress: addressIn.optional(),
  allowDuplicate: z.boolean().optional().describe("Only true after the user confirmed it is a different customer from the matches shown"),
});

export const createCustomerTool: AIToolDefinition<typeof createInput, { created: boolean; id?: string; name?: string; possibleDuplicates?: unknown[] }> = {
  name: "create_customer",
  description:
    "Create a customer (optionally with a primary contact and a site address). Checks for duplicates first; if possible duplicates are returned, ask the user before retrying with allowDuplicate=true.",
  actionClass: "draft",
  requiredPermissions: ["customers.create"],
  inputSchema: createInput,
  execute: async (ctx, i) => {
    if (!i.allowDuplicate) {
      const d = await findDuplicates(ctx, { name: i.displayName, email: i.email, phone: i.phone, vat: i.vatNumber });
      if (d.ok && d.data.length > 0) {
        return ok({ created: false, possibleDuplicates: d.data.map((m) => ({ id: m.id, name: m.display_name, reason: m.reason, status: m.status })) });
      }
    }
    const r = await createCustomer(ctx, {
      displayName: i.displayName, type: i.type ?? "business", email: i.email ?? "", phone: i.phone ?? "", vatNumber: i.vatNumber ?? "",
      contact: i.contact ? { ...i.contact, email: i.contact.email ?? "" } : null,
      address: i.siteAddress ? { ...i.siteAddress, kind: "site" } : null,
    });
    if (!r.ok) return r;
    return ok({ created: true, id: r.data.id, name: r.data.displayName });
  },
  summarise: (i) => `Create customer “${i.displayName}”`,
  card: (_i, out) => (out.created && out.id ? { label: `Created ${out.name}`, href: `/app/sales/customers/${out.id}`, undo: { kind: "customer", id: out.id } } : null),
};

const updateInput = z.object({
  customerId: z.uuid(),
  displayName: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().max(320).optional(),
  phone: z.string().trim().max(40).optional(),
  vatNumber: z.string().trim().max(60).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  preferredChannel: z.enum(["email", "whatsapp", "phone"]).optional(),
});

export const updateCustomerTool: AIToolDefinition<typeof updateInput> = {
  name: "update_customer",
  description: "Change a customer's name, email, phone, VAT number, payment terms or preferred channel. Only send fields that change.",
  actionClass: "draft",
  requiredPermissions: ["customers.update"],
  inputSchema: updateInput,
  execute: (ctx, { customerId, ...rest }) => updateCustomer(ctx, customerId, rest),
  summarise: () => "Update customer details",
  card: (i) => ({ label: "Open customer", href: `/app/sales/customers/${i.customerId}` }),
};

const addContactInput = contactIn.extend({ customerId: z.uuid(), makePrimary: z.boolean().optional() });

export const addContactTool: AIToolDefinition<typeof addContactInput> = {
  name: "add_contact",
  description: "Add a contact person to an existing customer.",
  actionClass: "draft",
  requiredPermissions: ["customers.update"],
  inputSchema: addContactInput,
  execute: (ctx, { customerId, makePrimary, ...c }) => addContact(ctx, customerId, { ...c, email: c.email ?? "", isPrimary: makePrimary }),
  summarise: (i) => `Add contact ${i.firstName}`,
  card: (i) => ({ label: "Open customer", href: `/app/sales/customers/${i.customerId}?tab=contacts` }),
};

const addSiteInput = addressIn.extend({ customerId: z.uuid() });

export const addSiteAddressTool: AIToolDefinition<typeof addSiteInput> = {
  name: "add_site_address",
  description: "Add a site (service) address to an existing customer.",
  actionClass: "draft",
  requiredPermissions: ["customers.update"],
  inputSchema: addSiteInput,
  execute: (ctx, { customerId, ...a }) => addAddress(ctx, customerId, { ...a, kind: "site" }),
  summarise: (i) => `Add site address ${i.line1}`,
  card: (i) => ({ label: "Open customer", href: `/app/sales/customers/${i.customerId}?tab=sites` }),
};

const archiveInput = z.object({ customerId: z.uuid() });

export const archiveCustomerTool: AIToolDefinition<typeof archiveInput> = {
  name: "archive_customer",
  description: "Archive a customer (hides them from lists; history is kept). Requires the user's confirmation.",
  actionClass: "consequential",
  requiredPermissions: ["customers.archive"],
  inputSchema: archiveInput,
  execute: (ctx, i) => archiveCustomer(ctx, i.customerId),
  summarise: () => "Archive this customer",
  describe: async (ctx, i) => {
    const r = await getCustomer(ctx, i.customerId);
    return r.ok ? `Archive customer “${r.data.customer.display_name}”` : "Archive this customer";
  },
  card: (i) => ({ label: "Open customer", href: `/app/sales/customers/${i.customerId}` }),
};


const restoreInput = z.object({ customerId: z.uuid() });

export const restoreCustomerTool: AIToolDefinition<typeof restoreInput> = {
  name: "restore_customer",
  description: "Restore an archived customer so it can be used again for quotes, jobs and invoices. Use the id from search_customers (includeArchived) or the screen.",
  actionClass: "draft",
  requiredPermissions: ["customers.archive"],
  inputSchema: restoreInput,
  execute: (ctx, i) => restoreCustomer(ctx, i.customerId),
  summarise: () => "Restore this customer",
  card: (i) => ({ label: "Open customer", href: `/app/sales/customers/${i.customerId}` }),
  focus: (i) => [{ type: "customer", id: i.customerId, label: "restored customer" }],
};
