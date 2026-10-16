import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { Json, Tables, TablesUpdate } from "@/types/database.types";
import { dayBoundsInZone } from "@/lib/dates";
import {
  assignMembersSchema,
  createJobFromQuoteSchema,
  createJobSchema,
  displayJobStatus,
  jobNoteSchema,
  jobPhotoSchema,
  jobStatusSchema,
  listJobsSchema,
  sanitiseJobSearch,
  scheduleJobSchema,
  updateJobSchema,
  type AssignMembersInput,
  type CreateJobFromQuoteInput,
  type CreateJobInput,
  type JobAction,
  type JobNoteInput,
  type JobPhotoInput,
  type ListJobsInput,
  type ScheduleJobInput,
  type UpdateJobInput,
} from "./schema";
import { dayBoundsForDate, isDateString } from "./calendar";
import { JOB_PHOTO_BUCKET, PHOTO_URL_TTL_SECONDS, isJobPhotoPath } from "./photos";

/**
 * Jobs business logic — single implementation for screens, Quick Create and AI tools.
 * Numbering, status transitions, closed-job locks, assignment rules and audit are
 * enforced in Postgres (migration 20261016000500). Field agents (jobs.read_assigned)
 * can't read customer tables — their customer/site/contact data comes ONLY from the
 * get_field_job / list_my_jobs RPCs.
 */

export type Job = Tables<"jobs">;

export interface JobAssignee {
  id: string;
  userId: string;
  name: string;
  role: string;
}

export interface JobListItem {
  id: string;
  job_number: string;
  title: string;
  status: string;
  /** Status to display (may be "invoiced"). */
  displayStatus: string;
  priority: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  customer_id: string | null;
  customer_name: string | null;
  site_address: string | null;
  quote_id: string | null;
  assignees: JobAssignee[];
}

export interface ScheduleConflict {
  jobId: string;
  jobNumber: string;
  title: string;
  userId: string;
  userName: string | null;
  start: string;
  end: string;
}

const NOT_FOUND = "We couldn't find that job, or you don't have access to it.";

const profileName = (p: { display_name?: string | null; first_name?: string | null; last_name?: string | null } | null | undefined) =>
  p?.display_name || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Team member";

const ASSIGNMENT_SELECT = "id, user_id, role, profile:profiles!job_assignments_user_id_fkey(display_name, first_name, last_name)" as const;

type AssignmentRow = { id: string; user_id: string; role: string; profile: { display_name: string | null; first_name: string | null; last_name: string | null } | null };
const toAssignee = (a: AssignmentRow): JobAssignee => ({ id: a.id, userId: a.user_id, name: profileName(a.profile), role: a.role });

export function formatAddress(a: Pick<Tables<"customer_addresses">, "line1" | "line2" | "suburb" | "city" | "province" | "postal_code"> | null | undefined): string | null {
  if (!a) return null;
  return [a.line1, a.line2, a.suburb, a.city, a.province, a.postal_code].filter(Boolean).join(", ") || null;
}

/** Org timezone for AI/Today callers that only have a ServiceContext. */
export async function getOrganisationTimezone(ctx: ServiceContext): Promise<string> {
  const { data } = await ctx.supabase.from("organisations").select("timezone").eq("id", ctx.organisationId).maybeSingle();
  return data?.timezone || "Africa/Johannesburg";
}

/** Job ids (of the given set) that have a non-void invoice, directly or via their quote. Empty unless invoices.read. */
async function invoicedJobIds(ctx: ServiceContext, jobs: { id: string; quote_id: string | null }[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ctx.permissions.can("invoices.read") || jobs.length === 0) return out;
  const jobIds = jobs.map((j) => j.id);
  const quoteIds = jobs.map((j) => j.quote_id).filter((q): q is string => !!q);
  const parts = [`job_id.in.(${jobIds.join(",")})`];
  if (quoteIds.length) parts.push(`quote_id.in.(${quoteIds.join(",")})`);
  const { data, error } = await ctx.supabase.from("invoices").select("job_id, quote_id")
    .eq("organisation_id", ctx.organisationId).neq("status", "void").or(parts.join(",")).limit(1000);
  if (error) {
    logServerError("jobs.invoiced", error);
    return out;
  }
  const byQuote = new Map(jobs.filter((j) => j.quote_id).map((j) => [j.quote_id!, j.id]));
  for (const inv of data ?? []) {
    if (inv.job_id) out.add(inv.job_id);
    if (inv.quote_id && byQuote.has(inv.quote_id)) out.add(byQuote.get(inv.quote_id)!);
  }
  return out;
}

async function assignedJobIds(ctx: ServiceContext, userId: string): Promise<string[] | null> {
  const { data, error } = await ctx.supabase.from("job_assignments").select("job_id")
    .eq("organisation_id", ctx.organisationId).eq("user_id", userId).limit(1000);
  if (error) {
    logServerError("jobs.assignedIds", error);
    return null;
  }
  return (data ?? []).map((r) => r.job_id);
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

export async function listJobs(
  ctx: ServiceContext,
  input: ListJobsInput = {},
): Promise<ActionResult<{ jobs: JobListItem[]; total: number; page: number; pageSize: number }>> {
  const parsed = listJobsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid filter");
  const { status, assignee, from, to, customerId, q, page, pageSize } = parsed.data;

  // Field agents: only their own jobs, via the RPC that carries customer name + site.
  if (!ctx.permissions.can("jobs.read_all")) {
    if (!ctx.permissions.can("jobs.read_assigned")) return fail("You don't have access to jobs.");
    const mine = await listMyJobs(ctx, from, to);
    if (!mine.ok) return mine;
    let rows = mine.data;
    if (from || to) rows = rows.filter((j) => j.scheduled_start); // the RPC keeps unscheduled rows in any window
    if (status === "open") rows = rows.filter((j) => j.status !== "completed" && j.status !== "cancelled");
    else if (status !== "all") rows = rows.filter((j) => j.status === status);
    if (q) {
      const t = q.toLowerCase();
      rows = rows.filter((j) => [j.title, j.job_number, j.customer_name ?? ""].some((s) => s.toLowerCase().includes(t)));
    }
    const start = (page - 1) * pageSize;
    return ok({ jobs: rows.slice(start, start + pageSize), total: rows.length, page, pageSize });
  }

  let query = ctx.supabase
    .from("jobs")
    .select(
      `id, job_number, title, status, priority, scheduled_start, scheduled_end, customer_id, quote_id, site_address_id,
       customer:customers!jobs_customer_fk(display_name), job_assignments(${ASSIGNMENT_SELECT})`,
      { count: "exact" },
    )
    .eq("organisation_id", ctx.organisationId)
    .is("archived_at", null);

  if (status === "open") query = query.in("status", ["unscheduled", "scheduled", "in_progress"]);
  else if (status !== "all") query = query.eq("status", status);
  if (customerId) query = query.eq("customer_id", customerId);
  if (from) query = query.gte("scheduled_start", from);
  if (to) query = query.lt("scheduled_start", to);
  if (assignee) {
    const ids = await assignedJobIds(ctx, assignee === "me" ? ctx.userId : assignee);
    if (!ids) return fail("We couldn't load jobs.");
    if (ids.length === 0) return ok({ jobs: [], total: 0, page, pageSize });
    query = query.in("id", ids);
  }
  if (q) {
    const term = sanitiseJobSearch(q);
    if (term) {
      const parts = [`title.ilike.*${term}*`, `job_number.ilike.*${term}*`];
      if (ctx.permissions.can("customers.read")) {
        const { data: cs } = await ctx.supabase.from("customers").select("id")
          .eq("organisation_id", ctx.organisationId).ilike("display_name", `%${term}%`).limit(50);
        if (cs?.length) parts.push(`customer_id.in.(${cs.map((c) => c.id).join(",")})`);
      }
      query = query.or(parts.join(","));
    }
  }

  const fromRow = (page - 1) * pageSize;
  const ordered = status === "completed" || status === "cancelled"
    ? query.order("updated_at", { ascending: false })
    : query.order("scheduled_start", { ascending: true, nullsFirst: true }).order("created_at", { ascending: false });
  const { data, error, count } = await ordered.range(fromRow, fromRow + pageSize - 1);
  if (error) {
    logServerError("jobs.list", error);
    return fail(toUserMessage(error, "We couldn't load jobs."));
  }
  const rows = data ?? [];
  const invoiced = await invoicedJobIds(ctx, rows);
  return ok({
    jobs: rows.map((j) => ({
      id: j.id, job_number: j.job_number, title: j.title, status: j.status, displayStatus: displayJobStatus(j.status, invoiced.has(j.id)),
      priority: j.priority, scheduled_start: j.scheduled_start, scheduled_end: j.scheduled_end, customer_id: j.customer_id,
      customer_name: j.customer?.display_name ?? null, site_address: null, quote_id: j.quote_id,
      assignees: (j.job_assignments ?? []).map(toAssignee),
    })),
    total: count ?? 0,
    page,
    pageSize,
  });
}

/**
 * Scheduled jobs overlapping [from, to) plus nothing else — for calendar views (no paging, cap 500).
 * Cancelled jobs are excluded. Field agents get only their own jobs.
 */
export async function listCalendarJobs(ctx: ServiceContext, fromIso: string, toIso: string): Promise<ActionResult<JobListItem[]>> {
  if (!ctx.permissions.can("jobs.read_all")) {
    const mine = await listMyJobs(ctx, fromIso, toIso);
    return mine.ok ? ok(mine.data.filter((j) => j.scheduled_start)) : mine;
  }
  const { data, error } = await ctx.supabase
    .from("jobs")
    .select(`id, job_number, title, status, priority, scheduled_start, scheduled_end, customer_id, quote_id,
             customer:customers!jobs_customer_fk(display_name), job_assignments(${ASSIGNMENT_SELECT})`)
    .eq("organisation_id", ctx.organisationId)
    .is("archived_at", null)
    .neq("status", "cancelled")
    .not("scheduled_start", "is", null)
    .gte("scheduled_start", fromIso)
    .lt("scheduled_start", toIso)
    .order("scheduled_start")
    .limit(500);
  if (error) {
    logServerError("jobs.calendar", error);
    return fail(toUserMessage(error, "We couldn't load the calendar."));
  }
  const rows = data ?? [];
  const invoiced = await invoicedJobIds(ctx, rows);
  return ok(rows.map((j) => ({
    id: j.id, job_number: j.job_number, title: j.title, status: j.status, displayStatus: displayJobStatus(j.status, invoiced.has(j.id)),
    priority: j.priority, scheduled_start: j.scheduled_start, scheduled_end: j.scheduled_end, customer_id: j.customer_id,
    customer_name: j.customer?.display_name ?? null, site_address: null, quote_id: j.quote_id, assignees: (j.job_assignments ?? []).map(toAssignee),
  })));
}

/** Unscheduled, open jobs (calendar sidebar). */
export async function listUnscheduledJobs(ctx: ServiceContext, limit = 50): Promise<ActionResult<JobListItem[]>> {
  const r = await listJobs(ctx, { status: "unscheduled", pageSize: Math.min(limit, 100) });
  return r.ok ? ok(r.data.jobs) : r;
}

export interface JobNote {
  id: string;
  body: string;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
}

export type JobPhoto = Tables<"job_photos">;

export interface JobDetail {
  job: Job;
  displayStatus: string;
  customer: { id: string; display_name: string; phone: string | null; email: string | null } | null;
  contact: { id: string; name: string; phone: string | null; email: string | null } | null;
  site: { id: string; label: string | null; address: string | null; notes: string | null } | null;
  quote: { id: string; quote_number: string; status: string } | null;
  invoice: { id: string; invoice_number: string | null; status: string } | null;
  assignments: JobAssignee[];
  notes: JobNote[];
  photos: JobPhoto[];
}

async function loadNotesAndPhotos(ctx: ServiceContext, jobId: string) {
  const [notes, photos] = await Promise.all([
    ctx.supabase.from("job_notes").select("id, body, created_at, author_id, author:profiles!job_notes_author_id_fkey(display_name, first_name, last_name)")
      .eq("organisation_id", ctx.organisationId).eq("job_id", jobId).order("created_at", { ascending: false }).limit(200),
    ctx.supabase.from("job_photos").select("*").eq("organisation_id", ctx.organisationId).eq("job_id", jobId)
      .order("created_at", { ascending: false }).limit(200),
  ]);
  const error = notes.error ?? photos.error;
  return {
    error,
    notes: (notes.data ?? []).map((n) => ({
      id: n.id, body: n.body, createdAt: n.created_at, authorId: n.author_id, authorName: n.author ? profileName(n.author) : null,
    })) as JobNote[],
    photos: (photos.data ?? []) as JobPhoto[],
  };
}

/** Every jobs column except internal_notes (see migration 20261016000800). */
const JOB_COLUMNS = "actual_end, actual_start, archived_at, cancel_reason, cancelled_at, completed_at, completed_by, completion_notes, contact_id, created_at, created_by, customer_id, description, id, job_number, lead_id, organisation_id, priority, quote_id, scheduled_end, scheduled_start, site_address_id, status, title, updated_at" as const;

/** Office view of a job (jobs.read_all). Related records are included only where the viewer may read them. */
export async function getJob(ctx: ServiceContext, id: string): Promise<ActionResult<JobDetail>> {
  const [j, notesRpc, a, extra] = await Promise.all([
    ctx.supabase.from("jobs").select(JOB_COLUMNS).eq("organisation_id", ctx.organisationId).eq("id", id).maybeSingle(),
    // internal_notes is not column-readable through the API (field agents must never see it); office users read it via RPC.
    ctx.supabase.rpc("get_job_internal_notes", { p_job_id: id }),
    ctx.supabase.from("job_assignments").select(ASSIGNMENT_SELECT).eq("organisation_id", ctx.organisationId).eq("job_id", id)
      .order("role").order("assigned_at"),
    loadNotesAndPhotos(ctx, id),
  ]);
  const error = j.error ?? a.error ?? extra.error;
  if (error) {
    logServerError("jobs.get", error);
    return fail(toUserMessage(error, "We couldn't load this job."));
  }
  if (!j.data) return fail(NOT_FOUND);
  const job = { ...j.data, internal_notes: notesRpc.error ? null : ((notesRpc.data as string | null) ?? null) };
  if (notesRpc.error) logServerError("jobs.get.internal_notes", notesRpc.error);

  const canCustomers = ctx.permissions.can("customers.read");
  const [cust, contact, site, quote, invoice] = await Promise.all([
    canCustomers ? ctx.supabase.from("customers").select("id, display_name, phone, email").eq("id", job.customer_id).maybeSingle() : null,
    canCustomers
      ? job.contact_id
        ? ctx.supabase.from("customer_contacts").select("id, first_name, last_name, phone, email").eq("id", job.contact_id).maybeSingle()
        : ctx.supabase.from("customer_contacts").select("id, first_name, last_name, phone, email").eq("customer_id", job.customer_id).eq("is_primary", true).limit(1).maybeSingle()
      : null,
    canCustomers && job.site_address_id
      ? ctx.supabase.from("customer_addresses").select("id, label, line1, line2, suburb, city, province, postal_code, notes").eq("id", job.site_address_id).maybeSingle()
      : null,
    job.quote_id && ctx.permissions.can("quotes.read")
      ? ctx.supabase.from("quotes").select("id, quote_number, status").eq("id", job.quote_id).maybeSingle()
      : null,
    ctx.permissions.can("invoices.read")
      ? ctx.supabase.from("invoices").select("id, invoice_number, status").eq("organisation_id", ctx.organisationId).neq("status", "void")
          .or(job.quote_id ? `job_id.eq.${job.id},quote_id.eq.${job.quote_id}` : `job_id.eq.${job.id}`)
          .order("created_at", { ascending: false }).limit(1).maybeSingle()
      : null,
  ]);
  for (const r of [cust, contact, site, quote, invoice]) if (r?.error) logServerError("jobs.get.related", r.error);

  const c = contact?.data;
  const s = site?.data;
  return ok({
    job,
    displayStatus: displayJobStatus(job.status, !!invoice?.data),
    customer: cust?.data ?? null,
    contact: c ? { id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(" "), phone: c.phone, email: c.email } : null,
    site: s ? { id: s.id, label: s.label, address: formatAddress(s), notes: s.notes } : null,
    quote: quote?.data ?? null,
    invoice: invoice?.data ?? null,
    assignments: ((a.data ?? []) as AssignmentRow[]).map(toAssignee),
    notes: extra.notes,
    photos: extra.photos,
  });
}

export interface FieldJob {
  id: string;
  job_number: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  completed_at: string | null;
  completion_notes: string | null;
  customer_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  site_label: string | null;
  site_address: string | null;
  site_notes: string | null;
}

export interface FieldJobDetail {
  job: FieldJob;
  notes: JobNote[];
  photos: JobPhoto[];
}

const str = (v: Json | undefined): string | null => (typeof v === "string" && v !== "" ? v : null);

export function parseFieldJob(raw: Json): FieldJob | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, Json | undefined>;
  if (!str(o.id)) return null;
  return {
    id: str(o.id)!, job_number: str(o.job_number) ?? "", title: str(o.title) ?? "", description: str(o.description),
    status: str(o.status) ?? "unscheduled", priority: str(o.priority) ?? "normal",
    scheduled_start: str(o.scheduled_start), scheduled_end: str(o.scheduled_end), actual_start: str(o.actual_start),
    actual_end: str(o.actual_end), completed_at: str(o.completed_at), completion_notes: str(o.completion_notes),
    customer_name: str(o.customer_name), contact_name: str(o.contact_name), contact_phone: str(o.contact_phone),
    site_label: str(o.site_label), site_address: str(o.site_address), site_notes: str(o.site_notes),
  };
}

/** Field (mobile) view — minimum customer info via rpc get_field_job; notes/photos via RLS. */
export async function getFieldJob(ctx: ServiceContext, id: string): Promise<ActionResult<FieldJobDetail>> {
  const [r, extra] = await Promise.all([ctx.supabase.rpc("get_field_job", { p_job_id: id }), loadNotesAndPhotos(ctx, id)]);
  if (r.error) {
    if (r.error.code === "P0002") return fail(NOT_FOUND);
    logServerError("jobs.field", r.error);
    return fail(toUserMessage(r.error, "We couldn't load this job."));
  }
  const job = parseFieldJob(r.data);
  if (!job) return fail(NOT_FOUND);
  if (extra.error) logServerError("jobs.field.extra", extra.error);
  return ok({ job, notes: extra.notes, photos: extra.photos });
}

/** Jobs assigned to the current user (rpc list_my_jobs). Unscheduled jobs are always included by the RPC. */
export async function listMyJobs(ctx: ServiceContext, fromIso?: string, toIso?: string): Promise<ActionResult<JobListItem[]>> {
  const { data, error } = await ctx.supabase.rpc("list_my_jobs", {
    p_organisation_id: ctx.organisationId, p_from: fromIso || undefined, p_to: toIso || undefined,
  });
  if (error) {
    logServerError("jobs.mine", error);
    return fail(toUserMessage(error, "We couldn't load your jobs."));
  }
  return ok((data ?? []).map((j) => ({
    id: j.id, job_number: j.job_number, title: j.title, status: j.status, displayStatus: j.status, priority: "normal",
    scheduled_start: j.scheduled_start, scheduled_end: j.scheduled_end, customer_id: null, customer_name: j.customer_name ?? null,
    site_address: j.site_address || null, quote_id: null, assignees: [],
  })));
}

/**
 * For Today (field workers): my jobs scheduled today in the org timezone, plus anything I have
 * in progress. Ordered by start time.
 */
export async function listMyJobsToday(ctx: ServiceContext, timeZone?: string, now: Date = new Date()): Promise<ActionResult<JobListItem[]>> {
  const tz = timeZone ?? (await getOrganisationTimezone(ctx));
  const { start, end } = dayBoundsInZone(now, tz);
  const r = await listMyJobs(ctx);
  if (!r.ok) return r;
  const rows = r.data.filter((j) =>
    j.status === "in_progress" || (j.scheduled_start && j.scheduled_start >= start && j.scheduled_start < end && j.status !== "cancelled"));
  rows.sort((a, b) => (a.scheduled_start ?? "9999") < (b.scheduled_start ?? "9999") ? -1 : 1);
  return ok(rows);
}

/** AI: free-text job lookup (number, title, customer). */
export async function findJobs(ctx: ServiceContext, q: string, limit = 10): Promise<ActionResult<JobListItem[]>> {
  const r = await listJobs(ctx, { q, pageSize: Math.min(Math.max(limit, 1), 25) });
  return r.ok ? ok(r.data.jobs) : r;
}

/** AI/Calendar: jobs scheduled on a local date (YYYY-MM-DD, org timezone). */
export async function listJobsForDate(ctx: ServiceContext, date: string, timeZone?: string): Promise<ActionResult<JobListItem[]>> {
  if (!isDateString(date)) return fail("Use a date like 2026-10-16.");
  const tz = timeZone ?? (await getOrganisationTimezone(ctx));
  const { start, end } = dayBoundsForDate(date, tz);
  return listCalendarJobs(ctx, start, end);
}

// -----------------------------------------------------------------------------
// Quote → job
// -----------------------------------------------------------------------------

export interface QuoteJobPreview {
  quote: { id: string; quote_number: string; status: string; title: string | null; notes: string | null };
  customerName: string | null;
  siteAddress: string | null;
  contactName: string | null;
  scope: { description: string; quantity: number; unit: string | null }[];
  existingJob: { id: string; job_number: string } | null;
}

/** Data for the "Create job from quote" confirmation screen. */
export async function getQuoteJobPreview(ctx: ServiceContext, quoteId: string): Promise<ActionResult<QuoteJobPreview>> {
  if (!ctx.permissions.can("quotes.read")) return fail("You don't have access to quotes.");
  const [q, items, existing] = await Promise.all([
    ctx.supabase.from("quotes").select("id, quote_number, status, title, notes, customer_id, contact_id, site_address_id, customer_name_snapshot, site_address_snapshot, contact_name_snapshot")
      .eq("organisation_id", ctx.organisationId).eq("id", quoteId).maybeSingle(),
    ctx.supabase.from("quote_items").select("description, quantity, unit, sort_order").eq("quote_id", quoteId).order("sort_order").limit(200),
    ctx.supabase.from("jobs").select("id, job_number").eq("organisation_id", ctx.organisationId).eq("quote_id", quoteId).neq("status", "cancelled").limit(1).maybeSingle(),
  ]);
  const error = q.error ?? items.error ?? existing.error;
  if (error) {
    logServerError("jobs.quotePreview", error);
    return fail(toUserMessage(error, "We couldn't load the quote."));
  }
  if (!q.data) return fail("We couldn't find that quote, or you don't have access to it.");
  const quote = q.data;
  let customerName = quote.customer_name_snapshot;
  let siteAddress = quote.site_address_snapshot;
  let contactName = quote.contact_name_snapshot;
  if (ctx.permissions.can("customers.read")) {
    const [c, s, ct] = await Promise.all([
      customerName ? null : ctx.supabase.from("customers").select("display_name").eq("id", quote.customer_id).maybeSingle(),
      siteAddress || !quote.site_address_id ? null
        : ctx.supabase.from("customer_addresses").select("line1, line2, suburb, city, province, postal_code").eq("id", quote.site_address_id).maybeSingle(),
      contactName || !quote.contact_id ? null : ctx.supabase.from("customer_contacts").select("first_name, last_name").eq("id", quote.contact_id).maybeSingle(),
    ]);
    customerName ??= c?.data?.display_name ?? null;
    siteAddress ??= formatAddress(s?.data);
    contactName ??= ct?.data ? [ct.data.first_name, ct.data.last_name].filter(Boolean).join(" ") : null;
  }
  return ok({
    quote: { id: quote.id, quote_number: quote.quote_number, status: quote.status, title: quote.title, notes: quote.notes },
    customerName, siteAddress, contactName,
    scope: (items.data ?? []).map((i) => ({ description: i.description, quantity: Number(i.quantity), unit: i.unit })),
    existingJob: existing.data ?? null,
  });
}

/** Accepted quote → job (idempotent in the DB: returns the existing active job for the quote). */
export async function createJobFromQuote(ctx: ServiceContext, input: CreateJobFromQuoteInput): Promise<ActionResult<{ jobId: string; created: boolean }>> {
  if (!ctx.permissions.can("jobs.write")) return fail("You don't have permission to create jobs.");
  const parsed = createJobFromQuoteSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const { data, error } = await ctx.supabase.rpc("create_job_from_quote", {
    p_quote_id: v.quoteId,
    p_scheduled_start: v.scheduledStart ?? undefined,
    p_scheduled_end: v.scheduledEnd ?? undefined,
    p_title: v.title ?? undefined,
  });
  const res = data as { job_id?: string; created?: boolean } | null;
  if (error || !res?.job_id) {
    logServerError("jobs.fromQuote", error);
    return fail(toUserMessage(error, "We couldn't create the job."));
  }
  return ok({ jobId: res.job_id, created: !!res.created });
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

async function conflictsFor(ctx: ServiceContext, start: string, end: string | null, userIds: string[], excludeJobId?: string): Promise<ScheduleConflict[]> {
  if (!start || userIds.length === 0) return [];
  const endIso = end ?? new Date(new Date(start).getTime() + 2 * 3600_000).toISOString();
  const { data, error } = await ctx.supabase.rpc("find_schedule_conflicts", {
    p_organisation_id: ctx.organisationId, p_start: start, p_end: endIso, p_user_ids: userIds, p_exclude_job_id: excludeJobId,
  });
  if (error) {
    logServerError("jobs.conflicts", error);
    return [];
  }
  const rows = data ?? [];
  const names = new Map<string, string>();
  const uids = [...new Set(rows.map((r) => r.user_id))];
  if (uids.length) {
    const { data: ps } = await ctx.supabase.from("profiles").select("id, display_name, first_name, last_name").in("id", uids);
    for (const p of ps ?? []) names.set(p.id, profileName(p));
  }
  return rows.map((r) => ({
    jobId: r.job_id, jobNumber: r.job_number, title: r.title, userId: r.user_id, userName: names.get(r.user_id) ?? null,
    start: r.scheduled_start, end: r.scheduled_end,
  }));
}

/** Deterministic overlap check (rpc find_schedule_conflicts) — warnings only; callers may proceed. */
export async function checkScheduleConflicts(
  ctx: ServiceContext,
  input: { start: string; end?: string | null; userIds: string[]; excludeJobId?: string },
): Promise<ActionResult<ScheduleConflict[]>> {
  if (!input.start || Number.isNaN(new Date(input.start).getTime())) return fail("Choose a start time.");
  return ok(await conflictsFor(ctx, input.start, input.end ?? null, input.userIds.slice(0, 50), input.excludeJobId));
}

export async function createJob(
  ctx: ServiceContext,
  input: CreateJobInput,
): Promise<ActionResult<{ id: string; jobNumber: string; conflicts: ScheduleConflict[] }>> {
  if (!ctx.permissions.can("jobs.write")) return fail("You don't have permission to create jobs.");
  const parsed = createJobSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const { data, error } = await ctx.supabase.from("jobs").insert({
    organisation_id: ctx.organisationId, customer_id: v.customerId, contact_id: v.contactId, site_address_id: v.siteAddressId,
    title: v.title, description: v.description, priority: v.priority,
    scheduled_start: v.scheduledStart, scheduled_end: v.scheduledStart ? v.scheduledEnd : null,
    // status / job_number / created_by are set by the guard trigger
    job_number: "pending",
  }).select("id, job_number").single();
  if (error || !data) {
    logServerError("jobs.create", error);
    return fail(toUserMessage(error, "We couldn't create the job."));
  }
  let conflicts: ScheduleConflict[] = [];
  const ids = [...new Set(v.assigneeIds)];
  if (ids.length) {
    const a = await ctx.supabase.from("job_assignments").insert(
      ids.map((u, i) => ({ organisation_id: ctx.organisationId, job_id: data.id, user_id: u, role: i === 0 ? "lead" : "worker" })),
    );
    if (a.error) {
      logServerError("jobs.create.assign", a.error);
      return fail(`Job ${data.job_number} was created, but we couldn't assign the team: ${toUserMessage(a.error)}`);
    }
    if (v.scheduledStart) conflicts = await conflictsFor(ctx, v.scheduledStart, v.scheduledEnd, ids, data.id);
  }
  return ok({ id: data.id, jobNumber: data.job_number, conflicts });
}

export async function updateJob(ctx: ServiceContext, id: string, input: UpdateJobInput): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("jobs.write")) return fail("You don't have permission to edit jobs.");
  const parsed = updateJobSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const has = (k: keyof UpdateJobInput) => (input as Record<string, unknown>)[k] !== undefined;
  const row: TablesUpdate<"jobs"> = {};
  if (has("title") && v.title) row.title = v.title;
  if (has("description")) row.description = v.description ?? null;
  if (has("priority") && v.priority) row.priority = v.priority;
  if (has("internalNotes")) row.internal_notes = v.internalNotes ?? null;
  if (has("contactId")) row.contact_id = v.contactId ?? null;
  if (has("siteAddressId")) row.site_address_id = v.siteAddressId ?? null;
  if (Object.keys(row).length === 0) return ok({ id });
  const { data, error } = await ctx.supabase.from("jobs").update(row).eq("organisation_id", ctx.organisationId).eq("id", id).select("id").maybeSingle();
  if (error) {
    logServerError("jobs.update", error);
    return fail(toUserMessage(error, "We couldn't save the job."));
  }
  if (!data) return fail(NOT_FOUND);
  return ok({ id: data.id });
}

/**
 * Set or clear a job's schedule. Checks assignee conflicts first; if any and `force` is false,
 * nothing is saved and the conflicts come back as warnings so the user can decide.
 */
export async function scheduleJob(
  ctx: ServiceContext,
  id: string,
  input: ScheduleJobInput,
): Promise<ActionResult<{ scheduled: boolean; conflicts: ScheduleConflict[] }>> {
  if (!ctx.permissions.can("jobs.write")) return fail("You don't have permission to schedule jobs.");
  const parsed = scheduleJobSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const { data: job, error: jErr } = await ctx.supabase.from("jobs").select("id, status, job_assignments(user_id)")
    .eq("organisation_id", ctx.organisationId).eq("id", id).maybeSingle();
  if (jErr) {
    logServerError("jobs.schedule.load", jErr);
    return fail(toUserMessage(jErr, "We couldn't schedule the job."));
  }
  if (!job) return fail(NOT_FOUND);
  if (job.status === "completed" || job.status === "cancelled") return fail("This job is closed and can no longer be edited.");
  if (!v.scheduledStart && job.status === "in_progress") return fail("A job that has started can't be unscheduled.");

  let conflicts: ScheduleConflict[] = [];
  if (v.scheduledStart) {
    conflicts = await conflictsFor(ctx, v.scheduledStart, v.scheduledEnd, (job.job_assignments ?? []).map((a) => a.user_id), id);
    if (conflicts.length && !v.force) return ok({ scheduled: false, conflicts });
  }
  const { data, error } = await ctx.supabase.from("jobs")
    .update({ scheduled_start: v.scheduledStart, scheduled_end: v.scheduledStart ? v.scheduledEnd : null })
    .eq("organisation_id", ctx.organisationId).eq("id", id).select("id").maybeSingle();
  if (error) {
    logServerError("jobs.schedule", error);
    return fail(toUserMessage(error, "We couldn't schedule the job."));
  }
  if (!data) return fail(NOT_FOUND);
  return ok({ scheduled: true, conflicts });
}

/**
 * Add people to a job (or change their role). Returns schedule conflicts for the newly
 * assigned people as warnings — the assignment is still made.
 */
export async function assignMembers(
  ctx: ServiceContext,
  jobId: string,
  input: AssignMembersInput,
): Promise<ActionResult<{ added: number; conflicts: ScheduleConflict[] }>> {
  if (!ctx.permissions.can("jobs.write")) return fail("You don't have permission to assign jobs.");
  const parsed = assignMembersSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const { userIds, role } = parsed.data;
  const { data: job, error: jErr } = await ctx.supabase.from("jobs").select("id, status, scheduled_start, scheduled_end, job_assignments(user_id, role)")
    .eq("organisation_id", ctx.organisationId).eq("id", jobId).maybeSingle();
  if (jErr) {
    logServerError("jobs.assign.load", jErr);
    return fail(toUserMessage(jErr, "We couldn't assign the job."));
  }
  if (!job) return fail(NOT_FOUND);
  if (job.status === "cancelled") return fail("This job is cancelled.");

  const existing = new Map((job.job_assignments ?? []).map((a) => [a.user_id, a.role]));
  const wanted = [...new Set(userIds)];
  const changeRole = wanted.filter((u) => existing.has(u) && existing.get(u) !== role);
  const fresh = wanted.filter((u) => !existing.has(u));
  // No UPDATE grant on job_assignments by design: a role change is delete + insert.
  if (changeRole.length) {
    const d = await ctx.supabase.from("job_assignments").delete().eq("organisation_id", ctx.organisationId).eq("job_id", jobId).in("user_id", changeRole);
    if (d.error) {
      logServerError("jobs.assign.role", d.error);
      return fail(toUserMessage(d.error, "We couldn't change the team role."));
    }
  }
  const toInsert = [...fresh, ...changeRole];
  if (toInsert.length) {
    const { error } = await ctx.supabase.from("job_assignments").insert(
      toInsert.map((u) => ({ organisation_id: ctx.organisationId, job_id: jobId, user_id: u, role })),
    );
    if (error) {
      logServerError("jobs.assign", error);
      return fail(toUserMessage(error, "We couldn't assign the job."));
    }
  }
  const conflicts = job.scheduled_start && fresh.length && (job.status === "scheduled" || job.status === "in_progress")
    ? await conflictsFor(ctx, job.scheduled_start, job.scheduled_end, fresh, jobId)
    : [];
  return ok({ added: fresh.length, conflicts });
}

export async function unassignMember(ctx: ServiceContext, jobId: string, userId: string): Promise<ActionResult<{ jobId: string }>> {
  if (!ctx.permissions.can("jobs.write")) return fail("You don't have permission to change the team.");
  const { data, error } = await ctx.supabase.from("job_assignments").delete()
    .eq("organisation_id", ctx.organisationId).eq("job_id", jobId).eq("user_id", userId).select("id");
  if (error) {
    logServerError("jobs.unassign", error);
    return fail(toUserMessage(error, "We couldn't remove that person from the job."));
  }
  if (!data?.length) return fail("That person isn't on this job.");
  return ok({ jobId });
}

/** start | complete | cancel | reopen — only through rpc set_job_status (guards + audit in the DB). */
export async function setJobStatus(
  ctx: ServiceContext,
  id: string,
  action: JobAction,
  notes?: string | null,
): Promise<ActionResult<{ id: string; status: string; already: boolean }>> {
  const parsed = jobStatusSchema.safeParse({ action, notes });
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const needsWrite = v.action === "cancel" || v.action === "reopen";
  if (needsWrite ? !ctx.permissions.can("jobs.write") : !ctx.permissions.canAny("jobs.write", "jobs.work")) {
    return fail("You don't have permission to do that.");
  }
  const { data, error } = await ctx.supabase.rpc("set_job_status", { p_job_id: id, p_action: v.action, p_notes: v.notes ?? undefined });
  const res = data as { id?: string; status?: string; already?: boolean } | null;
  if (error || !res?.status) {
    if (error?.code === "P0002") return fail(NOT_FOUND);
    logServerError("jobs.status", error);
    return fail(toUserMessage(error, "We couldn't update the job."));
  }
  return ok({ id, status: res.status, already: !!res.already });
}

export async function addJobNote(ctx: ServiceContext, jobId: string, input: JobNoteInput): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.canAny("jobs.write", "jobs.work")) return fail("You don't have permission to add notes.");
  const parsed = jobNoteSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const { data, error } = await ctx.supabase.from("job_notes")
    .insert({ organisation_id: ctx.organisationId, job_id: jobId, body: parsed.data.body }).select("id").single();
  if (error) {
    logServerError("jobs.note", error);
    return fail(toUserMessage(error, "We couldn't save the note."));
  }
  return ok({ id: data.id });
}

/** Record a photo that the browser already uploaded to storage (job-photos bucket). */
export async function addJobPhoto(ctx: ServiceContext, jobId: string, input: JobPhotoInput): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.canAny("jobs.write", "jobs.work")) return fail("You don't have permission to add photos.");
  const parsed = jobPhotoSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the photo details.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  if (!isJobPhotoPath(v.storagePath, ctx.organisationId, jobId)) return fail("That photo wasn't uploaded to this job.");
  const { data, error } = await ctx.supabase.from("job_photos").insert({
    organisation_id: ctx.organisationId, job_id: jobId, storage_path: v.storagePath, caption: v.caption, category: v.category,
    width: v.width ?? null, height: v.height ?? null, byte_size: v.byteSize ?? null, taken_at: v.takenAt,
  }).select("id").single();
  if (error) {
    logServerError("jobs.photo", error);
    return fail(toUserMessage(error, "We couldn't save the photo."));
  }
  return ok({ id: data.id });
}

/** Short-lived signed URLs, created with the viewer's own client so storage RLS applies. */
export async function getPhotoUrls(ctx: ServiceContext, paths: string[], expiresIn = PHOTO_URL_TTL_SECONDS): Promise<ActionResult<Record<string, string>>> {
  const clean = [...new Set(paths)].filter((p) => p.startsWith(`${ctx.organisationId}/jobs/`)).slice(0, 200);
  if (clean.length === 0) return ok({});
  const { data, error } = await ctx.supabase.storage.from(JOB_PHOTO_BUCKET).createSignedUrls(clean, Math.min(Math.max(expiresIn, 30), 3600));
  if (error) {
    logServerError("jobs.photoUrls", error);
    return fail(toUserMessage(error, "We couldn't load the photos."));
  }
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) out[d.path] = d.signedUrl;
  return ok(out);
}

/** Completed job → draft invoice (rpc create_invoice_from_job, idempotent). */
export async function createInvoiceFromJob(ctx: ServiceContext, jobId: string): Promise<ActionResult<{ invoiceId: string; created: boolean }>> {
  if (!ctx.permissions.can("invoices.write")) return fail("You don't have permission to create invoices.");
  const { data, error } = await ctx.supabase.rpc("create_invoice_from_job", { p_job_id: jobId });
  const res = data as { invoice_id?: string; created?: boolean } | null;
  if (error || !res?.invoice_id) {
    logServerError("jobs.invoice", error);
    return fail(toUserMessage(error, "We couldn't create the invoice."));
  }
  return ok({ invoiceId: res.invoice_id, created: !!res.created });
}

/** Active members for assignment pickers. */
export async function listAssignableMembers(ctx: ServiceContext): Promise<ActionResult<{ userId: string; name: string; role: string }[]>> {
  const { data, error } = await ctx.supabase.from("organisation_members")
    .select("user_id, role, profile:profiles!organisation_members_user_id_fkey(display_name, first_name, last_name)")
    .eq("organisation_id", ctx.organisationId).eq("status", "active").limit(500);
  if (error) {
    logServerError("jobs.members", error);
    return fail(toUserMessage(error, "We couldn't load your team."));
  }
  return ok((data ?? []).filter((m) => m.role !== "viewer" && m.role !== "accountant").map((m) => ({ userId: m.user_id, name: profileName(m.profile), role: m.role }))
    .sort((a, b) => a.name.localeCompare(b.name)));
}
