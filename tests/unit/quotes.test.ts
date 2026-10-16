import { describe, expect, it } from "vitest";
import { lineItemSchema, planItemSync, toItemRow, fromItemRow } from "@/domain/commercial/line-items";
import { addDays, todayInZone } from "@/domain/commercial/dates";
import { createQuoteSchema, listQuotesSchema, quoteHeaderSchema, quoteOutcomeSchema, saveQuoteDraftSchema } from "@/domain/quotes/schema";
import { createQuote, issueQuote, saveQuoteDraft } from "@/domain/quotes/service";
import { quotePdfData, toPdfLines, pdfFileName, hasIssueSnapshot } from "@/lib/pdf/document-data";
import { renderCommercialPdf } from "@/lib/pdf/render";
import { PermissionSet } from "@/lib/permissions";
import type { ServiceContext } from "@/domain/context";
import type { Tables } from "@/types/database.types";
import { extractPdfText } from "./helpers/pdf-text";

const QID = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";

/** Per-table fake of the supabase query builder; records calls; `results[table]` resolves terminal calls. */
function fakeDb(results: Record<string, unknown>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const client = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      const res = () => ({ data: results[table] ?? null, error: null });
      for (const m of ["insert", "update", "upsert", "delete", "select", "eq", "neq", "in", "or", "order", "range", "lt", "gt", "gte", "limit", "is", "ilike"]) {
        b[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return b; };
      }
      b.single = async () => res();
      b.maybeSingle = async () => res();
      b.then = (resolve: (v: unknown) => void) => resolve(res());
      return b;
    },
    rpc: async (fn: string, args: unknown) => { rpcCalls.push({ fn, args }); return { data: results[`rpc:${fn}`] ?? null, error: null }; },
  };
  return { client: client as unknown as ServiceContext["supabase"], calls, rpcCalls };
}
const ctxFor = (perms: string[], db: ReturnType<typeof fakeDb>): ServiceContext => ({
  supabase: db.client, organisationId: "org-1", userId: "me", permissions: new PermissionSet(perms), actor: "user",
});

describe("line item schema", () => {
  const base = { description: "Deep clean", quantity: "2", unitPrice: "450.50", taxable: true };
  it("accepts a valid line and keeps decimal strings", () => {
    const r = lineItemSchema.parse(base);
    expect(r.quantity).toBe("2");
    expect(r.unitPrice).toBe("450.50");
    expect(r.discountType).toBe("none");
  });
  it("accepts numbers from AI callers", () => {
    expect(lineItemSchema.safeParse({ ...base, quantity: 1.5, unitPrice: 100 }).success).toBe(true);
  });
  it.each([
    [{ quantity: "0" }, "quantity"],
    [{ quantity: "1.2345" }, "quantity"],
    [{ unitPrice: "12.345" }, "unitPrice"],
    [{ unitPrice: "-5" }, "unitPrice"],
    [{ description: "   " }, "description"],
    [{ discountType: "percent", discountValue: "150" }, "discountValue"],
    [{ discountType: "amount", discountValue: "abc" }, "discountValue"],
  ])("rejects %o", (patch, field) => {
    const r = lineItemSchema.safeParse({ ...base, ...patch });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.path[0] === field)).toBe(true);
  });
  it("maps to a DB row with paired discount columns", () => {
    expect(toItemRow(lineItemSchema.parse(base), 3)).toMatchObject({ quantity: 2, unit_price: 450.5, discount_type: null, discount_value: null, sort_order: 3 });
    expect(toItemRow(lineItemSchema.parse({ ...base, discountType: "percent", discountValue: "10" }), 0))
      .toMatchObject({ discount_type: "percent", discount_value: 10 });
    // A zero discount is "no discount" (keeps the DB discount pair constraint simple)
    expect(toItemRow(lineItemSchema.parse({ ...base, discountType: "amount", discountValue: "0" }), 0)).toMatchObject({ discount_type: null });
  });
  it("round-trips a stored row into editor strings", () => {
    expect(fromItemRow({ id: "x", description: "a", quantity: 1.5, unit: null, unit_price: 100, discount_type: null, discount_value: null, taxable: true }))
      .toMatchObject({ quantity: "1.5", unitPrice: "100.00", unit: "", discountType: "none", discountValue: "" });
  });
});

describe("draft line replacement plan", () => {
  const items = [
    lineItemSchema.parse({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", description: "Kept", quantity: "1", unitPrice: "10" }),
    lineItemSchema.parse({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", description: "New (client id)", quantity: "1", unitPrice: "5" }),
  ];
  it("upserts every line by id in order and removes the rest", () => {
    const plan = planItemSync(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"], items);
    expect(plan.rows.map((r) => [r.id, r.sort_order])).toEqual([["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 0], ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", 1]]);
    expect(plan.removeIds).toEqual(["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
  });
  it("is idempotent: replaying after a partial save removes nothing new and adds no duplicates", () => {
    const after = planItemSync(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"], items);
    expect(after.removeIds).toEqual([]);
    expect(after.rows).toHaveLength(2);
  });
  it("assigns ids to lines without one", () => {
    const plan = planItemSync([], [lineItemSchema.parse({ description: "x", quantity: "1", unitPrice: "1" })], () => "new-id");
    expect(plan.rows[0]!.id).toBe("new-id");
  });
});

describe("quote schemas", () => {
  it("requires a customer to create", () => {
    expect(createQuoteSchema.safeParse({}).success).toBe(false);
    expect(createQuoteSchema.parse({ customerId: CID, contactId: "" }).contactId).toBeNull();
  });
  it("rejects an expiry before the quote date", () => {
    const r = quoteHeaderSchema.safeParse({ customerId: CID, issueDate: "2026-10-16", expiryDate: "2026-10-01", pricesIncludeTax: false });
    expect(r.success).toBe(false);
  });
  it("reports line errors with item paths", () => {
    const r = saveQuoteDraftSchema.safeParse({
      header: { customerId: CID, issueDate: "2026-10-16", expiryDate: "2026-11-15", pricesIncludeTax: false },
      items: [{ description: "ok", quantity: "x", unitPrice: "1" }],
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path.join(".")).toBe("items.0.quantity");
  });
  it("needs an acceptance method", () => {
    expect(quoteOutcomeSchema.safeParse({ outcome: "accepted" }).success).toBe(false);
    expect(quoteOutcomeSchema.safeParse({ outcome: "accepted", method: "whatsapp" }).success).toBe(true);
    expect(quoteOutcomeSchema.safeParse({ outcome: "declined" }).success).toBe(true);
  });
  it("defaults list filters", () => {
    expect(listQuotesSchema.parse({})).toMatchObject({ status: "all", page: 1, pageSize: 25 });
    expect(listQuotesSchema.safeParse({ status: "nonsense" }).success).toBe(false);
  });
});

describe("dates", () => {
  it("adds calendar days without timezone drift", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
  });
  it("computes today in the org timezone", () => {
    // 23:30 UTC on 15 Oct is already 16 Oct in Johannesburg (UTC+2)
    expect(todayInZone("Africa/Johannesburg", new Date("2026-10-15T23:30:00Z"))).toBe("2026-10-16");
  });
});

describe("quote service", () => {
  it("refuses without quotes.write", async () => {
    const db = fakeDb({});
    const r = await createQuote(ctxFor([], db), { customerId: CID });
    expect(r.ok).toBe(false);
    expect(db.calls).toHaveLength(0);
  });
  it("creates with an explicit org-local date and the organisation's VAT-inclusive default", async () => {
    const db = fakeDb({
      organisation_financial_settings: { prices_include_tax_default: true, vat_registered: true, tax_label: "VAT", tax_rate: 15, quote_validity_days: 30, invoice_due_days: 30 },
      organisations: { timezone: "Africa/Johannesburg" },
      quotes: { id: QID, quote_number: "Q-0007" },
    });
    const r = await createQuote(ctxFor(["quotes.write"], db), { customerId: CID, title: "Office clean" });
    expect(r).toEqual({ ok: true, data: { id: QID, quoteNumber: "Q-0007" } });
    const insert = db.calls.find((c) => c.table === "quotes" && c.method === "insert")!.args[0] as Record<string, unknown>;
    expect(insert.prices_include_tax).toBe(true);
    expect(insert.issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(insert.organisation_id).toBe("org-1");
    expect("expiry_date" in insert && insert.expiry_date !== undefined).toBe(false); // DB default applies
  });
  it("never sends 'channel' as an issue method", async () => {
    const db = fakeDb({});
    const r = await issueQuote(ctxFor(["quotes.issue"], db), QID, "channel" as never);
    expect(r.ok).toBe(false);
    expect(db.rpcCalls).toHaveLength(0);
  });
  it("issues through the RPC and reports idempotent repeats", async () => {
    const db = fakeDb({ "rpc:issue_quote": { id: QID, status: "sent", quote_number: "Q-0007", already: true } });
    const r = await issueQuote(ctxFor(["quotes.issue"], db), QID, "download");
    expect(db.rpcCalls[0]).toEqual({ fn: "issue_quote", args: { p_quote_id: QID, p_method: "download" } });
    expect(r).toMatchObject({ ok: true, data: { already: true, quoteNumber: "Q-0007" } });
  });
  it("won't save lines onto an issued quote", async () => {
    const db = fakeDb({ quotes: { id: QID, status: "sent" } });
    const r = await saveQuoteDraft(ctxFor(["quotes.write"], db), QID, {
      header: { customerId: CID, issueDate: "2026-10-16", expiryDate: "2026-11-15", pricesIncludeTax: false },
      items: [{ description: "x", quantity: "1", unitPrice: "1" }],
    });
    expect(r.ok).toBe(false);
    expect(db.calls.some((c) => c.method === "upsert" || c.method === "update")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------
const issuedQuote = {
  id: QID, organisation_id: "org-1", quote_number: "Q-0042", customer_id: CID, contact_id: null, site_address_id: null, lead_id: null,
  revision_of_id: null, title: "Office deep clean", status: "sent", issue_date: "2026-10-16", expiry_date: "2026-11-15", currency: "ZAR",
  prices_include_tax: false, vat_registered_snapshot: true, tax_rate_snapshot: 15, tax_label_snapshot: "VAT",
  subtotal: 2000, discount_total: 100, tax_total: 300, total: 2300,
  customer_name_snapshot: "ABC Construction", customer_registration_snapshot: null, customer_tax_snapshot: "4123456789",
  customer_address_snapshot: "1 Main Rd\nStellenbosch", site_address_snapshot: "9 Site St\nPaarl", contact_name_snapshot: "Pieter",
  contact_email_snapshot: "pieter@abc.co.za", contact_phone_snapshot: "082 555 1234",
  seller_name_snapshot: "Sparkle Cleaning", seller_legal_name_snapshot: "Sparkle Cleaning (Pty) Ltd", seller_registration_snapshot: "2020/123456/07",
  seller_tax_snapshot: "4999999999", seller_address_snapshot: "5 Dorp St\nStellenbosch", seller_email_snapshot: "hi@sparkle.co.za", seller_phone_snapshot: "021 555 0000",
  notes: "Thanks for the opportunity", terms: "50% deposit", sent_method: "manual", accepted_by: null, accepted_method: null, declined_by: null,
  decline_reason: null, created_by: null, created_at: "2026-10-16T08:00:00Z", updated_at: "2026-10-16T08:00:00Z", issued_at: "2026-10-16T08:00:00Z",
  viewed_at: null, accepted_at: null, declined_at: null, expired_at: null, archived_at: null,
} as Tables<"quotes">;
const items = [
  { description: "Deep clean – offices", quantity: 2, unit: "days", unit_price: 1000, discount_type: "amount", discount_value: 100, taxable: true, line_discount: 100, line_tax: 285, line_total: 2185 },
  { description: "Window cleaning", quantity: 1, unit: null, unit_price: 100, discount_type: null, discount_value: null, taxable: true, line_discount: 0, line_tax: 15, line_total: 115 },
];

describe("quote PDF data", () => {
  it("uses snapshots for an issued quote and is not a draft", () => {
    expect(hasIssueSnapshot(issuedQuote)).toBe(true);
    const d = quotePdfData(issuedQuote, items);
    expect(d.draft).toBe(false);
    expect(d.seller.name).toBe("Sparkle Cleaning");
    expect(d.customer.name).toBe("ABC Construction");
    expect(d.totals).toEqual({ subtotal: "2000.00", discountTotal: "100.00", taxTotal: "300.00", total: "2300.00" });
  });
  it("shows VAT-exclusive line amounts (total − VAT) so lines sum to the subtotal", () => {
    expect(toPdfLines(items, false).map((l) => l.amount)).toEqual(["1900.00", "100.00"]);
    expect(toPdfLines(items, true).map((l) => l.amount)).toEqual(["2185.00", "115.00"]);
  });
  it("refuses to render a draft without live data (never from stale snapshots)", () => {
    const draft = { ...issuedQuote, status: "draft", issued_at: null, seller_name_snapshot: null };
    expect(() => quotePdfData(draft, items)).toThrow();
  });
  it("makes storage-safe file names", () => {
    expect(pdfFileName("Q/2026-0001", "quote", false)).toBe("Q-2026-0001.pdf");
    expect(pdfFileName(null, "invoice", true)).toBe("invoice-DRAFT.pdf");
  });
});

describe("quote PDF render", () => {
  it("renders an issued quote with no draft label", async () => {
    const buf = await renderCommercialPdf(quotePdfData(issuedQuote, items));
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    const text = extractPdfText(buf);
    expect(text).toContain("Q-0042");
    expect(text).toContain("ABC Construction");
    expect(text.toUpperCase()).not.toContain("DRAFT");
  }, 20000);
  it("labels drafts", async () => {
    const draft = { ...issuedQuote, status: "draft", issued_at: null, seller_name_snapshot: null, customer_name_snapshot: null };
    const live = {
      seller: { name: "Sparkle Cleaning", legalName: null, registration: null, tax: null, address: null, email: null, phone: null },
      customer: { name: "ABC Live", registration: null, tax: null, address: null, siteAddress: null, contactName: null, contactEmail: null, contactPhone: null },
      paymentDetails: null,
    };
    const text = extractPdfText(await renderCommercialPdf(quotePdfData(draft, items, { live })));
    expect(text).toContain("DRAFT");
    expect(text).toContain("ABC Live");
  }, 20000);
});
