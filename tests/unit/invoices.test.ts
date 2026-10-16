import { describe, expect, it } from "vitest";
import { createInvoiceDraftSchema, invoiceHeaderSchema, listInvoicesSchema, voidInvoiceSchema } from "@/domain/invoices/schema";
import { IDEMPOTENCY_KEY, newIdempotencyKey, normaliseAmount, recordPaymentSchema, voidPaymentSchema, type RecordPaymentInput } from "@/domain/payments/schema";
import { recordPayment, voidPayment } from "@/domain/payments/service";
import { createInvoiceDraft, issueInvoice, voidInvoice } from "@/domain/invoices/service";
import { financialSettingsSchema } from "@/domain/financial-settings/schema";
import { formatPaymentDetails, formatAddress, invoicePdfData } from "@/lib/pdf/document-data";
import { renderCommercialPdf } from "@/lib/pdf/render";
import { PermissionSet } from "@/lib/permissions";
import type { ServiceContext } from "@/domain/context";
import type { Tables } from "@/types/database.types";
import { extractPdfText } from "./helpers/pdf-text";

const IID = "33333333-3333-4333-8333-333333333333";
const CID = "22222222-2222-4222-8222-222222222222";

function fakeDb(results: Record<string, unknown>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      const res = () => ({ data: results[table] ?? null, error: null });
      for (const m of ["insert", "update", "select", "eq", "neq", "in", "or", "order", "range", "lt", "gt", "gte", "limit", "is"]) {
        b[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return b; };
      }
      b.single = async () => res();
      b.maybeSingle = async () => res();
      return b;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const r = results[`rpc:${fn}`];
      return typeof r === "function" ? (r as (a: Record<string, unknown>) => unknown)(args) : { data: r ?? null, error: null };
    },
  };
  return { client: client as unknown as ServiceContext["supabase"], calls, rpcCalls };
}
const ctxFor = (perms: string[], db: ReturnType<typeof fakeDb>): ServiceContext => ({
  supabase: db.client, organisationId: "org-1", userId: "me", permissions: new PermissionSet(perms), actor: "user",
});

const payment = (patch: Record<string, unknown> = {}): RecordPaymentInput => ({
  invoiceId: IID, amount: "2500.00", paymentDate: "2026-10-16", method: "bank_transfer", idempotencyKey: "pay_0123456789", ...patch,
} as RecordPaymentInput);

describe("idempotency keys", () => {
  it("generates a fresh, valid key per call", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(IDEMPOTENCY_KEY.test(a)).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(100);
  });
  it("is required for recording a payment", () => {
    expect(recordPaymentSchema.safeParse(payment({ idempotencyKey: undefined })).success).toBe(false);
    expect(recordPaymentSchema.safeParse(payment({ idempotencyKey: "short" })).success).toBe(false);
    expect(recordPaymentSchema.safeParse(payment({ idempotencyKey: "bad key with spaces" })).success).toBe(false);
  });
  it("double submit with the same key sends the same key twice and surfaces 'already'", async () => {
    let n = 0;
    const db = fakeDb({
      "rpc:record_payment": (args: Record<string, unknown>) => {
        n += 1;
        return { data: { payment_id: "p1", invoice_id: args.p_invoice_id, status: "partially_paid", amount_due: 500, ...(n > 1 ? { already: true } : {}) }, error: null };
      },
    });
    const ctx = ctxFor(["payments.record"], db);
    const key = newIdempotencyKey();
    const first = await recordPayment(ctx, payment({ idempotencyKey: key }));
    const second = await recordPayment(ctx, payment({ idempotencyKey: key }));
    expect(db.rpcCalls.map((c) => c.args.p_idempotency_key)).toEqual([key, key]);
    expect(first).toMatchObject({ ok: true, data: { paymentId: "p1", already: false, amountDue: "500.00" } });
    expect(second).toMatchObject({ ok: true, data: { paymentId: "p1", already: true } });
  });
});

describe("payment schema", () => {
  it.each([
    ["2500", "2500"], ["2500.5", "2500.5"], ["R2,500.00", "2500.00"], ["R 2 500,50", "2500.50"], ["2 500,00", "2500.00"], ["1,234,567.89", "1234567.89"],
  ])("normalises %s", (input, out) => {
    expect(normaliseAmount(input)).toBe(out);
  });
  it.each(["0", "-10", "12.345", "abc", ""])("rejects amount %s", (amount) => {
    expect(recordPaymentSchema.safeParse(payment({ amount })).success).toBe(false);
  });
  it("accepts a partial payment", () => {
    expect(recordPaymentSchema.parse(payment({ amount: "100.10" })).amount).toBe("100.10");
  });
  it("rejects unknown methods and bad dates", () => {
    expect(recordPaymentSchema.safeParse(payment({ method: "crypto" })).success).toBe(false);
    expect(recordPaymentSchema.safeParse(payment({ paymentDate: "16/10/2026" })).success).toBe(false);
  });
  it("requires reasons to reverse or void", () => {
    expect(voidPaymentSchema.safeParse({ reason: " " }).success).toBe(false);
    expect(voidInvoiceSchema.safeParse({ reason: "Wrong customer" }).success).toBe(true);
  });
});

describe("payment & invoice services", () => {
  it("refuses to record without payments.record and never calls the DB", async () => {
    const db = fakeDb({});
    expect((await recordPayment(ctxFor(["payments.read"], db), payment())).ok).toBe(false);
    expect(db.rpcCalls).toHaveLength(0);
  });
  it("passes the amount as an exact 2dp value", async () => {
    const db = fakeDb({ "rpc:record_payment": { payment_id: "p", invoice_id: IID, status: "paid", amount_due: 0 } });
    await recordPayment(ctxFor(["payments.record"], db), payment({ amount: "R 1 234,56" }));
    expect(db.rpcCalls[0]!.args.p_amount).toBe(1234.56);
  });
  it("shows the database's overpayment message", async () => {
    const db = fakeDb({ "rpc:record_payment": () => ({ data: null, error: { code: "22023", message: "That is more than the 500.00 outstanding on this invoice" } }) });
    const r = await recordPayment(ctxFor(["payments.record"], db), payment());
    expect(r).toEqual({ ok: false, error: "That is more than the 500.00 outstanding on this invoice." });
  });
  it("validates void reasons before calling the RPC", async () => {
    const db = fakeDb({});
    expect((await voidPayment(ctxFor(["payments.record"], db), "p1", "")).ok).toBe(false);
    expect((await voidInvoice(ctxFor(["invoices.issue"], db), IID, "  ")).ok).toBe(false);
    expect(db.rpcCalls).toHaveLength(0);
  });
  it("issues through issue_invoice and returns the number", async () => {
    const db = fakeDb({ "rpc:issue_invoice": { id: IID, status: "issued", invoice_number: "INV-0042", total: 2300 } });
    const r = await issueInvoice(ctxFor(["invoices.issue"], db), IID);
    expect(r).toMatchObject({ ok: true, data: { invoiceNumber: "INV-0042", already: false } });
    expect((await issueInvoice(ctxFor(["invoices.write"], db), IID)).ok).toBe(false);
  });
  it("creates a blank draft with the org-local date and VAT-inclusive default", async () => {
    const db = fakeDb({
      organisation_financial_settings: { prices_include_tax_default: true },
      organisations: { timezone: "Africa/Johannesburg" },
      invoices: { id: IID },
    });
    const r = await createInvoiceDraft(ctxFor(["invoices.write"], db), { customerId: CID });
    expect(r).toEqual({ ok: true, data: { id: IID } });
    const insert = db.calls.find((c) => c.table === "invoices" && c.method === "insert")!.args[0] as Record<string, unknown>;
    expect(insert).toMatchObject({ customer_id: CID, prices_include_tax: true, organisation_id: "org-1" });
    expect(insert.invoice_number).toBeUndefined(); // numbered only at issue
  });
});

describe("invoice schemas", () => {
  it("requires a customer and a due date on/after the invoice date", () => {
    expect(createInvoiceDraftSchema.safeParse({}).success).toBe(false);
    expect(invoiceHeaderSchema.safeParse({ customerId: CID, issueDate: "2026-10-16", dueDate: "2026-10-15", pricesIncludeTax: false }).success).toBe(false);
    expect(invoiceHeaderSchema.safeParse({ customerId: CID, issueDate: "2026-10-16", dueDate: "2026-10-16", pricesIncludeTax: false }).success).toBe(true);
  });
  it("supports the derived overdue filter", () => {
    expect(listInvoicesSchema.parse({ status: "overdue" }).status).toBe("overdue");
  });
});

describe("financial settings schema", () => {
  const base = {
    vatRegistered: true, taxLabel: "VAT", taxRate: "15", pricesIncludeTaxDefault: false, quoteValidityDays: "30", invoiceDueDays: "30",
    leadFollowupDays: 2, quoteFollowupDays: 3, invoiceDueSoonDays: 3,
  };
  it("accepts SA defaults", () => {
    expect(financialSettingsSchema.parse(base)).toMatchObject({ taxRate: "15", quoteValidityDays: 30, bankName: null });
  });
  it.each([{ taxRate: "100" }, { taxRate: "15.12345" }, { quoteValidityDays: 0 }, { invoiceDueDays: 400 }, { taxLabel: "" }, { bankAccountNumber: "12AB" }])("rejects %o", (patch) => {
    expect(financialSettingsSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});

describe("snapshot formatting helpers mirror the SQL", () => {
  it("formats bank details like issue_invoice()", () => {
    expect(formatPaymentDetails({ bank_name: "FNB", bank_account_holder: null, bank_account_number: "62000000000", bank_branch_code: "250655", bank_account_type: null }))
      .toBe("Bank: FNB\nAccount number: 62000000000\nBranch code: 250655");
    expect(formatPaymentDetails({ bank_name: null, bank_account_holder: null, bank_account_number: null, bank_branch_code: null, bank_account_type: null })).toBeNull();
  });
  it("formats addresses like app_private.format_address()", () => {
    expect(formatAddress({ line1: "5 Dorp St", suburb: "Central", city: "Stellenbosch", postal: "7600" })).toBe("5 Dorp St\nCentral, Stellenbosch\n7600");
  });
});

// ---------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------
const issuedInvoice = {
  id: IID, organisation_id: "org-1", invoice_number: "INV-0042", customer_id: CID, contact_id: null, site_address_id: null, job_id: null, quote_id: null,
  title: "Office deep clean", status: "partially_paid", issue_date: "2026-10-16", due_date: "2026-11-15", currency: "ZAR", prices_include_tax: false,
  vat_registered_snapshot: true, tax_rate_snapshot: 15, tax_label_snapshot: "VAT", subtotal: 2000, discount_total: 0, tax_total: 300, total: 2300,
  amount_paid: 1000, amount_due: 1300,
  customer_name_snapshot: "ABC Construction", customer_registration_snapshot: null, customer_tax_snapshot: null, customer_address_snapshot: "1 Main Rd",
  site_address_snapshot: null, contact_name_snapshot: null, contact_email_snapshot: null, contact_phone_snapshot: null,
  seller_name_snapshot: "Sparkle Cleaning", seller_legal_name_snapshot: null, seller_registration_snapshot: null, seller_tax_snapshot: "4999999999",
  seller_address_snapshot: "5 Dorp St", seller_email_snapshot: null, seller_phone_snapshot: null,
  payment_details_snapshot: "Bank: FNB\nAccount number: 62000000000", notes: null, terms: "Payment within 30 days", void_reason: null,
  created_by: null, issued_by: null, voided_by: null, created_at: "2026-10-16T08:00:00Z", updated_at: "2026-10-16T08:00:00Z",
  issued_at: "2026-10-16T08:00:00Z", paid_at: null, voided_at: null, archived_at: null,
} as Tables<"invoices">;
const items = [{ description: "Deep clean", quantity: 2, unit: "days", unit_price: 1000, discount_type: null, discount_value: null, taxable: true, line_discount: 0, line_tax: 300, line_total: 2300 }];

describe("invoice PDF", () => {
  it("is a tax invoice from snapshots with payment details and balance", () => {
    const d = invoicePdfData(issuedInvoice, items);
    expect(d).toMatchObject({ heading: "Tax invoice", draft: false, watermark: null, number: "INV-0042" });
    expect(d.payment).toEqual({ details: "Bank: FNB\nAccount number: 62000000000", amountPaid: "1000.00", amountDue: "1300.00" });
    expect(invoicePdfData({ ...issuedInvoice, vat_registered_snapshot: false }, items).heading).toBe("Invoice");
    expect(invoicePdfData({ ...issuedInvoice, status: "void", voided_at: "2026-10-17T00:00:00Z" }, items).watermark).toBe("VOID");
  });
  it("renders an issued invoice to a PDF with no draft label", async () => {
    const buf = await renderCommercialPdf(invoicePdfData(issuedInvoice, items));
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    const text = extractPdfText(buf);
    expect(text).toContain("INV-0042");
    expect(text).toContain("Amount due");
    expect(text.toUpperCase()).not.toContain("DRAFT");
  }, 20000);
});
