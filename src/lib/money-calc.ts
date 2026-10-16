/**
 * Exact decimal line maths — a byte-for-byte mirror of app_private.line_amounts()
 * (migration 20261016000200). Used ONLY for live previews in the quote/invoice
 * builders; the database recalculates and stores the authoritative values.
 * tests/unit/money-calc.test.ts holds golden vectors that are also asserted in SQL.
 *
 * No floating point: all values are BigInt rationals; rounding is half-up (away from
 * zero for the non-negative values we handle), matching Postgres round(numeric, 2).
 */

interface Rat { n: bigint; d: bigint }

const TEN = 10n;

export function parseDecimal(value: string | number | null | undefined): Rat {
  const s = (value === null || value === undefined ? "0" : String(value)).trim() || "0";
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Not a decimal: ${s}`);
  const neg = s.startsWith("-");
  const [w, f = ""] = s.replace("-", "").split(".");
  const n = BigInt(w + f) * (neg ? -1n : 1n);
  return { n, d: TEN ** BigInt(f.length) };
}

const mul = (a: Rat, b: Rat): Rat => ({ n: a.n * b.n, d: a.d * b.d });
const div = (a: Rat, b: Rat): Rat => (b.n < 0n ? { n: -a.n * b.d, d: a.d * -b.n } : { n: a.n * b.d, d: a.d * b.n });
const sub = (a: Rat, b: Rat): Rat => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const add = (a: Rat, b: Rat): Rat => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const cmp = (a: Rat, b: Rat) => { const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
const min = (a: Rat, b: Rat) => (cmp(a, b) <= 0 ? a : b);
const max = (a: Rat, b: Rat) => (cmp(a, b) >= 0 ? a : b);
const ZERO: Rat = { n: 0n, d: 1n };
const HUNDRED: Rat = { n: 100n, d: 1n };

/** round(x, 2), half away from zero → cents as BigInt rational with d = 100. */
function money(x: Rat): Rat {
  const neg = x.n < 0n;
  const absN = neg ? -x.n : x.n;
  const cents = (2n * absN * 100n + x.d) / (2n * x.d);
  return { n: neg ? -cents : cents, d: 100n };
}

/** Rat with d=100 (or any) → "1234.50" */
export function toFixed2(x: Rat): string {
  const m = money(x);
  const neg = m.n < 0n;
  const a = neg ? -m.n : m.n;
  const s = `${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
  return neg && a !== 0n ? `-${s}` : s;
}

export interface LineInput {
  quantity: string | number;
  unitPrice: string | number;
  discountType?: "percent" | "amount" | null;
  discountValue?: string | number | null;
  taxable: boolean;
}

export interface TaxBasis {
  taxRate: string | number;
  vatRegistered: boolean;
  pricesIncludeTax: boolean;
}

export interface LineAmounts { gross: string; discount: string; tax: string; excl: string; total: string }

function lineRat(line: LineInput, basis: TaxBasis) {
  const gross = money(mul(parseDecimal(line.quantity), parseDecimal(line.unitPrice)));
  let disc = ZERO;
  if (line.discountType === "percent") {
    const pct = min(max(parseDecimal(line.discountValue ?? 0), ZERO), HUNDRED);
    disc = money(div(mul(gross, pct), HUNDRED));
  } else if (line.discountType === "amount") {
    disc = min(money(max(parseDecimal(line.discountValue ?? 0), ZERO)), max(gross, ZERO));
  }
  const net = sub(gross, disc);
  const rate = basis.vatRegistered && line.taxable ? parseDecimal(basis.taxRate) : ZERO;
  let tax = ZERO;
  if (cmp(rate, ZERO) > 0) {
    tax = basis.pricesIncludeTax ? money(div(mul(net, rate), add(HUNDRED, rate))) : money(div(mul(net, rate), HUNDRED));
  }
  const excl = basis.pricesIncludeTax ? sub(net, tax) : net;
  const total = basis.pricesIncludeTax ? net : add(net, tax);
  return { gross, disc, tax, excl, total };
}

export function lineAmounts(line: LineInput, basis: TaxBasis): LineAmounts {
  const r = lineRat(line, basis);
  return { gross: toFixed2(r.gross), discount: toFixed2(r.disc), tax: toFixed2(r.tax), excl: toFixed2(r.excl), total: toFixed2(r.total) };
}

export interface DocumentTotals { subtotal: string; discountTotal: string; taxTotal: string; total: string }

/** Document totals exactly as refresh_quote_totals / refresh_invoice_totals compute them. */
export function documentTotals(lines: LineInput[], basis: TaxBasis): DocumentTotals {
  let excl = ZERO, disc = ZERO, tax = ZERO;
  for (const l of lines) {
    const r = lineRat(l, basis);
    excl = add(excl, r.excl); disc = add(disc, r.disc); tax = add(tax, r.tax);
  }
  return { subtotal: toFixed2(excl), discountTotal: toFixed2(disc), taxTotal: toFixed2(tax), total: toFixed2(add(excl, tax)) };
}

/** Safe validity check for a user-typed money/quantity string. */
export function isDecimalString(s: string, maxDp = 2): boolean {
  return new RegExp(`^\\d{1,12}(\\.\\d{1,${maxDp}})?$`).test(s.trim());
}
