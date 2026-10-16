// Randomised parity check: src/lib/money-calc.ts vs app_private.line_amounts() in Postgres.
// Usage: node scripts/money-parity.mjs <psql-db>   (invoked by supabase/tests/run-db-tests.sh)
import { execFileSync } from "node:child_process";
const db = process.argv[2] ?? "veritaro_test";
const { lineAmounts } = await import("../.parity-build/money-calc.mjs");
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const cases = [];
for (let i = 0; i < 400; i++) {
  const q = (Math.floor(rnd() * 50000) / 1000 + 0.001).toFixed(3);
  const p = (Math.floor(rnd() * 5000000) / 100).toFixed(2);
  const dt = rnd() < 0.3 ? "percent" : rnd() < 0.5 ? "amount" : null;
  const dv = dt === "percent" ? (Math.floor(rnd() * 10000) / 100).toFixed(2) : dt === "amount" ? (Math.floor(rnd() * 100000) / 100).toFixed(2) : null;
  const taxable = rnd() > 0.2, reg = rnd() > 0.2, incl = rnd() > 0.5;
  const rate = ["15", "14", "0", "7.5"][Math.floor(rnd() * 4)];
  cases.push({ q, p, dt, dv, taxable, reg, incl, rate });
}
const sql = cases.map((c) => `select g::text||'|'||d::text||'|'||t::text||'|'||e::text||'|'||tot::text from app_private.line_amounts(${c.q},${c.p},${c.dt ? `'${c.dt}'` : "null"},${c.dv ?? "null"},${c.taxable},${c.rate},${c.reg},${c.incl}) as x(g,d,t,e,tot);`).join("\n");
const out = execFileSync("psql", ["-q", "-At", "-d", db], { input: sql, env: process.env }).toString().trim().split("\n");
const f = (s) => Number(s).toFixed(2);
let bad = 0;
cases.forEach((c, i) => {
  const ts = lineAmounts({ quantity: c.q, unitPrice: c.p, discountType: c.dt, discountValue: c.dv, taxable: c.taxable }, { taxRate: c.rate, vatRegistered: c.reg, pricesIncludeTax: c.incl });
  const got = [ts.gross, ts.discount, ts.tax, ts.excl, ts.total].join("|");
  const exp = out[i].split("|").map(f).join("|");
  if (got !== exp) { bad++; if (bad < 5) console.error("MISMATCH", c, got, exp); }
});
if (bad) { console.error(`✘ money parity: ${bad}/${cases.length} mismatches`); process.exit(1); }
console.log(`  money-parity: ${cases.length} random lines identical in TypeScript and SQL`);
