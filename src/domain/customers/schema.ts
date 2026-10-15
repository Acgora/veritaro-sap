import { z } from "zod";

export const CUSTOMER_TYPES = ["business", "individual"] as const;
export const CUSTOMER_STATUSES = ["active", "archived"] as const;
export const PREFERRED_CHANNELS = ["email", "whatsapp", "phone"] as const;
export const ADDRESS_KINDS = ["billing", "site"] as const;

export const CUSTOMER_TYPE_LABELS: Record<(typeof CUSTOMER_TYPES)[number], string> = { business: "Business", individual: "Individual" };
export const CHANNEL_LABELS: Record<(typeof PREFERRED_CHANNELS)[number], string> = { email: "Email", whatsapp: "WhatsApp", phone: "Phone" };

const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const optEmail = z
  .union([z.email("Enter a valid email"), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v.trim() : null));
const optPhone = z
  .string()
  .trim()
  .max(40)
  .regex(/^[0-9+()\-\s]*$/, "Use digits, spaces, + ( ) or -")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const customerFieldsSchema = z.object({
  type: z.enum(CUSTOMER_TYPES).default("business"),
  displayName: z.string().trim().min(1, "Enter the customer's name").max(200),
  legalName: opt(200),
  registrationNumber: opt(60),
  vatNumber: opt(60),
  email: optEmail,
  phone: optPhone,
  website: opt(2048),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  preferredChannel: z.union([z.enum(PREFERRED_CHANNELS), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
  notes: opt(5000),
});

export const contactSchema = z.object({
  firstName: z.string().trim().min(1, "Enter a first name").max(100),
  lastName: opt(100),
  role: opt(100),
  email: optEmail,
  phone: optPhone,
  whatsappOptIn: z.coerce.boolean().default(false),
});

export const addressSchema = z.object({
  kind: z.enum(ADDRESS_KINDS).default("site"),
  label: opt(100),
  line1: z.string().trim().min(1, "Enter the street address").max(200),
  line2: opt(200),
  suburb: opt(100),
  city: opt(100),
  province: opt(100),
  postalCode: opt(20),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/).default("ZA").transform((v) => v.toUpperCase()),
  notes: opt(1000),
});

export const createCustomerSchema = customerFieldsSchema.extend({
  contact: contactSchema.optional().nullable(),
  address: addressSchema.optional().nullable(),
});

export const updateCustomerSchema = customerFieldsSchema.partial();

export const listCustomersSchema = z.object({
  q: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
  status: z.enum(CUSTOMER_STATUSES).default("active"),
  type: z.union([z.enum(CUSTOMER_TYPES), z.literal("all")]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type CustomerFieldsInput = z.input<typeof customerFieldsSchema>;
export type CreateCustomerInput = z.input<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;
export type ContactInput = z.input<typeof contactSchema>;
export type AddressInput = z.input<typeof addressSchema>;
export type ListCustomersInput = z.input<typeof listCustomersSchema>;

/** PostgREST `or()` filter values must not contain reserved characters. */
export function sanitiseSearch(q: string): string {
  return q.replace(/[,()*%\\:."']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}
