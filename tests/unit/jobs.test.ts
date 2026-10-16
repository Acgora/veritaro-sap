import { describe, expect, it } from "vitest";
import {
  assignMembersSchema, createJobFromQuoteSchema, createJobSchema, displayJobStatus, jobNoteSchema, jobPhotoSchema, jobStatusSchema,
  listJobsSchema, sanitiseJobSearch, scheduleJobSchema,
} from "@/domain/jobs/schema";
import {
  addDays, addMonths, dayBoundsForDate, findOverlaps, intervalsOverlap, isDateString, mapsHref, monthGrid, rangeBounds, telHref,
  utcToZonedInput, zonedDateKey, zonedToUtcIso, groupByDate,
} from "@/domain/jobs/calendar";
import { fitWithin, isJobPhotoPath, jobPhotoPath } from "@/domain/jobs/photos";
import { parseFieldJob, setJobStatus, addJobPhoto, createJob } from "@/domain/jobs/service";
import { dayBoundsInZone } from "@/lib/dates";
import { PermissionSet } from "@/lib/permissions";
import type { ServiceContext } from "@/domain/context";

const ORG = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const CUST = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";

/** Minimal fake: records rpc/from calls, every terminal resolves to `result`. */
function fakeCtx(perms: string[], result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["from", "insert", "update", "delete", "select", "eq", "in", "or", "order", "range", "limit", "neq", "is"]) {
    builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder; };
  }
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  builder.rpc = async (...args: unknown[]) => { calls.push({ method: "rpc", args }); return result; };
  const ctx = { supabase: builder, organisationId: ORG, userId: "me", permissions: new PermissionSet(perms), actor: "user" } as unknown as ServiceContext;
  return { ctx, calls };
}

describe("job schemas", () => {
  it("requires customer and title", () => {
    expect(createJobSchema.safeParse({ title: "x" }).success).toBe(false);
    expect(createJobSchema.safeParse({ customerId: CUST, title: "  " }).success).toBe(false);
    const ok = createJobSchema.parse({ customerId: CUST, title: "Deep clean", contactId: "", siteAddressId: "" });
    expect(ok).toMatchObject({ contactId: null, siteAddressId: null, priority: "normal", scheduledStart: null, assigneeIds: [] });
  });

  it("rejects an end before the start and an end without a start", () => {
    const base = { customerId: CUST, title: "t" };
    expect(createJobSchema.safeParse({ ...base, scheduledStart: "2026-10-16T10:00:00+02:00", scheduledEnd: "2026-10-16T09:00:00+02:00" }).success).toBe(false);
    expect(createJobSchema.safeParse({ ...base, scheduledEnd: "2026-10-16T09:00:00Z" }).success).toBe(false);
    expect(createJobSchema.safeParse({ ...base, scheduledStart: "2026-10-16T08:00:00Z", scheduledEnd: "2026-10-16T10:00:00Z" }).success).toBe(true);
    expect(scheduleJobSchema.safeParse({ scheduledStart: "2026-10-16T08:00:00Z", scheduledEnd: "2026-10-16T08:00:00Z" }).success).toBe(false);
    expect(scheduleJobSchema.parse({ scheduledStart: "" })).toMatchObject({ scheduledStart: null, force: false });
    expect(createJobFromQuoteSchema.safeParse({ quoteId: "nope" }).success).toBe(false);
  });

  it("validates list filters, statuses, notes, assignment and photos", () => {
    expect(listJobsSchema.parse({})).toMatchObject({ status: "all", page: 1, pageSize: 25 });
    expect(listJobsSchema.safeParse({ status: "invoiced" }).success).toBe(false);
    expect(listJobsSchema.parse({ assignee: "me" }).assignee).toBe("me");
    expect(jobStatusSchema.safeParse({ action: "delete" }).success).toBe(false);
    expect(jobStatusSchema.safeParse({ action: "cancel", notes: "x".repeat(501) }).success).toBe(false);
    expect(jobStatusSchema.safeParse({ action: "complete", notes: "x".repeat(4000) }).success).toBe(true);
    expect(jobNoteSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(assignMembersSchema.safeParse({ userIds: [] }).success).toBe(false);
    expect(assignMembersSchema.parse({ userIds: [CUST] }).role).toBe("worker");
    expect(jobPhotoSchema.safeParse({ storagePath: "p", category: "selfie" }).success).toBe(false);
    expect(jobPhotoSchema.safeParse({ storagePath: "p", byteSize: 9 * 1024 * 1024 }).success).toBe(false);
  });

  it("derives invoiced only for completed jobs with an invoice", () => {
    expect(displayJobStatus("completed", true)).toBe("invoiced");
    expect(displayJobStatus("completed", false)).toBe("completed");
    expect(displayJobStatus("in_progress", true)).toBe("in_progress");
  });

  it("sanitises PostgREST search input but keeps job numbers", () => {
    expect(sanitiseJobSearch("J-0001,(x)")).toBe("J-0001 x");
  });
});

describe("photo helpers", () => {
  it("fits within 1600px on the longest side, never upscales", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200, scaled: true });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600, scaled: true });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scaled: false });
    expect(fitWithin(10000, 3)).toEqual({ width: 1600, height: 1, scaled: true });
    expect(() => fitWithin(0, 10)).toThrow();
  });

  it("builds and validates scoped storage paths", () => {
    const p = jobPhotoPath(ORG, JOB, FILE);
    expect(p).toBe(`${ORG}/jobs/${JOB}/${FILE}.jpg`);
    expect(isJobPhotoPath(p, ORG, JOB)).toBe(true);
    expect(isJobPhotoPath(`${ORG}/jobs/${JOB}/../x/${FILE}.jpg`, ORG, JOB)).toBe(false);
    expect(isJobPhotoPath(`${ORG}/jobs/${CUST}/${FILE}.jpg`, ORG, JOB)).toBe(false);
    expect(isJobPhotoPath(`${ORG}/jobs/${JOB}/${FILE}.exe`, ORG, JOB)).toBe(false);
  });
});

describe("calendar helpers", () => {
  it("builds Monday-first whole-week month grids", () => {
    const oct = monthGrid(2026, 10); // 1 Oct 2026 is a Thursday
    expect(oct.every((w) => w.length === 7)).toBe(true);
    expect(oct[0]![0]).toEqual({ date: "2026-09-28", inMonth: false });
    expect(oct[0]![3]).toEqual({ date: "2026-10-01", inMonth: true });
    expect(oct.flat().filter((d) => d.inMonth)).toHaveLength(31);
    const feb = monthGrid(2027, 2); // starts Monday, 28 days → exactly 4 weeks
    expect(feb).toHaveLength(4);
    expect(monthGrid(2026, 10, 0)[0]![0]!.date).toBe("2026-09-27");
  });

  it("does date arithmetic across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026-02-28")).toBe(true);
  });

  it("detects half-open overlaps", () => {
    expect(intervalsOverlap(0, 10, 10, 20)).toBe(false);
    expect(intervalsOverlap(0, 11, 10, 20)).toBe(true);
    expect(intervalsOverlap(5, 6, 0, 20)).toBe(true);
  });

  it("flags overlapping jobs that share an assignee (2h default length)", () => {
    const o = findOverlaps([
      { id: "a", scheduled_start: "2026-10-16T08:00:00Z", scheduled_end: "2026-10-16T10:00:00Z", status: "scheduled", assigneeIds: ["u1"] },
      { id: "b", scheduled_start: "2026-10-16T09:00:00Z", scheduled_end: null, status: "in_progress", assigneeIds: ["u1", "u2"] },
      { id: "c", scheduled_start: "2026-10-16T09:30:00Z", scheduled_end: null, status: "scheduled", assigneeIds: ["u3"] },
      { id: "d", scheduled_start: "2026-10-16T10:59:00Z", scheduled_end: null, status: "scheduled", assigneeIds: ["u2"] },
      { id: "e", scheduled_start: "2026-10-16T08:00:00Z", scheduled_end: null, status: "completed", assigneeIds: ["u1"] },
    ]);
    expect(o.get("a")).toEqual(["b"]);
    expect(o.get("b")?.sort()).toEqual(["a", "d"]);
    expect(o.has("c")).toBe(false);
    expect(o.has("e")).toBe(false);
  });
});

describe("timezone handling", () => {
  it("converts org-local wall time to UTC and back", () => {
    expect(zonedToUtcIso("2026-10-16", "08:30", "Africa/Johannesburg")).toBe("2026-10-16T06:30:00.000Z");
    expect(utcToZonedInput("2026-10-16T06:30:00.000Z", "Africa/Johannesburg")).toEqual({ date: "2026-10-16", time: "08:30" });
    expect(zonedToUtcIso("2026-07-01", "09:00", "Europe/London")).toBe("2026-07-01T08:00:00.000Z"); // BST
    expect(zonedToUtcIso("2026-01-01", "09:00", "Europe/London")).toBe("2026-01-01T09:00:00.000Z");
    expect(() => zonedToUtcIso("2026-13-01", "09:00", "UTC")).toThrow();
  });

  it("day bounds match lib/dates for the same day and are 24h in SAST", () => {
    const b = dayBoundsForDate("2026-10-16", "Africa/Johannesburg");
    expect(b).toEqual({ start: "2026-10-15T22:00:00.000Z", end: "2026-10-16T22:00:00.000Z" });
    expect(dayBoundsInZone(new Date("2026-10-16T12:00:00Z"), "Africa/Johannesburg")).toEqual(b);
    expect(rangeBounds("2026-09-28", "2026-11-08", "Africa/Johannesburg").end).toBe("2026-11-08T22:00:00.000Z");
  });

  it("puts late-evening UTC jobs on the next local day", () => {
    expect(zonedDateKey("2026-10-16T23:30:00Z", "Africa/Johannesburg")).toBe("2026-10-17");
    const g = groupByDate([
      { id: "x", scheduled_start: "2026-10-16T23:30:00Z" },
      { id: "y", scheduled_start: "2026-10-17T06:00:00Z" },
      { id: "z", scheduled_start: null },
    ], "Africa/Johannesburg");
    expect([...g.keys()]).toEqual(["2026-10-17"]);
    expect(g.get("2026-10-17")!.map((j) => j.id)).toEqual(["x", "y"]);
  });

  it("builds navigation and call links", () => {
    expect(mapsHref("12 Dorp St, Stellenbosch")).toBe("https://www.google.com/maps/search/?api=1&query=12%20Dorp%20St%2C%20Stellenbosch");
    expect(mapsHref("  ")).toBeNull();
    expect(telHref("082 555 1234")).toBe("tel:0825551234");
    expect(telHref("12")).toBeNull();
  });
});

describe("job service guards", () => {
  it("parses the get_field_job payload defensively", () => {
    expect(parseFieldJob(null)).toBeNull();
    expect(parseFieldJob({ title: "x" })).toBeNull();
    expect(parseFieldJob({ id: JOB, title: "Clean", customer_name: "ABC", contact_phone: "" })).toMatchObject({
      id: JOB, title: "Clean", customer_name: "ABC", contact_phone: null, status: "unscheduled",
    });
  });

  it("field agents may start/complete but not cancel or reopen", async () => {
    const field = ["jobs.read_assigned", "jobs.work"];
    const c1 = fakeCtx(field);
    expect((await setJobStatus(c1.ctx, JOB, "cancel")).ok).toBe(false);
    expect((await setJobStatus(c1.ctx, JOB, "reopen")).ok).toBe(false);
    expect(c1.calls.some((c) => c.method === "rpc")).toBe(false);
    const c2 = fakeCtx(field, { data: { id: JOB, status: "in_progress" }, error: null });
    const r = await setJobStatus(c2.ctx, JOB, "start");
    expect(r).toEqual({ ok: true, data: { id: JOB, status: "in_progress", already: false } });
    expect(c2.calls.find((c) => c.method === "rpc")?.args).toEqual(["set_job_status", { p_job_id: JOB, p_action: "start", p_notes: undefined }]);
  });

  it("refuses photo rows outside the job's folder before touching the DB", async () => {
    const { ctx, calls } = fakeCtx(["jobs.work", "jobs.read_assigned"]);
    const r = await addJobPhoto(ctx, JOB, { storagePath: `${ORG}/jobs/${CUST}/${FILE}.jpg` });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("requires jobs.write to create a job", async () => {
    const { ctx, calls } = fakeCtx(["jobs.read_assigned", "jobs.work"]);
    expect((await createJob(ctx, { customerId: CUST, title: "x" })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
