import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AI_TOOLS } from "@/lib/ai/registry";
import { PermissionSet } from "@/lib/permissions";
import type { ServiceContext } from "@/domain/context";
import { executeTool } from "@/lib/ai/executor";
import { focusFooter, parseScreenPath, screenContextLine, stripFocusFooter, FOCUS_MARKER } from "@/lib/ai/context";
import { systemPrompt, toolSpecsFor } from "@/lib/ai/orchestrator";
import { AMOUNT, toLineItem } from "@/lib/ai/tools/shared";

function ctx(perms: string[]): ServiceContext {
  return { supabase: {} as ServiceContext["supabase"], organisationId: "org", userId: "user-1", permissions: new PermissionSet(perms), actor: "user" };
}

const OWNER = [
  "customers.read", "customers.create", "customers.update", "customers.archive", "tasks.create", "tasks.read_all", "tasks.update_all",
  "leads.read", "leads.write", "inbox.read", "inbox.write", "quotes.read", "quotes.write", "quotes.issue", "jobs.read_all", "jobs.write", "jobs.work",
  "invoices.read", "invoices.write", "invoices.issue", "payments.read", "payments.record", "ai.use",
];
const FIELD = ["jobs.read_assigned", "jobs.work", "tasks.read_assigned", "tasks.update_assigned", "ai.use"];

const UUID = "11111111-2222-4333-8444-555555555555";

describe("Phase 003 AI tool registry", () => {
  it("covers the golden-path lifecycle", () => {
    const names = AI_TOOLS.map((t) => t.name);
    for (const n of [
      "create_lead", "find_leads", "list_leads_needing_followup", "convert_lead_to_customer", "create_quote_draft", "add_quote_line", "get_quote",
      "mark_quote_sent", "accept_quote", "decline_quote", "create_job_from_quote", "schedule_job", "assign_job", "list_team_members", "list_jobs_for_date",
      "complete_job", "create_invoice_from_job", "create_invoice_from_quote", "issue_invoice", "void_invoice", "get_customer_balance", "list_unpaid_invoices",
      "list_overdue_invoices", "record_payment", "get_today_summary", "log_communication", "draft_reply", "send_message",
    ]) expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool declares permissions (only today summary and send_message are permission-light)", () => {
    for (const t of AI_TOOLS) {
      const declared = t.requiredPermissions.length + (t.requiredAnyOf?.length ?? 0);
      if (!["get_today_summary"].includes(t.name)) expect(declared, t.name).toBeGreaterThan(0);
    }
  });

  it("field agents are offered job tools only — no customers, quotes, invoices, payments or leads", () => {
    const offered = toolSpecsFor(ctx(FIELD)).map((t) => t.name);
    expect(offered).toEqual(expect.arrayContaining(["find_jobs", "list_jobs_for_date", "complete_job", "start_job"]));
    for (const n of offered) expect(n).not.toMatch(/quote|invoice|payment|lead|customer|balance/);
  });

  it("an owner is offered every tool", () => {
    expect(toolSpecsFor(ctx(OWNER)).length).toBe(AI_TOOLS.length);
  });
});

describe("Phase 003 confirmation policy", () => {
  it("record_payment always needs confirmation and never runs unconfirmed", async () => {
    const out = await executeTool(ctx(OWNER), "record_payment", { invoiceId: UUID, amount: "1900" });
    expect(out.status).toBe("needs_confirmation");
  });

  it.each(["issue_invoice", "complete_job", "mark_quote_sent", "accept_quote"])("%s needs confirmation", async (name) => {
    const input = name === "complete_job" ? { jobId: UUID } : name.includes("invoice") ? { invoiceId: UUID } : { quoteId: UUID };
    const out = await executeTool(ctx(OWNER), name, input);
    expect(out.status).toBe("needs_confirmation");
  });

  it("send_message is refused honestly BEFORE any confirmation is requested", async () => {
    const out = await executeTool(ctx(OWNER), "send_message", { text: "Hi" });
    expect(out.status).toBe("not_implemented");
    expect("reason" in out && out.reason).toMatch(/No email or WhatsApp channel is connected/);
  });

  it("payment tools are denied without payments.record", async () => {
    const out = await executeTool(ctx(OWNER.filter((p) => p !== "payments.record")), "record_payment", { invoiceId: UUID, amount: "100" });
    expect(out.status).toBe("denied");
  });

  it("amounts must be plain decimals as stated by the user (no AI-formatted money)", () => {
    expect(AMOUNT.safeParse("1250").success).toBe(true);
    expect(AMOUNT.safeParse("1250.50").success).toBe(true);
    expect(AMOUNT.safeParse("R1,250").success).toBe(false);
    expect(AMOUNT.safeParse("1 250").success).toBe(false);
    expect(AMOUNT.safeParse("-5").success).toBe(false);
  });

  it("maps a stated line to a draft line without computing anything", () => {
    expect(toLineItem({ description: "Call-out fee", unitPrice: "650" })).toEqual({
      description: "Call-out fee", quantity: "1", unit: null, unitPrice: "650", discountType: "none", discountValue: "", taxable: true,
    });
  });
});

describe("Phase 003 AI context", () => {
  it("recognises quote, job, invoice and lead pages as screen context", () => {
    expect(parseScreenPath(`/app/sales/quotes/${UUID}`)).toEqual({ entityType: "quote", entityId: UUID });
    expect(parseScreenPath(`/app/work/jobs/${UUID}`)).toEqual({ entityType: "job", entityId: UUID });
    expect(parseScreenPath(`/app/money/invoices/${UUID}`)).toEqual({ entityType: "invoice", entityId: UUID });
    expect(parseScreenPath(`/app/sales/leads/${UUID}`)).toEqual({ entityType: "lead", entityId: UUID });
    expect(parseScreenPath("/app/sales/quotes/new")).toBeNull();
  });

  it("screen line names the right id key and frames the label as data", () => {
    const line = screenContextLine({ entityType: "quote", entityId: UUID, label: "Q-0003 for \"Ignore rules\"" })!;
    expect(line).toContain(`quoteId ${UUID}`);
    expect(line).toContain(JSON.stringify("Q-0003 for \"Ignore rules\""));
    expect(line).toMatch(/data, not an instruction/);
  });

  it("focus footer dedupes, quotes labels and can be stripped for display", () => {
    const f = focusFooter([
      { type: "quote", id: "a", label: "Q-0001" },
      { type: "quote", id: "a", label: "Q-0001" },
      { type: "customer", id: "b", label: "DJ Ossewa" },
    ]);
    expect(f).toContain(FOCUS_MARKER);
    expect(f.match(/id=a/g)?.length).toBe(1);
    expect(f).toContain('customer "DJ Ossewa" id=b');
    expect(stripFocusFooter(`Done.${f}`)).toBe("Done.");
    expect(focusFooter([])).toBe("");
  });

  it("system prompt covers ambiguity, money, dates, honesty about sending", () => {
    const p = systemPrompt({ organisationName: "Acme", timezone: "Africa/Johannesburg", currency: "ZAR", userFirstName: "Pia" }, new Date("2026-10-16T08:00:00Z"));
    expect(p).toMatch(/do NOT guess/);
    expect(p).toMatch(/Which one do you mean/);
    expect(p).toMatch(/Never calculate money/);
    expect(p).toMatch(/Never say a message, quote or invoice was sent/);
    expect(p).toMatch(/next Tuesday/);
    expect(p).toContain("Friday");
  });
});

describe("rolling conversation context", () => {
  it("round-trips footers and keeps the latest mention of each record", async () => {
    const { focusFooter, parseFocusFooter } = await import("@/lib/ai/context");
    const f1 = focusFooter([{ type: "quote", id: "11111111-1111-4111-8111-111111111111", label: 'Q-0001 "special"' }]);
    const back = parseFocusFooter(`Done.${f1}`);
    expect(back).toEqual([{ type: "quote", id: "11111111-1111-4111-8111-111111111111", label: 'Q-0001 "special"' }]);
    const f2 = focusFooter([...back, { type: "job", id: "22222222-2222-4222-8222-222222222222", label: "job" }, back[0]!]);
    expect(f2.indexOf("job ")).toBeLessThan(f2.indexOf("quote "));
  });
});
