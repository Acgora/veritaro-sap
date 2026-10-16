import { z } from "zod";
import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import { dayBoundsInZone } from "@/lib/dates";
import type { ServiceContext } from "@/domain/context";
import type { Tables, TablesUpdate } from "@/types/database.types";
import { sanitiseSearch } from "@/domain/customers/schema";
import { createTaskSchema, type CreateTaskInput } from "@/domain/tasks/schema";
import {
  ACTIVE_LEAD_STATUSES,
  OPEN_LEAD_STATUSES,
  PIPELINE_CLOSED_WINDOW_DAYS,
  convertLeadSchema,
  createLeadSchema,
  listLeadsSchema,
  pipelineFiltersSchema,
  scheduleFollowUpSchema,
  setLeadStatusSchema,
  updateLeadSchema,
  type ConvertLeadInput,
  type CreateLeadInput,
  type LeadStatus,
  type ListLeadsInput,
  type PipelineFiltersInput,
  type SetLeadStatusInput,
  type UpdateLeadInput,
} from "./schema";
import { deriveLeadTitle, followUpDueAt, followUpReason, groupLeadsByStatus, leadDisplayName, type FollowUpReason } from "./rules";

/**
 * Lead business logic — the single implementation for the pipeline, lead screens, Quick Create and AI tools.
 * Tenancy, status timestamps (won_at/lost_at), assignee checks and audit are enforced in Postgres
 * (guard_leads / audit_leads). Conversion goes through convert_lead_to_customer only.
 */

export type Lead = Tables<"leads">;

type ProfileName = { display_name: string | null; first_name: string | null; last_name: string | null } | null;
const personName = (p: ProfileName): string | null =>
  p ? p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || null : null;

const ASSIGNEE = "assignee:profiles!leads_assigned_to_fkey(display_name, first_name, last_name)";

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

export interface LeadListItem {
  id: string;
  title: string;
  person_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  service_summary: string | null;
  estimated_value: number | null;
  next_follow_up_at: string | null;
  last_activity_at: string;
  assigned_to: string | null;
  assigneeName: string | null;
  customer_id: string | null;
  created_at: string;
  archived_at: string | null;
}

const LIST_COLUMNS =
  `id, title, person_name, company_name, email, phone, source, status, service_summary, estimated_value, next_follow_up_at, last_activity_at, assigned_to, customer_id, created_at, archived_at, ${ASSIGNEE}` as const;

/** Follow-up threshold + "end of today" in the organisation's timezone. */
async function followUpConfig(ctx: ServiceContext, now: Date) {
  const [org, fs] = await Promise.all([
    ctx.supabase.from("organisations").select("timezone").eq("id", ctx.organisationId).maybeSingle(),
    ctx.supabase.from("organisation_financial_settings").select("lead_followup_days").eq("organisation_id", ctx.organisationId).maybeSingle(),
  ]);
  const timeZone = org.data?.timezone || "Africa/Johannesburg";
  let dayEnd: string;
  try {
    dayEnd = dayBoundsInZone(now, timeZone).end;
  } catch {
    dayEnd = dayBoundsInZone(now, "Africa/Johannesburg").end;
  }
  const followupDays = fs.data?.lead_followup_days ?? 2;
  const cutoff = new Date(now.getTime() - followupDays * 86_400_000).toISOString();
  return { timeZone, dayEnd, followupDays, cutoff };
}

/** PostgREST or()-filter for "needs follow-up" (same rule as get_today_summary). */
const followUpOrFilter = (dayEnd: string, cutoff: string) =>
  `next_follow_up_at.lt."${dayEnd}",and(next_follow_up_at.is.null,last_activity_at.lt."${cutoff}")`;

function searchOr(q: string): string | null {
  const term = sanitiseSearch(q);
  if (!term) return null;
  const digits = term.replace(/\D/g, "");
  const parts = [`title.ilike.*${term}*`, `person_name.ilike.*${term}*`, `company_name.ilike.*${term}*`, `email.ilike.*${term}*`];
  if (digits.length >= 4) parts.push(`phone_normalized.ilike.*${digits}*`);
  return parts.join(",");
}

function toListItem(row: Record<string, unknown> & { assignee?: ProfileName }): LeadListItem {
  const { assignee, ...rest } = row;
  return { ...(rest as unknown as Omit<LeadListItem, "assigneeName">), assigneeName: personName(assignee ?? null) };
}

export async function listLeads(
  ctx: ServiceContext,
  input: ListLeadsInput = {},
): Promise<ActionResult<{ leads: LeadListItem[]; total: number; page: number; pageSize: number }>> {
  const parsed = listLeadsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid filter");
  const { q, status, assigned, source, followUp, archived, page, pageSize } = parsed.data;

  let query = ctx.supabase.from("leads").select(LIST_COLUMNS, { count: "exact" }).eq("organisation_id", ctx.organisationId);
  query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (status === "active") query = query.in("status", [...ACTIVE_LEAD_STATUSES]);
  else if (status !== "all") query = query.eq("status", status);
  if (assigned === "me") query = query.eq("assigned_to", ctx.userId);
  else if (assigned === "unassigned") query = query.is("assigned_to", null);
  else if (assigned !== "all") query = query.eq("assigned_to", assigned);
  if (source !== "all") query = query.eq("source", source);
  if (followUp) {
    const cfg = await followUpConfig(ctx, new Date());
    query = query.in("status", [...OPEN_LEAD_STATUSES]).or(followUpOrFilter(cfg.dayEnd, cfg.cutoff));
  }
  if (q) {
    const or = searchOr(q);
    if (or) query = query.or(or);
  }
  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order(followUp ? "next_follow_up_at" : "created_at", followUp ? { ascending: true, nullsFirst: false } : { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) {
    logServerError("leads.list", error);
    return fail(toUserMessage(error, "We couldn't load leads."));
  }
  return ok({ leads: (data ?? []).map((r) => toListItem(r as never)), total: count ?? 0, page, pageSize });
}

export type LeadCard = Pick<
  LeadListItem,
  "id" | "title" | "person_name" | "company_name" | "service_summary" | "estimated_value" | "next_follow_up_at" | "assigned_to" | "assigneeName" | "source" | "status" | "last_activity_at"
>;

const CARD_COLUMNS =
  `id, title, person_name, company_name, service_summary, estimated_value, next_follow_up_at, assigned_to, source, status, last_activity_at, ${ASSIGNEE}` as const;

/**
 * Board data: every non-archived lead in an active stage, plus won/lost from the last 30 days.
 * Inside a column: earliest follow-up first, then newest.
 */
export async function listLeadsForPipeline(
  ctx: ServiceContext,
  input: PipelineFiltersInput = {},
  now: Date = new Date(),
): Promise<ActionResult<{ columns: Record<LeadStatus, LeadCard[]>; total: number; truncated: boolean; closedWindowDays: number }>> {
  const parsed = pipelineFiltersSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid filter");
  const { q, assigned, source } = parsed.data;
  const since = new Date(now.getTime() - PIPELINE_CLOSED_WINDOW_DAYS * 86_400_000).toISOString();
  const LIMIT = 500;

  let query = ctx.supabase
    .from("leads")
    .select(CARD_COLUMNS)
    .eq("organisation_id", ctx.organisationId)
    .is("archived_at", null)
    .or(`status.in.(${ACTIVE_LEAD_STATUSES.join(",")}),won_at.gte."${since}",lost_at.gte."${since}"`);
  if (assigned === "me") query = query.eq("assigned_to", ctx.userId);
  else if (assigned === "unassigned") query = query.is("assigned_to", null);
  else if (assigned !== "all") query = query.eq("assigned_to", assigned);
  if (source !== "all") query = query.eq("source", source);
  if (q) {
    const or = searchOr(q);
    if (or) query = query.or(or);
  }
  const { data, error } = await query
    .order("next_follow_up_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) {
    logServerError("leads.pipeline", error);
    return fail(toUserMessage(error, "We couldn't load the pipeline."));
  }
  const cards = (data ?? []).map((r) => toListItem(r as never) as LeadCard);
  return ok({ columns: groupLeadsByStatus(cards), total: cards.length, truncated: cards.length >= LIMIT, closedWindowDays: PIPELINE_CLOSED_WINDOW_DAYS });
}

export interface LeadQuoteRow { id: string; quote_number: string; status: string; total: number; expiry_date: string | null; title: string | null }
export interface LeadTaskRow { id: string; title: string; status: string; priority: string; due_at: string | null; assigned_to: string | null }
export interface LeadConversationRow {
  id: string;
  subject: string | null;
  primary_channel: string;
  status: string;
  needs_attention: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
}

export interface LeadDetail {
  lead: Lead;
  assigneeName: string | null;
  /** Linked customer. displayName is null when the viewer can't read customers. */
  customer: { id: string; displayName: string | null; status: string | null } | null;
  quotes: LeadQuoteRow[];
  tasks: LeadTaskRow[];
  conversations: LeadConversationRow[];
}

export async function getLead(ctx: ServiceContext, id: string): Promise<ActionResult<LeadDetail>> {
  if (!z.uuid().safeParse(id).success) return fail("We couldn't find that lead.");
  const { data: row, error } = await ctx.supabase
    .from("leads")
    .select(`*, ${ASSIGNEE}`)
    .eq("organisation_id", ctx.organisationId)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logServerError("leads.get", error);
    return fail(toUserMessage(error, "We couldn't load this lead."));
  }
  if (!row) return fail("We couldn't find that lead, or you don't have access to it.");
  const { assignee, ...lead } = row as Lead & { assignee: ProfileName };

  const can = (p: Parameters<ServiceContext["permissions"]["can"]>[0]) => ctx.permissions.can(p);
  const [cust, quotes, tasks, convs] = await Promise.all([
    lead.customer_id && can("customers.read")
      ? ctx.supabase.from("customers").select("id, display_name, status").eq("organisation_id", ctx.organisationId).eq("id", lead.customer_id).maybeSingle()
      : Promise.resolve(null),
    can("quotes.read")
      ? ctx.supabase.from("quotes").select("id, quote_number, status, total, expiry_date, title").eq("organisation_id", ctx.organisationId)
          .eq("lead_id", id).order("created_at", { ascending: false }).limit(50)
      : Promise.resolve(null),
    ctx.permissions.canAny("tasks.read_all", "tasks.read_assigned")
      ? ctx.supabase.from("tasks").select("id, title, status, priority, due_at, assigned_to").eq("organisation_id", ctx.organisationId)
          .eq("related_entity_type", "lead").eq("related_entity_id", id).neq("status", "archived")
          .order("status").order("due_at", { ascending: true, nullsFirst: false }).limit(50)
      : Promise.resolve(null),
    can("inbox.read")
      ? ctx.supabase.from("conversations").select("id, subject, primary_channel, status, needs_attention, last_message_at, last_message_preview")
          .eq("organisation_id", ctx.organisationId).eq("lead_id", id).order("last_message_at", { ascending: false, nullsFirst: false }).limit(20)
      : Promise.resolve(null),
  ]);
  for (const [name, r] of [["customer", cust], ["quotes", quotes], ["tasks", tasks], ["conversations", convs]] as const) {
    if (r?.error) logServerError(`leads.get.${name}`, r.error); // partial data beats a broken page
  }

  return ok({
    lead,
    assigneeName: personName(assignee),
    customer: lead.customer_id
      ? { id: lead.customer_id, displayName: cust?.data?.display_name ?? null, status: cust?.data?.status ?? null }
      : null,
    quotes: (quotes?.data ?? []) as LeadQuoteRow[],
    tasks: (tasks?.data ?? []) as LeadTaskRow[],
    conversations: (convs?.data ?? []) as LeadConversationRow[],
  });
}

export interface LeadMatch {
  id: string;
  title: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  customerId: string | null;
}

/** Fuzzy lookup for pickers and AI ambiguity resolution (non-archived leads). */
export async function findLeads(ctx: ServiceContext, q: string, limit = 8): Promise<ActionResult<LeadMatch[]>> {
  const or = searchOr(q ?? "");
  if (!or) return ok([]);
  const { data, error } = await ctx.supabase
    .from("leads")
    .select("id, title, person_name, company_name, email, phone, status, customer_id")
    .eq("organisation_id", ctx.organisationId)
    .is("archived_at", null)
    .or(or)
    .order("last_activity_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 25));
  if (error) {
    logServerError("leads.find", error);
    return fail(toUserMessage(error, "We couldn't search leads."));
  }
  return ok((data ?? []).map((l) => ({
    id: l.id, title: l.title, name: leadDisplayName(l), email: l.email, phone: l.phone, status: l.status, customerId: l.customer_id,
  })));
}

/** Small option list for pickers: active (not won/lost), non-archived leads, most recent first. */
export async function listLeadOptions(ctx: ServiceContext, limit = 200): Promise<ActionResult<{ id: string; name: string; customerId: string | null }[]>> {
  const { data, error } = await ctx.supabase
    .from("leads")
    .select("id, title, person_name, company_name, email, phone, customer_id")
    .eq("organisation_id", ctx.organisationId)
    .is("archived_at", null)
    .in("status", [...ACTIVE_LEAD_STATUSES])
    .order("last_activity_at", { ascending: false })
    .limit(Math.min(limit, 500));
  if (error) {
    logServerError("leads.options", error);
    return fail(toUserMessage(error, "We couldn't load leads."));
  }
  return ok((data ?? []).map((l) => ({ id: l.id, name: leadDisplayName(l), customerId: l.customer_id })));
}

export interface FollowUpItem {
  id: string;
  title: string;
  name: string;
  status: string;
  source: string;
  assignedTo: string | null;
  dueAt: string;
  reason: FollowUpReason;
}

/**
 * Deterministic follow-up list (same rule as Today): scheduled follow-up due by end of today,
 * or no activity for organisation_financial_settings.lead_followup_days. Earliest due first.
 */
export async function findLeadsNeedingFollowUp(
  ctx: ServiceContext,
  opts: { now?: Date; limit?: number; assignedToMe?: boolean } = {},
): Promise<ActionResult<{ items: FollowUpItem[]; followupDays: number }>> {
  const now = opts.now ?? new Date();
  const cfg = await followUpConfig(ctx, now);
  let query = ctx.supabase
    .from("leads")
    .select("id, title, person_name, company_name, email, phone, status, source, assigned_to, next_follow_up_at, last_activity_at, archived_at")
    .eq("organisation_id", ctx.organisationId)
    .is("archived_at", null)
    .in("status", [...OPEN_LEAD_STATUSES])
    .or(followUpOrFilter(cfg.dayEnd, cfg.cutoff));
  if (opts.assignedToMe) query = query.eq("assigned_to", ctx.userId);
  const { data, error } = await query.limit(Math.min(opts.limit ?? 50, 200));
  if (error) {
    logServerError("leads.followUp", error);
    return fail(toUserMessage(error, "We couldn't check follow-ups."));
  }
  const items: FollowUpItem[] = [];
  for (const l of data ?? []) {
    const reason = followUpReason(l, now, cfg.dayEnd, cfg.followupDays);
    if (!reason) continue;
    items.push({
      id: l.id, title: l.title, name: leadDisplayName(l), status: l.status, source: l.source, assignedTo: l.assigned_to,
      dueAt: followUpDueAt(l, cfg.followupDays), reason,
    });
  }
  items.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return ok({ items, followupDays: cfg.followupDays });
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

const noWrite = () => fail("You don't have permission to change leads.");
const notFound = () => fail("We couldn't find that lead, or you don't have access to it.");
const moneyToNumber = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));

export async function createLead(ctx: ServiceContext, input: CreateLeadInput): Promise<ActionResult<{ id: string; title: string }>> {
  if (!ctx.permissions.can("leads.write")) return fail("You don't have permission to add leads.");
  const parsed = createLeadSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const title = deriveLeadTitle(v);
  const { data, error } = await ctx.supabase
    .from("leads")
    .insert({
      organisation_id: ctx.organisationId,
      title,
      person_name: v.personName,
      company_name: v.companyName,
      email: v.email,
      phone: v.phone,
      source: v.source,
      service_summary: v.serviceSummary,
      site_address_text: v.siteAddressText,
      requested_date: v.requestedDate,
      estimated_value: moneyToNumber(v.estimatedValue),
      assigned_to: v.assignedTo,
      notes: v.notes,
    })
    .select("id, title")
    .single();
  if (error) {
    logServerError("leads.create", error);
    return fail(toUserMessage(error, "We couldn't add the lead."));
  }
  return ok({ id: data.id, title: data.title });
}

export async function updateLead(ctx: ServiceContext, id: string, input: UpdateLeadInput): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("leads.write")) return noWrite();
  const parsed = updateLeadSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const has = (k: keyof UpdateLeadInput) => (input as Record<string, unknown>)[k] !== undefined;

  const { data: current, error: readError } = await ctx.supabase
    .from("leads")
    .select("id, title, person_name, company_name, email, phone, service_summary")
    .eq("organisation_id", ctx.organisationId)
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logServerError("leads.update.read", readError);
    return fail(toUserMessage(readError, "We couldn't save the lead."));
  }
  if (!current) return notFound();

  const next = {
    personName: has("personName") ? v.personName : current.person_name,
    companyName: has("companyName") ? v.companyName : current.company_name,
    email: has("email") ? v.email : current.email,
    phone: has("phone") ? v.phone : current.phone,
    serviceSummary: has("serviceSummary") ? v.serviceSummary : current.service_summary,
  };
  if (!next.personName && !next.companyName) {
    return fail("Please check the highlighted fields.", { personName: ["Enter a person or company name"] });
  }

  const row: TablesUpdate<"leads"> = {};
  if (has("personName")) row.person_name = v.personName ?? null;
  if (has("companyName")) row.company_name = v.companyName ?? null;
  if (has("email")) row.email = v.email ?? null;
  if (has("phone")) row.phone = v.phone ?? null;
  if (has("source") && v.source) row.source = v.source;
  if (has("serviceSummary")) row.service_summary = v.serviceSummary ?? null;
  if (has("siteAddressText")) row.site_address_text = v.siteAddressText ?? null;
  if (has("requestedDate")) row.requested_date = v.requestedDate ?? null;
  if (has("estimatedValue")) row.estimated_value = moneyToNumber(v.estimatedValue);
  if (has("assignedTo")) row.assigned_to = v.assignedTo ?? null;
  if (has("notes")) row.notes = v.notes ?? null;
  if (has("title") || has("personName") || has("companyName") || has("serviceSummary")) {
    row.title = deriveLeadTitle({ ...next, title: has("title") ? v.title : null });
  }
  if (Object.keys(row).length === 0) return ok({ id });

  const { data, error } = await ctx.supabase.from("leads").update(row).eq("organisation_id", ctx.organisationId).eq("id", id).select("id").maybeSingle();
  if (error) {
    logServerError("leads.update", error);
    return fail(toUserMessage(error, "We couldn't save the lead."));
  }
  if (!data) return notFound();
  return ok({ id: data.id });
}

/** Move a lead through the pipeline. Won/lost timestamps are set by the DB; lost needs a reason. */
export async function setLeadStatus(ctx: ServiceContext, id: string, input: SetLeadStatusInput): Promise<ActionResult<{ id: string; status: LeadStatus }>> {
  if (!ctx.permissions.can("leads.write")) return noWrite();
  const parsed = setLeadStatusSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const { status, lostReason } = parsed.data;
  const row: TablesUpdate<"leads"> = { status };
  if (status === "lost") row.lost_reason = lostReason;
  const { data, error } = await ctx.supabase.from("leads").update(row).eq("organisation_id", ctx.organisationId).eq("id", id)
    .is("archived_at", null).select("id").maybeSingle();
  if (error) {
    logServerError("leads.status", error);
    return fail(toUserMessage(error, "We couldn't move the lead."));
  }
  if (!data) return notFound();
  return ok({ id: data.id, status });
}

export const markLeadWon = (ctx: ServiceContext, id: string) => setLeadStatus(ctx, id, { status: "won" });
export const markLeadLost = (ctx: ServiceContext, id: string, lostReason: string) => setLeadStatus(ctx, id, { status: "lost", lostReason });

/** Set (ISO datetime) or clear (null) the next follow-up. */
export async function scheduleFollowUp(ctx: ServiceContext, id: string, at: string | null): Promise<ActionResult<{ id: string; nextFollowUpAt: string | null }>> {
  if (!ctx.permissions.can("leads.write")) return noWrite();
  const parsed = scheduleFollowUpSchema.safeParse({ at });
  if (!parsed.success) return fail("Choose a valid date and time.", { at: ["Choose a valid date and time"] });
  const { data, error } = await ctx.supabase.from("leads").update({ next_follow_up_at: parsed.data.at })
    .eq("organisation_id", ctx.organisationId).eq("id", id).select("id, next_follow_up_at").maybeSingle();
  if (error) {
    logServerError("leads.followUp.set", error);
    return fail(toUserMessage(error, "We couldn't schedule the follow-up."));
  }
  if (!data) return notFound();
  return ok({ id: data.id, nextFollowUpAt: data.next_follow_up_at });
}

/** Archive (never delete). The lead and its history are kept. */
export async function archiveLead(ctx: ServiceContext, id: string): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("leads.write")) return noWrite();
  const { data, error } = await ctx.supabase.from("leads").update({ archived_at: new Date().toISOString() })
    .eq("organisation_id", ctx.organisationId).eq("id", id).is("archived_at", null).select("id").maybeSingle();
  if (error) {
    logServerError("leads.archive", error);
    return fail(toUserMessage(error, "We couldn't archive the lead."));
  }
  if (!data) return notFound();
  return ok({ id: data.id });
}

export async function restoreLead(ctx: ServiceContext, id: string): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("leads.write")) return noWrite();
  const { data, error } = await ctx.supabase.from("leads").update({ archived_at: null })
    .eq("organisation_id", ctx.organisationId).eq("id", id).select("id").maybeSingle();
  if (error) {
    logServerError("leads.restore", error);
    return fail(toUserMessage(error, "We couldn't restore the lead."));
  }
  if (!data) return notFound();
  return ok({ id: data.id });
}

export interface LeadDuplicateMatch { id: string; display_name: string; status: string; reason: string }

export type ConvertLeadResult =
  | { outcome: "created"; customerId: string; contactId: string | null }
  | { outcome: "linked"; customerId: string; contactId: string | null }
  | { outcome: "already_linked"; customerId: string }
  /** Nothing was created: likely existing customers. Link one (existingCustomerId) or retry with allowDuplicate. */
  | { outcome: "duplicates"; duplicates: LeadDuplicateMatch[] };

const rpcResult = z.object({
  customer_id: z.uuid().optional(),
  contact_id: z.uuid().nullable().optional(),
  created: z.boolean().optional(),
  already_linked: z.boolean().optional(),
  possible_duplicates: z.array(z.object({ id: z.uuid(), display_name: z.string(), status: z.string(), reason: z.string() }).loose()).optional(),
});

/** Parses convert_lead_to_customer's jsonb result. Exported for tests. */
export function parseConvertResult(raw: unknown, linkingExisting: boolean): ConvertLeadResult | null {
  const r = rpcResult.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  if (d.possible_duplicates && d.possible_duplicates.length > 0) {
    return { outcome: "duplicates", duplicates: d.possible_duplicates.map(({ id, display_name, status, reason }) => ({ id, display_name, status, reason })) };
  }
  if (!d.customer_id) return null;
  if (d.already_linked) return { outcome: "already_linked", customerId: d.customer_id };
  if (d.created) return { outcome: "created", customerId: d.customer_id, contactId: d.contact_id ?? null };
  return linkingExisting || d.created === false ? { outcome: "linked", customerId: d.customer_id, contactId: d.contact_id ?? null } : null;
}

/**
 * Turn a lead into a customer (atomic RPC). With existingCustomerId: link it. Otherwise create a customer,
 * unless likely duplicates exist — then nothing is created and the duplicates are returned for the user to choose.
 */
export async function convertLead(ctx: ServiceContext, leadId: string, input: ConvertLeadInput = {}): Promise<ActionResult<ConvertLeadResult>> {
  if (!ctx.permissions.can("leads.write")) return noWrite();
  const parsed = convertLeadSchema.safeParse(input);
  if (!parsed.success) return fail("Choose a valid customer.");
  const { existingCustomerId, allowDuplicate } = parsed.data;
  if (existingCustomerId && !ctx.permissions.can("customers.read")) return fail("You don't have permission to view customers.");
  if (!existingCustomerId && !ctx.permissions.can("customers.create")) return fail("You don't have permission to add customers.");

  const { data, error } = await ctx.supabase.rpc("convert_lead_to_customer", {
    p_lead_id: leadId,
    p_existing_customer_id: existingCustomerId ?? undefined,
    p_allow_duplicate: allowDuplicate,
  });
  if (error) {
    logServerError("leads.convert", error);
    return fail(toUserMessage(error, "We couldn't create the customer."));
  }
  const result = parseConvertResult(data, !!existingCustomerId);
  if (!result) {
    logServerError("leads.convert.shape", { message: "Unexpected convert_lead_to_customer result" });
    return fail("We couldn't create the customer.");
  }
  return ok(result);
}

export const createLeadTaskSchema = createTaskSchema.omit({ customerId: true });
export type CreateLeadTaskInput = Omit<CreateTaskInput, "customerId">;

/**
 * Task linked to a lead (related_entity_type 'lead', validated by validate_task_relation).
 * Separate from tasks/createTask because that service only links customers today.
 */
export async function createLeadTask(ctx: ServiceContext, leadId: string, input: CreateLeadTaskInput): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("tasks.create")) return fail("You don't have permission to create tasks.");
  if (!z.uuid().safeParse(leadId).success) return notFound();
  const parsed = createLeadTaskSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  if (v.assignedTo && v.assignedTo !== ctx.userId && !ctx.permissions.can("tasks.assign")) {
    return fail("You can only assign tasks to yourself.");
  }
  const { data, error } = await ctx.supabase
    .from("tasks")
    .insert({
      organisation_id: ctx.organisationId,
      title: v.title,
      description: v.description,
      priority: v.priority,
      due_at: v.dueAt,
      assigned_to: v.assignedTo,
      related_entity_type: "lead",
      related_entity_id: leadId,
    })
    .select("id")
    .single();
  if (error) {
    logServerError("leads.createTask", error);
    return fail(toUserMessage(error, "We couldn't create the task."));
  }
  return ok({ id: data.id });
}
