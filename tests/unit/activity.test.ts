import { describe, expect, it } from "vitest";
import { describeActivity } from "@/domain/activity/describe";
import { formatMoney } from "@/lib/money";

const user = { actorType: "user", actorName: "Sam" } as const;
const ai = { actorType: "ai", actorName: "Sam" } as const;
const system = { actorType: "system", actorName: null } as const;

describe("describeActivity — Phase 003 lifecycle", () => {
  it("quotes", () => {
    expect(describeActivity({ ...user, action: "quote_accepted", metadata: { quote_number: "Q-0003" } })).toBe("Quote Q-0003 accepted by Sam");
    expect(describeActivity({ ...user, action: "quote_issued", metadata: { quote_number: "Q-0003" } })).toBe("Quote Q-0003 sent by Sam");
    expect(describeActivity({ ...system, action: "quote_expired", metadata: { quote_number: "Q-0003" } })).toBe("Quote Q-0003 expired");
  });

  it("payments with formatted money", () => {
    expect(describeActivity({ ...user, action: "payment_recorded", metadata: { invoice_number: "INV-0002", amount: 1900 } }))
      .toBe(`Payment of ${formatMoney("1900.00", "ZAR")} recorded against INV-0002 by Sam`);
    expect(describeActivity({ ...user, action: "payment_voided", metadata: { invoice_number: "INV-0002", amount: "250.5" } }, { currency: "ZAR" }))
      .toBe(`Payment of ${formatMoney("250.50", "ZAR")} on INV-0002 voided by Sam`);
  });

  it("jobs", () => {
    expect(describeActivity({ ...user, action: "job_completed", metadata: { job_number: "J-0004" } })).toBe("Job J-0004 completed by Sam");
    expect(describeActivity({ ...user, action: "job_scheduled", metadata: { job_number: "J-0004", start: "x", previous: "y" } })).toBe("Job J-0004 rescheduled by Sam");
    expect(describeActivity({ ...user, action: "job_assigned", metadata: { job_number: "J-0004" } })).toBe("Team member assigned to job J-0004 by Sam");
  });

  it("invoices", () => {
    expect(describeActivity({ ...user, action: "invoice_created", metadata: { invoice_number: null, job_id: "j" } })).toBe("Draft invoice created from a job by Sam");
    expect(describeActivity({ ...user, action: "invoice_issued", metadata: { invoice_number: "INV-0002" } })).toBe("Invoice INV-0002 issued by Sam");
    expect(describeActivity({ ...user, action: "invoice_status_changed", metadata: { invoice_number: "INV-0002", to: "partially_paid" } })).toBe("Invoice INV-0002 is now part paid");
    expect(describeActivity({ ...user, action: "invoice_paid", metadata: { invoice_number: "INV-0002" } })).toBe("Invoice INV-0002 paid in full");
  });

  it("leads and communication", () => {
    expect(describeActivity({ ...user, action: "lead_converted", metadata: {} })).toBe("Lead converted to customer by Sam");
    expect(describeActivity({ ...user, action: "lead_converted", metadata: { title: "Office clean" } })).toBe("Lead “Office clean” converted to customer by Sam");
    expect(describeActivity({ ...user, action: "lead_status_changed", metadata: { title: "Office clean", to: "quote_needed" } })).toBe("Lead “Office clean” moved to Quote needed by Sam");
    expect(describeActivity({ ...user, action: "communication_logged", metadata: { kind: "mystery" } })).toBe("Communication logged by Sam");
    expect(describeActivity({ ...user, action: "communication_logged", metadata: { kind: "call" } })).toBe("Call logged by Sam");
  });

  it("AI attribution", () => {
    expect(describeActivity({ ...ai, action: "quote_created", metadata: { quote_number: "Q-0009" } })).toBe("Quote Q-0009 created by AI on behalf of Sam");
    expect(describeActivity({ actorType: "ai", actorName: null, action: "job_created", metadata: { job_number: "J-0001" } })).toBe("Job J-0001 created by AI");
    // Phase 001/002 sentences unchanged
    expect(describeActivity({ actorType: "ai", actorName: null, action: "task_created", metadata: {} })).toBe("The assistant created task a task");
  });
});
