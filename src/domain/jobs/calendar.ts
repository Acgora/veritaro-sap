/**
 * Pure date/calendar helpers for jobs. The DB stores timestamptz (UTC); every
 * screen shows and accepts times in the ORGANISATION timezone, never the
 * browser's. No dependencies — unit tested in tests/unit/jobs.test.ts.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
      weekday: "short", hour12: false,
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of an instant in a timezone. */
export function zonedParts(date: Date | string, timeZone: string): ZonedParts {
  const d = typeof date === "string" ? new Date(date) : date;
  const p = Object.fromEntries(partsFormatter(timeZone).formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: p.hour === "24" ? 0 : Number(p.hour), minute: Number(p.minute), weekday: WEEKDAYS[p.weekday ?? "Sun"] ?? 0,
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetAt(ms: number, timeZone: string): number {
  // Whole minutes: every real-world offset is a whole number of minutes.
  const d = new Date(Math.floor(ms / 60000) * 60000);
  const p = zonedParts(d, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - d.getTime();
}

export function isDateString(v: string | null | undefined): v is string {
  if (!v) return false;
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

export function isTimeString(v: string | null | undefined): v is string {
  return !!v && TIME_RE.test(v);
}

/** Local wall time (YYYY-MM-DD + HH:mm) in `timeZone` → UTC ISO string. Handles DST gaps/overlaps deterministically. */
export function zonedToUtcIso(date: string, time: string, timeZone: string): string {
  if (!isDateString(date) || !isTimeString(time)) throw new Error("Invalid date or time");
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ms = guess - offsetAt(guess, timeZone);
  const second = offsetAt(ms, timeZone);
  if (guess - second !== ms) ms = guess - second;
  return new Date(ms).toISOString();
}

/** UTC ISO → { date: YYYY-MM-DD, time: HH:mm } in the timezone (for form defaults). */
export function utcToZonedInput(iso: string, timeZone: string): { date: string; time: string } {
  const p = zonedParts(iso, timeZone);
  return { date: ymd(p.year, p.month, p.day), time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** The calendar date (YYYY-MM-DD) of an instant in the timezone. */
export function zonedDateKey(date: Date | string, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return ymd(p.year, p.month, p.day);
}

/** [start, end) of a local calendar day as UTC ISO strings. */
export function dayBoundsForDate(date: string, timeZone: string): { start: string; end: string } {
  return { start: zonedToUtcIso(date, "00:00", timeZone), end: zonedToUtcIso(addDays(date, 1), "00:00", timeZone) };
}

/** [start, end) covering an inclusive range of local dates. */
export function rangeBounds(fromDate: string, toDate: string, timeZone: string): { start: string; end: string } {
  return { start: zonedToUtcIso(fromDate, "00:00", timeZone), end: zonedToUtcIso(addDays(toDate, 1), "00:00", timeZone) };
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Pure calendar arithmetic on YYYY-MM-DD (no timezone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addMonths(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface MonthGridDay {
  date: string;
  inMonth: boolean;
}

/**
 * Month grid as full weeks (Monday-first by default, as is usual in South Africa).
 * Always whole weeks: 4–6 rows of 7 days.
 */
export function monthGrid(year: number, month: number, weekStartsOn: 0 | 1 = 1): MonthGridDay[][] {
  const first = ymd(year, month, 1);
  const lead = (weekdayOf(first) - weekStartsOn + 7) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const start = addDays(first, -lead);
  const weeks: MonthGridDay[][] = [];
  for (let i = 0; i < total; i++) {
    const date = addDays(start, i);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1]!.push({ date, inMonth: date.slice(0, 7) === first.slice(0, 7) });
  }
  return weeks;
}

/** Default length when a job has a start but no end — mirrors find_schedule_conflicts (2 hours). */
export const DEFAULT_JOB_DURATION_MS = 2 * 60 * 60 * 1000;

export function effectiveEnd(start: string, end: string | null | undefined): number {
  return end ? new Date(end).getTime() : new Date(start).getTime() + DEFAULT_JOB_DURATION_MS;
}

/** Half-open interval overlap [aStart, aEnd) ∩ [bStart, bEnd) — same rule as the SQL. */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export interface OverlapInput {
  id: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: string;
  assigneeIds: string[];
}

/**
 * Jobs that share at least one assignee with another active job at an overlapping time.
 * Returns job id → the other job ids it clashes with. Used to flag the day view visually;
 * the authoritative check is rpc find_schedule_conflicts.
 */
export function findOverlaps(jobs: OverlapInput[]): Map<string, string[]> {
  const active = jobs.filter((j) => j.scheduled_start && (j.status === "scheduled" || j.status === "in_progress") && j.assigneeIds.length > 0);
  const out = new Map<string, string[]>();
  for (let i = 0; i < active.length; i++) {
    const a = active[i]!;
    const aS = new Date(a.scheduled_start!).getTime();
    const aE = effectiveEnd(a.scheduled_start!, a.scheduled_end);
    for (let k = i + 1; k < active.length; k++) {
      const b = active[k]!;
      if (!a.assigneeIds.some((u) => b.assigneeIds.includes(u))) continue;
      const bS = new Date(b.scheduled_start!).getTime();
      const bE = effectiveEnd(b.scheduled_start!, b.scheduled_end);
      if (intervalsOverlap(aS, aE, bS, bE)) {
        out.set(a.id, [...(out.get(a.id) ?? []), b.id]);
        out.set(b.id, [...(out.get(b.id) ?? []), a.id]);
      }
    }
  }
  return out;
}

/** Group items by their local date key (scheduled_start in the timezone). */
export function groupByDate<T extends { scheduled_start: string | null }>(items: T[], timeZone: string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    if (!it.scheduled_start) continue;
    const k = zonedDateKey(it.scheduled_start, timeZone);
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  for (const list of map.values()) list.sort((a, b) => (a.scheduled_start! < b.scheduled_start! ? -1 : 1));
  return map;
}

export function formatTime(iso: string, timeZone: string, locale = "en-ZA"): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
}

export function formatTimeRange(start: string, end: string | null, timeZone: string): string {
  const s = formatTime(start, timeZone);
  return end ? `${s}–${formatTime(end, timeZone)}` : s;
}

/** "Fri 16 Oct 2026" style label for a YYYY-MM-DD (timezone-independent). */
export function formatDateKey(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric" }, locale = "en-ZA"): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Google Maps search link for an address (works on Android, iOS and desktop). */
export function mapsHref(address: string | null | undefined): string | null {
  const a = address?.trim();
  return a ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}` : null;
}

/** tel: link with only dialable characters. */
export function telHref(phone: string | null | undefined): string | null {
  const p = phone?.replace(/[^0-9+]/g, "");
  return p && p.replace(/\D/g, "").length >= 6 ? `tel:${p}` : null;
}
