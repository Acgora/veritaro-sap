import type { ServiceContext } from "@/domain/context";

/** Calendar date (YYYY-MM-DD) "today" in an IANA timezone. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
}

/** Pure calendar arithmetic on YYYY-MM-DD strings (no timezone drift). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = Date.UTC(y!, (m ?? 1) - 1, d ?? 1) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Organisation timezone (ServiceContext does not carry it; one tiny indexed read). */
export async function orgTimezone(ctx: ServiceContext): Promise<string> {
  const { data } = await ctx.supabase.from("organisations").select("timezone").eq("id", ctx.organisationId).maybeSingle();
  return data?.timezone ?? "Africa/Johannesburg";
}

export async function orgToday(ctx: ServiceContext): Promise<string> {
  return todayInZone(await orgTimezone(ctx));
}

/** Display a DB date (YYYY-MM-DD) as "16 Oct 2026" without timezone shifts. */
export function formatDocDate(isoDate: string | null | undefined): string {
  if (!isoDate || !ISO_DATE.test(isoDate)) return "—";
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** Number of whole days between two YYYY-MM-DD dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y!, m! - 1, d!); };
  return Math.round((p(b) - p(a)) / 86400000);
}
