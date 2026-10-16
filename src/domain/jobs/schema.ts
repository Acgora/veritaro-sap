import { z } from "zod";
import { JOB_STATUSES } from "@/lib/status";

export const JOB_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];
export const JOB_PRIORITY_LABELS: Record<JobPriority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

export const JOB_ACTIONS = ["start", "complete", "cancel", "reopen"] as const;
export type JobAction = (typeof JOB_ACTIONS)[number];

export const ASSIGNMENT_ROLES = ["lead", "worker"] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];
export const ASSIGNMENT_ROLE_LABELS: Record<AssignmentRole, string> = { lead: "Team lead", worker: "Worker" };

export const PHOTO_CATEGORIES = ["before", "during", "after", "receipt", "evidence", "other"] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];
export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
  before: "Before", during: "During", after: "After", receipt: "Receipt", evidence: "Evidence", other: "Other",
};

/** List filter chips. "open" = everything not completed/cancelled. */
export const JOB_LIST_STATUSES = ["all", "open", ...JOB_STATUSES] as const;

const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const optUuid = z.union([z.uuid(), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));
const isoDateTime = z.iso.datetime({ offset: true, message: "Enter a valid date and time" });
const optIso = z.union([isoDateTime, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));

const scheduleRefine = <T extends { scheduledStart?: string | null; scheduledEnd?: string | null }>(v: T, c: z.RefinementCtx) => {
  if (v.scheduledEnd && !v.scheduledStart) c.addIssue({ code: "custom", path: ["scheduledStart"], message: "Choose a start time" });
  if (v.scheduledStart && v.scheduledEnd && new Date(v.scheduledEnd) <= new Date(v.scheduledStart)) {
    c.addIssue({ code: "custom", path: ["scheduledEnd"], message: "The end must be after the start" });
  }
};

export const listJobsSchema = z.object({
  status: z.enum(JOB_LIST_STATUSES).default("all"),
  /** A member's user id, or "me". */
  assignee: z.union([z.uuid(), z.literal("me"), z.literal("")]).optional().transform((v) => (v ? v : undefined)),
  /** Scheduled-start window [from, to) as UTC ISO strings (callers convert from org-local dates). */
  from: z.union([isoDateTime, z.literal("")]).optional().transform((v) => (v ? v : undefined)),
  to: z.union([isoDateTime, z.literal("")]).optional().transform((v) => (v ? v : undefined)),
  customerId: z.union([z.uuid(), z.literal("")]).optional().transform((v) => (v ? v : undefined)),
  q: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const createJobSchema = z
  .object({
    customerId: z.uuid("Choose a customer"),
    contactId: optUuid,
    siteAddressId: optUuid,
    title: z.string().trim().min(1, "Give the job a title").max(200),
    description: optText(5000),
    priority: z.enum(JOB_PRIORITIES).default("normal"),
    scheduledStart: optIso,
    scheduledEnd: optIso,
    assigneeIds: z.array(z.uuid()).max(20).default([]),
  })
  .superRefine(scheduleRefine);

export const updateJobSchema = z.object({
  title: z.string().trim().min(1, "Give the job a title").max(200).optional(),
  description: optText(5000),
  priority: z.enum(JOB_PRIORITIES).optional(),
  internalNotes: optText(5000),
  contactId: optUuid,
  siteAddressId: optUuid,
});

export const scheduleJobSchema = z
  .object({
    /** null/"" clears the schedule (job goes back to Unscheduled). */
    scheduledStart: optIso,
    scheduledEnd: optIso,
    /** Proceed even if find_schedule_conflicts reports overlaps. */
    force: z.boolean().default(false),
  })
  .superRefine(scheduleRefine);

export const assignMembersSchema = z.object({
  userIds: z.array(z.uuid()).min(1, "Choose at least one person").max(20),
  role: z.enum(ASSIGNMENT_ROLES).default("worker"),
});

export const jobStatusSchema = z
  .object({
    action: z.enum(JOB_ACTIONS),
    notes: optText(5000),
  })
  .superRefine((v, c) => {
    if (v.action === "cancel" && v.notes && v.notes.length > 500) {
      c.addIssue({ code: "custom", path: ["notes"], message: "Keep the reason under 500 characters" });
    }
  });

export const jobNoteSchema = z.object({
  body: z.string().trim().min(1, "Write a note").max(5000),
});

export const jobPhotoSchema = z.object({
  storagePath: z.string().min(1).max(500),
  caption: optText(500),
  category: z.enum(PHOTO_CATEGORIES).default("other"),
  width: z.number().int().positive().max(20000).optional().nullable(),
  height: z.number().int().positive().max(20000).optional().nullable(),
  byteSize: z.number().int().positive().max(8388608).optional().nullable(),
  takenAt: optIso,
});

export const createJobFromQuoteSchema = z
  .object({
    quoteId: z.uuid(),
    scheduledStart: optIso,
    scheduledEnd: optIso,
    title: optText(200),
  })
  .superRefine(scheduleRefine);

export type ListJobsInput = z.input<typeof listJobsSchema>;
export type CreateJobInput = z.input<typeof createJobSchema>;
export type UpdateJobInput = z.input<typeof updateJobSchema>;
export type ScheduleJobInput = z.input<typeof scheduleJobSchema>;
export type AssignMembersInput = z.input<typeof assignMembersSchema>;
export type JobStatusInput = z.input<typeof jobStatusSchema>;
export type JobNoteInput = z.input<typeof jobNoteSchema>;
export type JobPhotoInput = z.input<typeof jobPhotoSchema>;
export type CreateJobFromQuoteInput = z.input<typeof createJobFromQuoteSchema>;

/** Status shown to the user: completed + a non-void invoice → "invoiced" (only when the viewer can read invoices). */
export function displayJobStatus(status: string, hasInvoice: boolean): string {
  return status === "completed" && hasInvoice ? "invoiced" : status;
}

/** PostgREST `or()` filter values must not contain reserved characters. */
export function sanitiseJobSearch(q: string): string {
  return q.replace(/[,()*%\\:."']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}
