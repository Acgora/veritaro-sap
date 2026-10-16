import { fail, logServerError, ok, toUserMessage, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import { parseTodaySummary, type TodaySummary } from "./schema";

export { parseTodaySummary, type TodaySummary } from "./schema";
export {
  actionableItems, briefingPayload, buildAttentionItems, buildBriefingSentence, buildKpis, usesOnlyGivenNumbers,
  type AttentionItem, type AttentionKey, type AttentionOptions, type AttentionSeverity, type TodayKpi,
} from "./attention";

/** Deterministic Today summary (SQL decides; sections appear only with permission). */
export async function getTodaySummary(ctx: ServiceContext): Promise<ActionResult<TodaySummary>> {
  const { data, error } = await ctx.supabase.rpc("today_summary", { p_organisation_id: ctx.organisationId });
  if (error) {
    logServerError("today.summary", error);
    return fail(toUserMessage(error, "We couldn't load today's summary."));
  }
  const parsed = parseTodaySummary(data);
  if (!parsed) {
    logServerError("today.summary.parse", new Error("today_summary payload did not match schema"));
    return fail("We couldn't load today's summary.");
  }
  return ok(parsed);
}

export interface MyJob {
  id: string;
  jobNumber: string;
  title: string;
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  customerName: string | null;
  siteAddress: string | null;
}

/**
 * The signed-in person's own assigned jobs between two instants (field agents).
 * Note: list_my_jobs also returns UNSCHEDULED assigned jobs (scheduled_start is null)
 * regardless of the range — callers split them out.
 */
export async function listMyJobs(ctx: ServiceContext, from: string, to: string): Promise<ActionResult<MyJob[]>> {
  if (!ctx.permissions.can("jobs.read_assigned") && !ctx.permissions.can("jobs.read_all")) return ok([]);
  const { data, error } = await ctx.supabase.rpc("list_my_jobs", { p_organisation_id: ctx.organisationId, p_from: from, p_to: to });
  if (error) {
    logServerError("today.myJobs", error);
    return fail(toUserMessage(error, "We couldn't load your jobs."));
  }
  return ok(
    (data ?? []).map((j) => ({
      id: j.id,
      jobNumber: j.job_number,
      title: j.title,
      status: j.status,
      scheduledStart: j.scheduled_start ?? null,
      scheduledEnd: j.scheduled_end ?? null,
      customerName: j.customer_name ?? null,
      siteAddress: j.site_address ?? null,
    })),
  );
}
