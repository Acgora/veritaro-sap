/** Small pure formatting helpers shared by Today, search and customer lifecycle. No I/O. */

/** Calendar date (YYYY-MM-DD) of `date` in an IANA timezone. */
export function localDateInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((p(to) - p(from)) / 86400000);
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** "Three" for small counts, digits beyond ten. Capitalised (sentence start). */
export function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}

/** `plural(2, "invoice")` → "2 invoices". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** "a, b and c" */
export function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Relative day label for an ISO timestamp vs `today` (YYYY-MM-DD) in a timezone: today / tomorrow / Friday / 23 Oct. */
export function dayLabel(iso: string, today: string, timeZone: string): string {
  const d = new Date(iso);
  const diff = daysBetween(today, localDateInZone(d, timeZone));
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff > 1 && diff < 7) return new Intl.DateTimeFormat("en-ZA", { weekday: "long", timeZone }).format(d);
  return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", timeZone }).format(d);
}

/** Time of day (HH:MM, 24h) in a timezone. */
export function timeInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
}
