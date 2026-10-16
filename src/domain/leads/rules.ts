import { LEAD_STATUSES, type LeadStatus } from "@/lib/status";
import { OPEN_LEAD_STATUSES } from "./schema";

/**
 * Pure lead rules — no I/O, safe in client components, unit-tested.
 * The follow-up rule mirrors public.get_today_summary() (migration 20261016000700) exactly,
 * so the Today screen, the pipeline and AI tools agree on which leads need attention.
 */

export interface FollowUpFields {
  status: string;
  next_follow_up_at: string | null;
  last_activity_at: string;
  archived_at?: string | null;
}

export type FollowUpReason = "scheduled" | "no_response";

/**
 * A lead needs follow-up when it is open (new/contacted/qualified/quote_needed), not archived, and either
 *   - a follow-up is scheduled before the end of today (org timezone) — reason "scheduled", or
 *   - none is scheduled and nothing has happened for `followupDays` days — reason "no_response".
 */
export function followUpReason(lead: FollowUpFields, now: Date, dayEndIso: string, followupDays: number): FollowUpReason | null {
  if (lead.archived_at) return null;
  if (!(OPEN_LEAD_STATUSES as readonly string[]).includes(lead.status)) return null;
  if (lead.next_follow_up_at) {
    return new Date(lead.next_follow_up_at).getTime() < new Date(dayEndIso).getTime() ? "scheduled" : null;
  }
  const cutoff = now.getTime() - followupDays * 86_400_000;
  return new Date(lead.last_activity_at).getTime() < cutoff ? "no_response" : null;
}

/** When the follow-up is due: the scheduled time, or last activity + N days. */
export function followUpDueAt(lead: FollowUpFields, followupDays: number): string {
  if (lead.next_follow_up_at) return lead.next_follow_up_at;
  return new Date(new Date(lead.last_activity_at).getTime() + followupDays * 86_400_000).toISOString();
}

export type FollowUpState = "overdue" | "today" | "upcoming";

/** For highlighting a scheduled follow-up on cards: overdue (past), today, or upcoming. */
export function followUpState(nextFollowUpAt: string | null, now: Date, dayEndIso: string): FollowUpState | null {
  if (!nextFollowUpAt) return null;
  const t = new Date(nextFollowUpAt).getTime();
  if (t < now.getTime()) return "overdue";
  if (t < new Date(dayEndIso).getTime()) return "today";
  return "upcoming";
}

/** Groups leads into pipeline columns, in pipeline order, preserving input order inside each column. */
export function groupLeadsByStatus<T extends { status: string }>(leads: readonly T[]): Record<LeadStatus, T[]> {
  const out = Object.fromEntries(LEAD_STATUSES.map((s) => [s, [] as T[]])) as Record<LeadStatus, T[]>;
  for (const l of leads) {
    if ((LEAD_STATUSES as readonly string[]).includes(l.status)) out[l.status as LeadStatus].push(l);
  }
  return out;
}

export interface LeadIdentity {
  title?: string | null;
  person_name?: string | null;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Best human name for a lead: company, then person, then contact details, then title. */
export function leadDisplayName(l: LeadIdentity): string {
  return l.company_name || l.person_name || l.email || l.phone || l.title || "Unnamed lead";
}

/** Secondary line: the person at a company (when both are known). */
export function leadSubName(l: LeadIdentity): string | null {
  return l.company_name && l.person_name ? l.person_name : null;
}

/** Title stored on the lead (used by search, activity and AI). Name, plus a short service hint. */
export function deriveLeadTitle(v: { title?: string | null; personName?: string | null; companyName?: string | null; serviceSummary?: string | null; email?: string | null; phone?: string | null }): string {
  if (v.title && v.title.trim()) return v.title.trim().slice(0, 200);
  const name = (v.companyName || v.personName || v.email || v.phone || "New lead").trim();
  const service = v.serviceSummary?.trim().split(/\r?\n/)[0];
  if (!service) return name.slice(0, 200);
  const short = service.length > 60 ? `${service.slice(0, 57).trimEnd()}…` : service;
  return `${name} – ${short}`.slice(0, 200);
}

/** Pipeline statuses a lead can be moved to from its current one (everything else, for flexibility). */
export function moveTargets(current: string): LeadStatus[] {
  return LEAD_STATUSES.filter((s) => s !== current);
}

/** Phone → wa.me link (SA local numbers converted to +27). Same rule as the customers list. */
export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) digits = `27${digits.slice(1)}`;
  if (digits.length < 9) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
