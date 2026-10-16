"use server";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { fail, logServerError, ok, type ActionResult } from "@/lib/errors";
import { generate } from "@/lib/ai/gateway/capabilities";
import { blockedMessage, UNAVAILABLE_MESSAGE } from "@/lib/ai/orchestrator";
import { briefingPayload, buildAttentionItems, getTodaySummary, usesOnlyGivenNumbers } from "@/domain/today/service";

const INSTRUCTIONS = [
  "You write a short morning briefing for the owner of a small South African service business.",
  "You receive a JSON list of items that need attention, already ordered from most to least urgent.",
  "Write 2-3 plain sentences that say what to do first and why. Use only the items given.",
  "Never calculate, total, round or change any number or amount: copy every figure exactly as written in the items.",
  "Do not invent customers, dates or numbers. No greetings, no markdown, no bullet points.",
].join(" ");

/**
 * "Summarise with AI". The server recomputes the deterministic items itself (nothing from
 * the client is trusted) and sends ONLY severity + pre-formatted headlines — no ids,
 * customer names, emails or phones. If the AI text contains any number not present in
 * the input it is discarded.
 */
export async function summariseTodayAction(): Promise<ActionResult<{ text: string; generatedAt: string }>> {
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  if (!ctx.permissions.can("ai.use")) return fail(blockedMessage("not_permitted"));

  const summary = await getTodaySummary(ctx);
  if (!summary.ok) return summary;
  const items = buildAttentionItems(summary.data, {
    currency: app.organisation.currency,
    jobsScope: ctx.permissions.can("jobs.read_all") ? "all" : "assigned",
  });
  if (items.length === 0) return ok({ text: "Nothing needs your attention right now.", generatedAt: new Date().toISOString() });

  const input = JSON.stringify({ items: briefingPayload(items) });
  const r = await generate(
    { organisationId: ctx.organisationId, userId: ctx.userId, category: "generate.today_briefing" },
    { instructions: INSTRUCTIONS, input },
  );
  if (!r.ok) {
    if (r.code === "blocked") return fail(blockedMessage(r.reason));
    if (r.code !== "invalid_output") logServerError("today.briefing", new Error(`${r.code}: ${r.reason}`));
    return fail(UNAVAILABLE_MESSAGE);
  }
  const text = r.data.replace(/\s+/g, " ").trim().slice(0, 800);
  if (!usesOnlyGivenNumbers(text, input)) {
    logServerError("today.briefing.numbers", new Error("AI briefing contained numbers not present in the input"));
    return fail("The AI summary didn't match your figures, so we're not showing it. The summary above is accurate.");
  }
  return ok({ text, generatedAt: new Date().toISOString() });
}
