/**
 * Money rules (binding for all future phases):
 *  - DB: numeric(19,4) (or bigint minor units) — NEVER float/real/double.
 *  - Transport: decimal STRINGS ("4500.00"), never JS numbers, for amounts.
 *  - Arithmetic: in Postgres or with integer minor units; no float maths on amounts.
 * This helper only FORMATS a decimal string for display.
 */
export function formatMoney(amount: string, currency: string, locale = "en-ZA"): string {
  if (!/^-?\d+(\.\d+)?$/.test(amount)) throw new Error("formatMoney expects a decimal string");
  const negative = amount.startsWith("-");
  const [whole = "0", frac = ""] = amount.replace("-", "").split(".");
  const cents = (frac + "00").slice(0, 2);
  const roundUp = Number((frac[2] ?? "0")) >= 5;
  let minor = BigInt(whole) * 100n + BigInt(cents) + (roundUp ? 1n : 0n);
  if (negative) minor = -minor;
  const fmt = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 });
  // Safe: we pass an exact 2dp value as a string-built number within Number precision for display.
  const major = Number(minor) / 100;
  return fmt.format(major);
}
