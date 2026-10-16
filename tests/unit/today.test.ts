import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/money";
import {
  actionableItems, briefingPayload, buildAttentionItems, buildBriefingSentence, buildKpis, parseTodaySummary, usesOnlyGivenNumbers,
  type TodaySummary,
} from "@/domain/today/service";
import { dayLabel, daysBetween, localDateInZone } from "@/domain/today/format";

const R = (n: string) => formatMoney(n, "ZAR");
const TZ = "Africa/Johannesburg";

/** Full payload as an owner would receive it from today_summary. */
const FULL = {
  today: "2026-10-16",
  timezone: TZ,
  money_outstanding: 12500.5,
  overdue_invoices_count: 2,
  overdue_amount: 3200,
  due_soon_count: 1,
  overdue_invoices: [
    { id: "i1", invoice_number: "INV-0002", customer_name: "Acme Cleaning", amount_due: 2000, due_date: "2026-10-01", days_overdue: 15 },
    { id: "i2", invoice_number: "INV-0005", customer_name: "Bongi M", amount_due: 1200, due_date: "2026-10-10", days_overdue: 6 },
  ],
  new_leads_count: 3,
  leads_followup: [{ id: "l1", title: "Office clean", name: "Sipho", status: "contacted", source: "phone", due_at: "2026-10-15T08:00:00Z", reason: "no_response" }],
  leads_followup_count: 1,
  quotes_followup: [{ id: "q1", quote_number: "Q-0003", customer_name: "Acme Cleaning", total: 4500, issued_at: "2026-10-12T08:00:00Z", days_waiting: 4, expiry_date: null }],
  quotes_followup_count: 1,
  quotes_expiring_count: 0,
  jobs_today: [
    { id: "j1", job_number: "J-0004", title: "Deep clean", status: "scheduled", scheduled_start: "2026-10-16T07:00:00Z", scheduled_end: null, team_size: 2 },
  ],
  jobs_in_progress_count: 0,
  unassigned_upcoming: [{ id: "j7", job_number: "J-0007", title: "Pest spray", scheduled_start: "2026-10-17T06:00:00Z" }],
  unscheduled_count: 0,
  completed_not_invoiced_count: 2,
  tasks_overdue_count: 0,
  tasks_due_today_count: 2,
  conversations_attention_count: 0,
};

const full = () => parseTodaySummary(FULL) as TodaySummary;

describe("parseTodaySummary", () => {
  it("parses the full payload into sections", () => {
    const s = full();
    expect(s.money?.outstanding).toBe(12500.5);
    expect(s.money?.overdueInvoices).toHaveLength(2);
    expect(s.leads?.newCount).toBe(3);
    expect(s.quotes?.followup[0]?.quote_number).toBe("Q-0003");
    expect(s.jobs?.today).toHaveLength(1);
    expect(s.jobs?.completedNotInvoicedCount).toBe(2);
    expect(s.tasks).toEqual({ overdueCount: 0, dueTodayCount: 2 });
    expect(s.inbox?.attentionCount).toBe(0);
  });

  it("leaves sections out when the user lacks the permission (field agent payload)", () => {
    const s = parseTodaySummary({
      today: "2026-10-16",
      timezone: TZ,
      jobs_today: [],
      jobs_in_progress_count: 0,
      unassigned_upcoming: [],
      unscheduled_count: 0,
      completed_not_invoiced_count: null,
      tasks_overdue_count: 1,
      tasks_due_today_count: 0,
    });
    expect(s).not.toBeNull();
    expect(s!.money).toBeUndefined();
    expect(s!.leads).toBeUndefined();
    expect(s!.quotes).toBeUndefined();
    expect(s!.inbox).toBeUndefined();
    expect(s!.jobs?.completedNotInvoicedCount).toBeNull();
    expect(s!.tasks.overdueCount).toBe(1);
  });

  it("coerces stringified numbers and defaults missing task counts", () => {
    const s = parseTodaySummary({ today: "2026-10-16", timezone: TZ, money_outstanding: "10.50", overdue_invoices_count: "1", overdue_amount: "10.50" });
    expect(s!.money?.outstanding).toBe(10.5);
    expect(s!.money?.overdueCount).toBe(1);
    expect(s!.money?.overdueInvoices).toEqual([]);
    expect(s!.tasks).toEqual({ overdueCount: 0, dueTodayCount: 0 });
  });

  it("rejects unusable payloads", () => {
    expect(parseTodaySummary(null)).toBeNull();
    expect(parseTodaySummary({ timezone: TZ })).toBeNull();
    expect(parseTodaySummary({ today: "2026-10-16", timezone: TZ, overdue_invoices: [{ id: 1 }] })).toBeNull();
  });
});

describe("buildAttentionItems", () => {
  it("orders by severity, then by fixed priority", () => {
    const items = buildAttentionItems(full(), { currency: "ZAR" });
    expect(items.map((i) => i.key)).toEqual([
      "overdue_invoices",
      "unassigned_jobs",
      "quotes_followup",
      "new_leads",
      "leads_followup",
      "completed_not_invoiced",
      "jobs_today",
      "tasks_due_today",
      "invoices_due_soon",
    ]);
    expect(items[0]!.severity).toBe("danger");
    expect(items.filter((i) => i.severity === "info").map((i) => i.key)).toEqual(["jobs_today", "tasks_due_today", "invoices_due_soon"]);
  });

  it("is deterministic", () => {
    expect(buildAttentionItems(full(), { currency: "ZAR" })).toEqual(buildAttentionItems(full(), { currency: "ZAR" }));
  });

  it("uses plain language with pre-formatted money and direct links", () => {
    const items = buildAttentionItems(full(), { currency: "ZAR" });
    const by = (k: string) => items.find((i) => i.key === k)!;
    expect(by("overdue_invoices").title).toBe(`2 invoices are overdue (${R("3200.00")})`);
    expect(by("overdue_invoices").detail).toBe("Oldest: INV-0002 for Acme Cleaning, 15 days overdue");
    expect(by("overdue_invoices").href).toBe("/app/money/invoices?status=overdue");
    expect(by("quotes_followup").title).toBe("Quote Q-0003 has been waiting 4 days for a reply");
    expect(by("quotes_followup").href).toBe("/app/sales/quotes?status=sent");
    expect(by("unassigned_jobs").title).toBe("Job J-0007 (tomorrow) has no team assigned");
    expect(by("unassigned_jobs").href).toBe("/app/work/jobs/j7");
    expect(by("completed_not_invoiced").title).toBe("2 completed jobs haven't been invoiced");
    expect(by("completed_not_invoiced").href).toBe("/app/work/jobs?status=completed");
    expect(by("new_leads").title).toBe("3 new leads haven't been contacted yet");
    expect(by("leads_followup").title).toBe("1 lead needs a follow-up");
    expect(by("jobs_today").href).toBe("/app/work/calendar?view=day");
  });

  it("singular wording", () => {
    const s = full();
    s.money!.overdueCount = 1;
    s.money!.overdueAmount = 4500;
    const i = buildAttentionItems(s, { currency: "ZAR" })[0]!;
    expect(i.title).toBe(`1 invoice is overdue (${R("4500.00")})`);
    expect(i.phrase).toBe(`1 overdue invoice (${R("4500.00")})`);
  });

  it("omits zero counts and missing sections", () => {
    const s = parseTodaySummary({ today: "2026-10-16", timezone: TZ, tasks_overdue_count: 0, tasks_due_today_count: 0 })!;
    expect(buildAttentionItems(s, { currency: "ZAR" })).toEqual([]);
  });

  it("drops scheduling/invoicing items for field agents (assigned scope)", () => {
    const keys = buildAttentionItems(full(), { currency: "ZAR", jobsScope: "assigned" }).map((i) => i.key);
    expect(keys).not.toContain("unassigned_jobs");
    expect(keys).not.toContain("completed_not_invoiced");
    expect(keys).not.toContain("unscheduled_jobs");
  });

  it("includes inbox, overdue tasks and unscheduled when present", () => {
    const s = full();
    s.inbox = { attentionCount: 2 };
    s.tasks.overdueCount = 3;
    s.jobs!.unscheduledCount = 1;
    const items = buildAttentionItems(s, { currency: "ZAR" });
    expect(items[1]).toMatchObject({ key: "overdue_tasks", severity: "danger", title: "3 tasks are overdue", href: "/app/work/tasks" });
    expect(items.find((i) => i.key === "conversations_attention")).toMatchObject({ href: "/app/inbox?filter=attention", title: "2 conversations need your attention" });
    expect(items.find((i) => i.key === "unscheduled_jobs")?.title).toBe("1 job still needs a date");
  });
});

describe("buildBriefingSentence", () => {
  it("names the top three actionable items in priority order", () => {
    const s = full();
    s.leads = undefined;
    s.jobs!.completedNotInvoicedCount = 0;
    const sentence = buildBriefingSentence(buildAttentionItems(s, { currency: "ZAR" }));
    expect(sentence).toBe(
      `Three things need your attention: 2 overdue invoices (${R("3200.00")}), tomorrow's job J-0007 has no team and 1 quote waiting 4 days for a reply. ` +
        "On the schedule: 1 job today and 2 tasks due today.",
    );
  });

  it("mentions how many more when there are more than three", () => {
    const sentence = buildBriefingSentence(buildAttentionItems(full(), { currency: "ZAR" }));
    expect(sentence.startsWith("Six things need your attention: ")).toBe(true);
    expect(sentence).toContain("plus 3 more items below.");
  });

  it("is honest when everything is clear", () => {
    expect(buildBriefingSentence([])).toBe("Nothing needs your attention right now.");
    const s = parseTodaySummary({ today: "2026-10-16", timezone: TZ, tasks_due_today_count: 1 })!;
    expect(buildBriefingSentence(buildAttentionItems(s, { currency: "ZAR" }))).toBe("Nothing needs your attention right now. On the schedule: 1 task due today.");
  });

  it("one item", () => {
    const s = parseTodaySummary({ today: "2026-10-16", timezone: TZ, tasks_overdue_count: 1 })!;
    expect(buildBriefingSentence(buildAttentionItems(s, { currency: "ZAR" }))).toBe("One thing needs your attention: 1 overdue task.");
  });
});

describe("AI briefing guards", () => {
  it("payload carries no ids, customer names or details", () => {
    const items = buildAttentionItems(full(), { currency: "ZAR" });
    const json = JSON.stringify(briefingPayload(items));
    expect(json).not.toContain("Acme");
    expect(json).not.toContain("Sipho");
    expect(json).not.toContain("j7");
    expect(json).not.toContain("/app/");
    expect(briefingPayload(items)[0]).toEqual({ severity: "danger", headline: items[0]!.title, phrase: items[0]!.phrase });
  });

  it("accepts AI text that only reuses given numbers, rejects invented ones", () => {
    const input = JSON.stringify(briefingPayload(buildAttentionItems(full(), { currency: "ZAR" })));
    expect(usesOnlyGivenNumbers(`Chase the 2 overdue invoices (${R("3200.00")}) first, then quote Q-0003.`, input)).toBe(true);
    expect(usesOnlyGivenNumbers("Chase the overdue invoices first.", input)).toBe(true);
    expect(usesOnlyGivenNumbers(`You are owed ${R("7700.00")} in total.`, input)).toBe(false);
    expect(usesOnlyGivenNumbers("17 things need attention.", input)).toBe(false);
  });

  it("actionableItems excludes info", () => {
    expect(actionableItems(buildAttentionItems(full(), { currency: "ZAR" })).every((i) => i.severity !== "info")).toBe(true);
  });
});

describe("buildKpis", () => {
  it("shows only tiles for sections present", () => {
    expect(buildKpis(full(), { currency: "ZAR" }).map((k) => k.key)).toEqual([
      "money_outstanding", "overdue_invoices", "new_leads", "quotes_followup", "jobs_today", "tasks_due",
    ]);
    const agent = parseTodaySummary({ today: "2026-10-16", timezone: TZ, jobs_today: [], tasks_due_today_count: 1 })!;
    expect(buildKpis(agent, { currency: "ZAR" }).map((k) => k.key)).toEqual(["jobs_today", "tasks_due"]);
  });

  it("formats money from SQL values and links to filtered lists", () => {
    const k = buildKpis(full(), { currency: "ZAR" });
    expect(k[0]).toMatchObject({ value: R("12500.50"), href: "/app/money/invoices?status=issued" });
    expect(k[1]).toMatchObject({ value: "2", hint: R("3200.00"), tone: "danger", href: "/app/money/invoices?status=overdue" });
  });
});

describe("date helpers", () => {
  it("local date and relative day labels respect the org timezone", () => {
    expect(localDateInZone(new Date("2026-10-16T22:30:00Z"), TZ)).toBe("2026-10-17");
    expect(daysBetween("2026-10-16", "2026-10-18")).toBe(2);
    expect(dayLabel("2026-10-16T09:00:00Z", "2026-10-16", TZ)).toBe("today");
    expect(dayLabel("2026-10-17T09:00:00Z", "2026-10-16", TZ)).toBe("tomorrow");
    expect(dayLabel("2026-10-19T09:00:00Z", "2026-10-16", TZ)).toBe("Monday");
  });
});
