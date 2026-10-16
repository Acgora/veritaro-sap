import { describe, expect, it } from "vitest";
import { documentTotals, lineAmounts } from "@/lib/money-calc";

const VAT15 = { taxRate: "15", vatRegistered: true, pricesIncludeTax: false };
const VAT15_INCL = { taxRate: "15", vatRegistered: true, pricesIncludeTax: true };
const NOVAT = { taxRate: "15", vatRegistered: false, pricesIncludeTax: false };

describe("line amounts mirror app_private.line_amounts", () => {
  it("exclusive VAT", () => {
    expect(lineAmounts({ quantity: 1, unitPrice: "1250", taxable: true }, VAT15))
      .toEqual({ gross: "1250.00", discount: "0.00", tax: "187.50", excl: "1250.00", total: "1437.50" });
  });
  it("inclusive VAT per line (golden vector also asserted in rls_phase3.test.sql)", () => {
    const lines = [
      { quantity: 1, unitPrice: "1250", taxable: true },
      { quantity: 1, unitPrice: "650", taxable: true },
    ];
    expect(documentTotals(lines, VAT15_INCL)).toEqual({ subtotal: "1652.18", discountTotal: "0.00", taxTotal: "247.82", total: "1900.00" });
  });
  it("DJ Ossewa golden path: R1,250 + R650 excl VAT", () => {
    const lines = [
      { quantity: 1, unitPrice: "1250", taxable: true },
      { quantity: 1, unitPrice: "650", taxable: true },
    ];
    expect(documentTotals(lines, VAT15)).toEqual({ subtotal: "1900.00", discountTotal: "0.00", taxTotal: "285.00", total: "2185.00" });
  });
  it("non-VAT business charges no tax", () => {
    expect(lineAmounts({ quantity: "2.5", unitPrice: "99.99", taxable: true }, NOVAT))
      .toEqual({ gross: "249.98", discount: "0.00", tax: "0.00", excl: "249.98", total: "249.98" });
  });
  it("percent discount rounds half-up", () => {
    // 3 × 33.33 = 99.99; 12.5% = 12.49875 → 12.50
    expect(lineAmounts({ quantity: 3, unitPrice: "33.33", discountType: "percent", discountValue: "12.5", taxable: true }, VAT15))
      .toEqual({ gross: "99.99", discount: "12.50", tax: "13.12", excl: "87.49", total: "100.61" });
  });
  it("amount discount is capped at the line gross", () => {
    expect(lineAmounts({ quantity: 1, unitPrice: "100", discountType: "amount", discountValue: "500", taxable: true }, VAT15))
      .toEqual({ gross: "100.00", discount: "100.00", tax: "0.00", excl: "0.00", total: "0.00" });
  });
  it("non-taxable line on a VAT-registered business", () => {
    expect(lineAmounts({ quantity: 1, unitPrice: "500", taxable: false }, VAT15).tax).toBe("0.00");
  });
  it("fractional quantity × price rounds like numeric", () => {
    // 0.333 × 10.05 = 3.34665 → 3.35
    expect(lineAmounts({ quantity: "0.333", unitPrice: "10.05", taxable: true }, NOVAT).gross).toBe("3.35");
  });
  it("totals always satisfy total = subtotal + tax", () => {
    const lines = Array.from({ length: 25 }, (_, i) => ({ quantity: (i % 7) + 0.5, unitPrice: `${(i * 37.17).toFixed(2)}`, taxable: i % 3 !== 0, discountType: i % 4 === 0 ? ("percent" as const) : null, discountValue: i % 4 === 0 ? "7.5" : null }));
    for (const basis of [VAT15, VAT15_INCL, NOVAT]) {
      const t = documentTotals(lines, basis);
      expect((Math.round(Number(t.subtotal) * 100) + Math.round(Number(t.taxTotal) * 100))).toBe(Math.round(Number(t.total) * 100));
    }
  });
});
