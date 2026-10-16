import { z } from "zod";
import {
  assignMembers, createInvoiceFromJob, createJobFromQuote, findJobs, getJob, getOrganisationTimezone, listAssignableMembers, listJobsForDate,
  scheduleJob, setJobStatus,
} from "@/domain/jobs/service";
import { formatTimeRange } from "@/domain/jobs/calendar";
import { ok } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { JobListItem } from "@/domain/jobs/service";
import type { AIToolDefinition } from "../types";
import { DATE, TIME, localToIso } from "./shared";

const JOB_READ: AIToolDefinition["requiredAnyOf"] = ["jobs.read_all", "jobs.read_assigned"];

function jobRow(j: JobListItem, tz: string) {
  return {
    id: j.id, number: j.job_number, title: j.title, status: j.displayStatus, customer: j.customer_name,
    when: j.scheduled_start ? formatTimeRange(j.scheduled_start, j.scheduled_end, tz) : "unscheduled",
    date: j.scheduled_start ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(j.scheduled_start)) : null,
    site: j.site_address,
  };
}

async function jobLabel(ctx: ServiceContext, id: string): Promise<string> {
  const r = await getJob(ctx, id);
  if (!r.ok) return "this job";
  return `${r.data.job.job_number} · ${r.data.job.title}${r.data.customer ? ` for ${r.data.customer.display_name}` : ""}`;
}

const findInput = z.object({ query: z.string().trim().min(1).max(100).describe("Job number (J-0004), title or customer name") });

export const findJobsTool: AIToolDefinition<typeof findInput> = {
  name: "find_jobs",
  description: "Find jobs by number, title or customer. Returns id, number, title, status, customer, scheduled time.",
  actionClass: "read",
  requiredPermissions: [],
  requiredAnyOf: JOB_READ,
  inputSchema: findInput,
  execute: async (ctx, i) => {
    const [r, tz] = await Promise.all([findJobs(ctx, i.query, 10), getOrganisationTimezone(ctx)]);
    if (!r.ok) return r;
    return ok({ jobs: r.data.map((j) => jobRow(j, tz)) });
  },
  summarise: (i) => `Find jobs “${i.query}”`,
};

const dateInput = z.object({ date: DATE.describe("Local date YYYY-MM-DD (work out 'Tuesday' from today's date)") });

export const listJobsForDateTool: AIToolDefinition<typeof dateInput> = {
  name: "list_jobs_for_date",
  description: "Jobs scheduled on a date (organisation timezone), with team size and times.",
  actionClass: "read",
  requiredPermissions: [],
  requiredAnyOf: JOB_READ,
  inputSchema: dateInput,
  execute: async (ctx, i) => {
    const tz = await getOrganisationTimezone(ctx);
    const r = await listJobsForDate(ctx, i.date, tz);
    if (!r.ok) return r;
    return ok({ date: i.date, jobs: r.data.map((j) => ({ ...jobRow(j, tz), team: j.assignees?.map((a) => a.name) ?? [] })) });
  },
  summarise: (i) => `List jobs on ${i.date}`,
  card: (i) => ({ label: `Calendar ${i.date}`, href: `/app/work/calendar?view=day&date=${i.date}` }),
};

const fromQuoteInput = z.object({
  quoteId: z.uuid().describe("An ACCEPTED quote"),
  date: DATE.optional(),
  startTime: TIME.optional(),
  endTime: TIME.optional(),
  title: z.string().trim().max(200).optional(),
});

export const createJobFromQuoteTool: AIToolDefinition<typeof fromQuoteInput, { jobId: string; created: boolean; scheduled: boolean }> = {
  name: "create_job_from_quote",
  description: "Create a job from an accepted quote, reusing its customer, site and scope; optionally schedule it. Idempotent: returns the existing job if one exists.",
  actionClass: "draft",
  requiredPermissions: ["jobs.write"],
  inputSchema: fromQuoteInput,
  execute: async (ctx, i) => {
    const start = i.date && i.startTime ? await localToIso(ctx, i.date, i.startTime) : undefined;
    const end = i.date && i.endTime ? await localToIso(ctx, i.date, i.endTime) : undefined;
    const r = await createJobFromQuote(ctx, { quoteId: i.quoteId, scheduledStart: start, scheduledEnd: end, title: i.title });
    if (!r.ok) return r;
    return ok({ ...r.data, scheduled: !!start });
  },
  summarise: () => "Create a job from the quote",
  card: (_i, out) => ({ label: out.created ? "New job" : "Existing job", href: `/app/work/jobs/${out.jobId}` }),
  focus: (_i, out) => [{ type: "job", id: out.jobId, label: "job" }],
};

const scheduleInput = z.object({
  jobId: z.uuid(),
  date: DATE,
  startTime: TIME,
  endTime: TIME.optional(),
  ignoreConflicts: z.boolean().optional().describe("Only true after the user saw the conflicts and said to go ahead"),
});

export const scheduleJobTool: AIToolDefinition<typeof scheduleInput> = {
  name: "schedule_job",
  description: "Schedule or reschedule a job (organisation-local date and time). If team conflicts are returned, tell the user and only retry with ignoreConflicts after they agree.",
  actionClass: "draft",
  requiredPermissions: ["jobs.write"],
  inputSchema: scheduleInput,
  execute: async (ctx, i) => {
    const start = await localToIso(ctx, i.date, i.startTime);
    const end = i.endTime ? await localToIso(ctx, i.date, i.endTime) : null;
    const r = await scheduleJob(ctx, i.jobId, { scheduledStart: start, scheduledEnd: end, force: !!i.ignoreConflicts });
    if (!r.ok) return r;
    return ok({ scheduled: r.data.scheduled, conflicts: r.data.conflicts.map((c) => ({ job: c.jobNumber, person: c.userName, start: c.start })) });
  },
  summarise: (i) => `Schedule the job for ${i.date} ${i.startTime}`,
  card: (i) => ({ label: "Open job", href: `/app/work/jobs/${i.jobId}` }),
  focus: (i) => [{ type: "job", id: i.jobId, label: "job" }],
};

export const listTeamMembersTool: AIToolDefinition<z.ZodObject<Record<string, never>>> = {
  name: "list_team_members",
  description: "People who can be assigned to jobs (id, name, role). Use to resolve 'assign Peter'. If two people match, ask which one.",
  actionClass: "read",
  requiredPermissions: ["jobs.write"],
  inputSchema: z.object({}),
  execute: async (ctx) => {
    const r = await listAssignableMembers(ctx);
    if (!r.ok) return r;
    return ok({ members: r.data });
  },
  summarise: () => "List team members",
};

const assignInput = z.object({ jobId: z.uuid(), userIds: z.array(z.uuid()).min(1).max(10), role: z.enum(["lead", "worker"]).optional() });

export const assignJobTool: AIToolDefinition<typeof assignInput> = {
  name: "assign_job",
  description: "Assign team members to a job (user ids from list_team_members). Reports schedule conflicts as warnings.",
  actionClass: "draft",
  requiredPermissions: ["jobs.write"],
  inputSchema: assignInput,
  execute: async (ctx, i) => {
    const r = await assignMembers(ctx, i.jobId, { userIds: i.userIds, role: i.role ?? "worker" });
    if (!r.ok) return r;
    return ok({ added: r.data.added, conflicts: r.data.conflicts.map((c) => ({ job: c.jobNumber, person: c.userName, start: c.start })) });
  },
  summarise: () => "Assign the team",
  card: (i) => ({ label: "Open job", href: `/app/work/jobs/${i.jobId}?tab=team` }),
  focus: (i) => [{ type: "job", id: i.jobId, label: "job" }],
};

const completeInput = z.object({ jobId: z.uuid(), notes: z.string().trim().max(2000).optional() });

export const completeJobTool: AIToolDefinition<typeof completeInput> = {
  name: "complete_job",
  description: "Mark a job completed (with optional completion notes). Requires confirmation. Afterwards offer to create the invoice.",
  actionClass: "consequential",
  requiredPermissions: ["jobs.work"],
  inputSchema: completeInput,
  execute: (ctx, i) => setJobStatus(ctx, i.jobId, "complete", i.notes),
  summarise: () => "Mark this job completed",
  describe: async (ctx, i) => `Mark job ${await jobLabel(ctx, i.jobId)} as completed`,
  card: (i) => ({ label: "Open job", href: `/app/work/jobs/${i.jobId}` }),
  focus: (i) => [{ type: "job", id: i.jobId, label: "completed job" }],
};

const startInput = z.object({ jobId: z.uuid() });

export const startJobTool: AIToolDefinition<typeof startInput> = {
  name: "start_job",
  description: "Mark a scheduled job as in progress.",
  actionClass: "draft",
  requiredPermissions: ["jobs.work"],
  inputSchema: startInput,
  execute: (ctx, i) => setJobStatus(ctx, i.jobId, "start"),
  summarise: () => "Start this job",
  card: (i) => ({ label: "Open job", href: `/app/work/jobs/${i.jobId}` }),
};

export const createInvoiceFromJobTool: AIToolDefinition<typeof startInput, { invoiceId: string; created: boolean }> = {
  name: "create_invoice_from_job",
  description: "Create a DRAFT invoice from a completed job (copies the quote lines). Idempotent. The user reviews it before issuing.",
  actionClass: "draft",
  requiredPermissions: ["invoices.write"],
  inputSchema: startInput,
  execute: (ctx, i) => createInvoiceFromJob(ctx, i.jobId),
  summarise: () => "Draft the invoice for this job",
  card: (_i, out) => ({ label: out.created ? "Draft invoice" : "Existing invoice", href: `/app/money/invoices/${out.invoiceId}` }),
  focus: (_i, out) => [{ type: "invoice", id: out.invoiceId, label: "invoice" }],
};
