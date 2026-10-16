import { describe, expect, it } from "vitest";
import { createLeadSchema, listLeadsSchema, setLeadStatusSchema, updateLeadSchema, scheduleFollowUpSchema } from "@/domain/leads/schema";
import {
  deriveLeadTitle, followUpDueAt, followUpReason, followUpState, groupLeadsByStatus, leadDisplayName, moveTargets, whatsappLink,
} from "@/domain/leads/rules";
import { parseConvertResult, createLead, setLeadStatus, convertLead } from "@/domain/leads/service";
import { describeMessage, draftChannelFor, isUnread, logCommunicationSchema } from "@/domain/inbox/schema";
import { PermissionSet } from "@/lib/permissions";
import type { ServiceContext } from "@/domain/context";

const ctx = (perms: string[]) =>
  ({ supabase: {} as ServiceContext["supabase"], organisationId: "org-1", userId: "me", permissions: new PermissionSet(perms), actor: "user" }) as ServiceContext;

describe("lead schemas", () => {
  it("requires a person or company name", () => {
    const r = createLeadSchema.safeParse({ email: "a@b.co" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.personName?.[0]).toMatch(/person or company/);
    expect(createLeadSchema.safeParse({ companyName: "Oak Body Corp" }).success).toBe(true);
    expect(createLeadSchema.safeParse({ personName: "Thandi" }).success).toBe(true);
  });

  it("normalises empty optional fields to null and defaults source", () => {
    const v = createLeadSchema.parse({ personName: "Thandi", email: "", phone: "", estimatedValue: "", requestedDate: "", assignedTo: "" });
    expect(v).toMatchObject({ email: null, phone: null, estimatedValue: null, requestedDate: null, assignedTo: null, source: "manual" });
  });

  it("parses money as an exact decimal string", () => {
    expect(createLeadSchema.parse({ personName: "x", estimatedValue: "R 4 500.50" }).estimatedValue).toBe("4500.50");
    expect(createLeadSchema.parse({ personName: "x", estimatedValue: 1200 }).estimatedValue).toBe("1200");
    expect(createLeadSchema.safeParse({ personName: "x", estimatedValue: "12.345" }).success).toBe(false);
    expect(createLeadSchema.safeParse({ personName: "x", estimatedValue: "-5" }).success).toBe(false);
  });

  it("validates email, phone, source and date", () => {
    expect(createLeadSchema.safeParse({ personName: "x", email: "nope" }).success).toBe(false);
    expect(createLeadSchema.safeParse({ personName: "x", phone: "082 555 1234" }).success).toBe(true);
    expect(createLeadSchema.safeParse({ personName: "x", phone: "call me" }).success).toBe(false);
    expect(createLeadSchema.safeParse({ personName: "x", source: "fax" }).success).toBe(false);
    expect(createLeadSchema.safeParse({ personName: "x", requestedDate: "2026-10-20" }).success).toBe(true);
    expect(createLeadSchema.safeParse({ personName: "x", requestedDate: "20/10/2026" }).success).toBe(false);
  });

  it("update schema is partial", () => {
    expect(updateLeadSchema.safeParse({ notes: "hi" }).success).toBe(true);
  });

  it("lost needs a reason; other stages don't", () => {
    expect(setLeadStatusSchema.safeParse({ status: "lost" }).success).toBe(false);
    expect(setLeadStatusSchema.safeParse({ status: "lost", lostReason: "Too expensive" }).success).toBe(true);
    expect(setLeadStatusSchema.safeParse({ status: "qualified" }).success).toBe(true);
    expect(setLeadStatusSchema.safeParse({ status: "archived" }).success).toBe(false);
  });

  it("follow-up accepts an ISO datetime or null", () => {
    expect(scheduleFollowUpSchema.parse({ at: "2026-10-17T07:00:00.000Z" }).at).toBe("2026-10-17T07:00:00.000Z");
    expect(scheduleFollowUpSchema.parse({ at: null }).at).toBeNull();
    expect(scheduleFollowUpSchema.safeParse({ at: "tomorrow" }).success).toBe(false);
  });

  it("list filters parse URL values", () => {
    const f = listLeadsSchema.parse({ followUp: "1", archived: "", status: "active", page: "2" });
    expect(f).toMatchObject({ followUp: true, archived: false, status: "active", page: 2, assigned: "all", source: "all" });
    expect(listLeadsSchema.safeParse({ assigned: "someone" }).success).toBe(false);
  });
});

describe("follow-up rule (mirrors get_today_summary)", () => {
  const now = new Date("2026-10-16T10:00:00Z");
  const dayEnd = "2026-10-16T22:00:00Z"; // end of today in Africa/Johannesburg
  const base = { status: "contacted", next_follow_up_at: null, last_activity_at: "2026-10-16T08:00:00Z", archived_at: null };

  it("scheduled follow-up due today or overdue", () => {
    expect(followUpReason({ ...base, next_follow_up_at: "2026-10-16T15:00:00Z" }, now, dayEnd, 2)).toBe("scheduled");
    expect(followUpReason({ ...base, next_follow_up_at: "2026-10-10T15:00:00Z" }, now, dayEnd, 2)).toBe("scheduled");
    expect(followUpReason({ ...base, next_follow_up_at: "2026-10-17T07:00:00Z" }, now, dayEnd, 2)).toBeNull();
  });

  it("no scheduled follow-up: stale after N days of no activity", () => {
    expect(followUpReason({ ...base, last_activity_at: "2026-10-13T09:00:00Z" }, now, dayEnd, 2)).toBe("no_response");
    expect(followUpReason({ ...base, last_activity_at: "2026-10-15T09:00:00Z" }, now, dayEnd, 2)).toBeNull();
    // a scheduled future follow-up suppresses the stale rule
    expect(followUpReason({ ...base, last_activity_at: "2026-09-01T00:00:00Z", next_follow_up_at: "2026-10-20T07:00:00Z" }, now, dayEnd, 2)).toBeNull();
  });

  it("ignores closed, quote_sent and archived leads", () => {
    const stale = { ...base, last_activity_at: "2026-09-01T00:00:00Z" };
    for (const status of ["won", "lost", "quote_sent"]) expect(followUpReason({ ...stale, status }, now, dayEnd, 2)).toBeNull();
    expect(followUpReason({ ...stale, archived_at: "2026-10-01T00:00:00Z" }, now, dayEnd, 2)).toBeNull();
  });

  it("due-at and card state", () => {
    expect(followUpDueAt({ ...base, last_activity_at: "2026-10-13T09:00:00.000Z" }, 2)).toBe("2026-10-15T09:00:00.000Z");
    expect(followUpState("2026-10-16T09:00:00Z", now, dayEnd)).toBe("overdue");
    expect(followUpState("2026-10-16T15:00:00Z", now, dayEnd)).toBe("today");
    expect(followUpState("2026-10-18T15:00:00Z", now, dayEnd)).toBe("upcoming");
    expect(followUpState(null, now, dayEnd)).toBeNull();
  });
});

describe("pipeline helpers", () => {
  it("groups by status in pipeline order, keeping input order", () => {
    const g = groupLeadsByStatus([
      { id: "a", status: "won" }, { id: "b", status: "new" }, { id: "c", status: "new" }, { id: "d", status: "bogus" },
    ]);
    expect(Object.keys(g)).toEqual(["new", "contacted", "qualified", "quote_needed", "quote_sent", "won", "lost"]);
    expect(g.new.map((x) => x.id)).toEqual(["b", "c"]);
    expect(g.won.map((x) => x.id)).toEqual(["a"]);
    expect(Object.values(g).flat()).toHaveLength(3);
  });

  it("move targets exclude the current stage", () => {
    expect(moveTargets("new")).not.toContain("new");
    expect(moveTargets("new")).toHaveLength(6);
  });

  it("display name and derived title", () => {
    expect(leadDisplayName({ company_name: "Oak", person_name: "Thandi" })).toBe("Oak");
    expect(leadDisplayName({ person_name: "Thandi" })).toBe("Thandi");
    expect(leadDisplayName({ phone: "082" })).toBe("082");
    expect(deriveLeadTitle({ personName: "Thandi" })).toBe("Thandi");
    expect(deriveLeadTitle({ companyName: "Oak", serviceSummary: "Office clean\nthree floors" })).toBe("Oak – Office clean");
    expect(deriveLeadTitle({ personName: "T", serviceSummary: "x".repeat(100) }).length).toBeLessThanOrEqual(62);
    expect(deriveLeadTitle({ title: " Custom ", personName: "T" })).toBe("Custom");
  });

  it("WhatsApp link converts SA local numbers", () => {
    expect(whatsappLink("082 555 1234")).toBe("https://wa.me/27825551234");
    expect(whatsappLink("+27 82 555 1234", "Hi there")).toBe("https://wa.me/27825551234?text=Hi%20there");
    expect(whatsappLink("123")).toBeNull();
    expect(whatsappLink(null)).toBeNull();
  });
});

describe("convert_lead_to_customer result parsing", () => {
  const cust = "11111111-1111-4111-8111-111111111111";
  it("maps each RPC shape", () => {
    expect(parseConvertResult({ customer_id: cust, contact_id: null, created: true }, false)).toEqual({ outcome: "created", customerId: cust, contactId: null });
    expect(parseConvertResult({ customer_id: cust, contact_id: cust, created: false }, true)).toEqual({ outcome: "linked", customerId: cust, contactId: cust });
    expect(parseConvertResult({ customer_id: cust, created: false, already_linked: true }, false)).toEqual({ outcome: "already_linked", customerId: cust });
    expect(parseConvertResult({ created: false, possible_duplicates: [{ id: cust, display_name: "Oak", status: "active", reason: "Same email", score: 1 }] }, false))
      .toEqual({ outcome: "duplicates", duplicates: [{ id: cust, display_name: "Oak", status: "active", reason: "Same email" }] });
    expect(parseConvertResult("nonsense", false)).toBeNull();
  });
});

describe("lead service permission checks (fail before touching the DB)", () => {
  it("createLead / setLeadStatus need leads.write", async () => {
    expect((await createLead(ctx(["leads.read"]), { personName: "x" })).ok).toBe(false);
    expect((await setLeadStatus(ctx(["leads.read"]), "id", { status: "won" })).ok).toBe(false);
  });
  it("creating a customer needs customers.create", async () => {
    const r = await convertLead(ctx(["leads.write"]), "id", {});
    expect(r.ok).toBe(false);
  });
});

describe("inbox helpers", () => {
  it("unread compares last message with my last read", () => {
    expect(isUnread(null, null)).toBe(false);
    expect(isUnread("2026-10-16T10:00:00Z", null)).toBe(true);
    expect(isUnread("2026-10-16T10:00:00Z", "2026-10-16T09:00:00Z")).toBe(true);
    expect(isUnread("2026-10-16T10:00:00Z", "2026-10-16T10:00:00Z")).toBe(false);
  });
  it("drafts use the conversation channel, or the intended one for manual conversations", () => {
    expect(draftChannelFor("email")).toBe("email");
    expect(draftChannelFor("whatsapp", "email")).toBe("whatsapp");
    expect(draftChannelFor("manual")).toBe("whatsapp");
    expect(draftChannelFor("manual", "email")).toBe("email");
  });
  it("labels manual entries as logged", () => {
    expect(describeMessage({ kind: "call", direction: "outbound", channel: "manual", status: "logged" })).toBe("Call · To customer · Logged");
    expect(describeMessage({ kind: "message", direction: "outbound", channel: "whatsapp", status: "draft" })).toBe("Message · WhatsApp · To customer · Draft — not sent");
  });
  it("log schema requires a body and rejects future times", () => {
    expect(logCommunicationSchema.safeParse({ body: " " }).success).toBe(false);
    expect(logCommunicationSchema.safeParse({ body: "Called", kind: "event" }).success).toBe(false);
    expect(logCommunicationSchema.safeParse({ body: "Called", occurredAt: new Date(Date.now() + 86_400_000).toISOString() }).success).toBe(false);
    expect(logCommunicationSchema.parse({ body: "Called" })).toMatchObject({ kind: "note", direction: "internal", leadId: null });
  });
});
