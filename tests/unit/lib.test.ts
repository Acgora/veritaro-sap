import { describe, expect, it } from "vitest";
import { isProtectedPath, isAuthPath, safeNextPath } from "@/lib/routes";
import { toUserMessage } from "@/lib/errors";
import { dayBoundsInZone, greetingFor } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { describeActivity } from "@/domain/activity/describe";
import { onboardingSchema } from "@/domain/organisations/schema";
import { initials } from "@/lib/utils";

describe("protected routes", () => {
  it("protects /app and /onboarding", () => {
    expect(isProtectedPath("/app")).toBe(true);
    expect(isProtectedPath("/app/work/tasks")).toBe(true);
    expect(isProtectedPath("/onboarding")).toBe(true);
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/application")).toBe(false);
    expect(isAuthPath("/register")).toBe(true);
  });
  it("prevents open redirects", () => {
    expect(safeNextPath("/app/work/tasks")).toBe("/app/work/tasks");
    expect(safeNextPath("//evil.com")).toBe("/app/today");
    expect(safeNextPath("https://evil.com")).toBe("/app/today");
    expect(safeNextPath("/\\evil.com")).toBe("/app/today");
    expect(safeNextPath(null)).toBe("/app/today");
  });
});

describe("error messages", () => {
  it("never leaks raw database messages", () => {
    const msg = toUserMessage({ code: "XX000", message: 'relation "secret_table" does not exist' });
    expect(msg).not.toContain("secret_table");
  });
  it("passes through deliberate guard messages", () => {
    expect(toUserMessage({ code: "42501", message: "An organisation must keep at least one active owner" })).toBe(
      "An organisation must keep at least one active owner.",
    );
  });
});

describe("dates", () => {
  it("greets by organisation timezone", () => {
    const d = new Date("2026-10-14T05:30:00Z"); // 07:30 in Johannesburg
    expect(greetingFor(d, "Africa/Johannesburg")).toBe("morning");
    expect(greetingFor(new Date("2026-10-14T11:00:00Z"), "Africa/Johannesburg")).toBe("afternoon");
    expect(greetingFor(new Date("2026-10-14T17:00:00Z"), "Africa/Johannesburg")).toBe("evening");
  });
  it("computes local day bounds as UTC", () => {
    const { start, end } = dayBoundsInZone(new Date("2026-10-14T23:30:00Z"), "Africa/Johannesburg"); // 01:30 on the 15th SAST
    expect(start).toBe("2026-10-14T22:00:00.000Z");
    expect(end).toBe("2026-10-15T22:00:00.000Z");
  });
});

describe("money", () => {
  it("formats decimal strings without float input", () => {
    expect(formatMoney("4500", "ZAR")).toMatch(/4[\s  ]?500,00|4[\s,]?500\.00/);
    expect(() => formatMoney("abc", "ZAR")).toThrow();
  });
});

describe("activity descriptions", () => {
  it("describes known actions and labels AI actors", () => {
    expect(describeActivity({ action: "task_completed", actorType: "user", actorName: "Sam", metadata: { title: "Call ABC" } })).toBe("Sam completed task “Call ABC”");
    expect(describeActivity({ action: "task_created", actorType: "ai", actorName: null, metadata: {} })).toBe("The assistant created task a task");
  });
});

describe("onboarding validation", () => {
  it("requires essentials and upper-cases codes", () => {
    expect(onboardingSchema.safeParse({ name: "", country: "ZA", currency: "ZAR", timezone: "Africa/Johannesburg" }).success).toBe(false);
    const r = onboardingSchema.parse({ name: "Boland Cleaning", country: "za", currency: "zar", timezone: "Africa/Johannesburg", vatNumber: "" });
    expect(r).toMatchObject({ country: "ZA", currency: "ZAR", vatNumber: null });
  });
});

describe("utils", () => {
  it("builds initials", () => {
    expect(initials("Gerhard Fourie")).toBe("GF");
    expect(initials("")).toBe("?");
  });
});

describe("member joined wording", () => {
  it("says 'joined' when the actor added themselves (onboarding)", () => {
    expect(describeActivity({ action: "member_added", actorType: "user", actorName: "Erin", actorUserId: "u1", metadata: { user_id: "u1", role: "owner" } })).toBe("Erin joined as owner");
  });
});

import { normaliseSupabaseUrl } from "@/lib/supabase/middleware";
describe("supabase url normalisation", () => {
  it("fixes iPad capitalisation, quotes, spaces and trailing slash", () => {
    expect(normaliseSupabaseUrl(' "Https://ZQIB.supabase.co/" ')).toBe("https://zqib.supabase.co");
  });
});
