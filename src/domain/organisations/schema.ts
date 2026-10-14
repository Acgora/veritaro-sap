import { z } from "zod";

const optional = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const COUNTRIES = [
  { code: "ZA", name: "South Africa", currency: "ZAR", timezone: "Africa/Johannesburg" },
  { code: "NA", name: "Namibia", currency: "NAD", timezone: "Africa/Windhoek" },
  { code: "BW", name: "Botswana", currency: "BWP", timezone: "Africa/Gaborone" },
  { code: "ZW", name: "Zimbabwe", currency: "USD", timezone: "Africa/Harare" },
  { code: "KE", name: "Kenya", currency: "KES", timezone: "Africa/Nairobi" },
  { code: "NG", name: "Nigeria", currency: "NGN", timezone: "Africa/Lagos" },
  { code: "GB", name: "United Kingdom", currency: "GBP", timezone: "Europe/London" },
  { code: "IE", name: "Ireland", currency: "EUR", timezone: "Europe/Dublin" },
  { code: "NL", name: "Netherlands", currency: "EUR", timezone: "Europe/Amsterdam" },
  { code: "US", name: "United States", currency: "USD", timezone: "America/New_York" },
  { code: "AU", name: "Australia", currency: "AUD", timezone: "Australia/Sydney" },
  { code: "NZ", name: "New Zealand", currency: "NZD", timezone: "Pacific/Auckland" },
] as const;

export const CURRENCIES = ["ZAR", "NAD", "BWP", "USD", "KES", "NGN", "GBP", "EUR", "AUD", "NZD"] as const;

export const onboardingSchema = z.object({
  name: z.string().trim().min(1, "Enter your business name").max(200),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/, "Choose a country").transform((v) => v.toUpperCase()),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Choose a currency").transform((v) => v.toUpperCase()),
  timezone: z.string().trim().min(1, "Choose a timezone").max(64),
  legalName: optional(200),
  registrationNumber: optional(60),
  taxNumber: optional(60),
  vatNumber: optional(60),
});
export type OnboardingInput = z.input<typeof onboardingSchema>;

export const organisationUpdateSchema = z.object({
  name: z.string().trim().min(1, "Enter your business name").max(200),
  legalName: optional(200),
  registrationNumber: optional(60),
  taxNumber: optional(60),
  vatNumber: optional(60),
  email: z.union([z.email("Enter a valid email"), z.literal("")]).optional().transform((v) => (v ? v : null)),
  phone: optional(40),
  website: optional(2048),
  timezone: z.string().trim().min(1).max(64),
  financialYearEndMonth: z.coerce.number().int().min(1).max(12),
});
export type OrganisationUpdateInput = z.input<typeof organisationUpdateSchema>;
