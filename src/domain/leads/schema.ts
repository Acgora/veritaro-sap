import { z } from "zod";
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_STATUS, LEAD_STATUSES, type LeadSource, type LeadStatus } from "@/lib/status";

export { LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_STATUS, LEAD_STATUSES };
export type { LeadSource, LeadStatus };

/** Pipeline stages where a follow-up still makes sense (mirrors get_today_summary). */
export const OPEN_LEAD_STATUSES = ["new", "contacted", "qualified", "quote_needed"] as const satisfies readonly LeadStatus[];
/** Everything that is not closed (won/lost). */
export const ACTIVE_LEAD_STATUSES = ["new", "contacted", "qualified", "quote_needed", "quote_sent"] as const satisfies readonly LeadStatus[];
/** Won/lost leads stay on the board for this many days. */
export const PIPELINE_CLOSED_WINDOW_DAYS = 30;

const opt = (max: number, message?: string) =>
  z.string().trim().max(max, message).optional().nullable().transform((v) => (v ? v : null));
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
const optUuid = z
  .union([z.uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const optDate = z
  .union([z.iso.date("Enter a valid date"), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
/** Money is transported as a decimal string; numbers are accepted from AI tools and converted. */
const optMoney = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, c) => {
    if (v === null || v === undefined) return null;
    const s = (typeof v === "number" ? String(v) : v).trim().replace(/[\s,]/g, "").replace(/^R/i, "");
    if (s === "") return null;
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) {
      c.issues.push({ code: "custom", message: "Enter an amount like 4500 or 4500.50", input: v });
      return z.NEVER;
    }
    return s;
  });
const optDateTime = z
  .union([z.iso.datetime({ offset: true }), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const leadFieldsSchema = z.object({
  personName: opt(200),
  companyName: opt(200),
  email: optEmail,
  phone: optPhone,
  source: z.enum(LEAD_SOURCES).default("manual"),
  serviceSummary: opt(1000, "Keep the summary under 1000 characters"),
  siteAddressText: opt(500),
  requestedDate: optDate,
  estimatedValue: optMoney,
  assignedTo: optUuid,
  notes: opt(5000),
  /** Optional explicit title; otherwise derived from name + service. */
  title: opt(200),
});

export const createLeadSchema = leadFieldsSchema.superRefine((v, c) => {
  if (!v.personName && !v.companyName) {
    c.addIssue({ code: "custom", path: ["personName"], message: "Enter a person or company name" });
  }
});

export const updateLeadSchema = leadFieldsSchema.partial();

export const setLeadStatusSchema = z
  .object({
    status: z.enum(LEAD_STATUSES),
    lostReason: opt(500),
  })
  .superRefine((v, c) => {
    if (v.status === "lost" && !v.lostReason) {
      c.addIssue({ code: "custom", path: ["lostReason"], message: "Say briefly why the lead was lost" });
    }
  });

export const scheduleFollowUpSchema = z.object({ at: optDateTime });

export const convertLeadSchema = z.object({
  existingCustomerId: optUuid,
  allowDuplicate: z.boolean().default(false),
});

const flag = z
  .union([z.boolean(), z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === true || v === "1" || v === "true");

export const listLeadsSchema = z.object({
  q: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
  status: z.union([z.enum(LEAD_STATUSES), z.literal("active"), z.literal("all")]).default("all"),
  /** "me", "unassigned", "all", or a member's user id. */
  assigned: z.union([z.literal("me"), z.literal("unassigned"), z.literal("all"), z.uuid()]).default("all"),
  source: z.union([z.enum(LEAD_SOURCES), z.literal("all")]).default("all"),
  followUp: flag,
  archived: flag,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const pipelineFiltersSchema = listLeadsSchema.pick({ q: true, assigned: true, source: true });

export type LeadFieldsInput = z.input<typeof leadFieldsSchema>;
export type CreateLeadInput = z.input<typeof createLeadSchema>;
export type UpdateLeadInput = z.input<typeof updateLeadSchema>;
export type SetLeadStatusInput = z.input<typeof setLeadStatusSchema>;
export type ConvertLeadInput = z.input<typeof convertLeadSchema>;
export type ListLeadsInput = z.input<typeof listLeadsSchema>;
export type ListLeadsFilters = z.output<typeof listLeadsSchema>;
export type PipelineFiltersInput = z.input<typeof pipelineFiltersSchema>;
