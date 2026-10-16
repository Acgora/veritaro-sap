/**
 * Pure mapping from DB rows to the data the commercial PDF template renders.
 * ISSUED documents render strictly from their snapshot columns; drafts render from live
 * organisation/customer data and are always labelled DRAFT. No money is computed here
 * beyond the display-only "line amount" (line_total − line_tax for VAT-exclusive documents).
 */
import type { Tables } from "@/types/database.types";

export interface PdfLogo { data: Buffer; format: "png" | "jpg" }

export interface PdfSeller {
  name: string;
  legalName: string | null;
  registration: string | null;
  tax: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  logo?: PdfLogo | null;
}

export interface PdfCustomer {
  name: string;
  registration: string | null;
  tax: string | null;
  address: string | null;
  siteAddress: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface PdfLine {
  description: string;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  discount: { type: "percent" | "amount"; value: string; amount: string } | null;
  taxable: boolean;
  amount: string;
}

export interface CommercialDocumentData {
  kind: "quote" | "invoice";
  draft: boolean;
  /** "VOID" etc. — large secondary watermark for issued-but-cancelled documents. */
  watermark: string | null;
  heading: string;
  number: string | null;
  title: string | null;
  issueDate: string;
  secondaryDate: { label: string; value: string } | null;
  currency: string;
  seller: PdfSeller;
  customer: PdfCustomer;
  tax: { label: string; registered: boolean; rate: string; pricesInclude: boolean };
  lines: PdfLine[];
  totals: { subtotal: string; discountTotal: string; taxTotal: string; total: string };
  notes: string | null;
  terms: string | null;
  payment: { details: string | null; amountPaid: string; amountDue: string } | null;
}

/** Live data for drafts (mirrors app_private.document_snapshot()). */
export interface LiveParties {
  seller: PdfSeller;
  customer: PdfCustomer;
  paymentDetails: string | null;
}

type ItemRow = Pick<Tables<"quote_items">, "description" | "quantity" | "unit" | "unit_price" | "discount_type" | "discount_value" | "taxable" | "line_discount" | "line_tax" | "line_total">;

const m2 = (n: number | null | undefined) => Number(n ?? 0).toFixed(2);
const cents = (n: number) => BigInt(Math.round(Number(n) * 100));
const fromCents = (c: bigint) => {
  const neg = c < 0n; const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
};

export function toPdfLines(items: readonly ItemRow[], pricesInclude: boolean): PdfLine[] {
  return items.map((it) => ({
    description: it.description,
    quantity: String(Number(it.quantity)),
    unit: it.unit,
    unitPrice: m2(it.unit_price),
    discount: it.discount_type === "percent" || it.discount_type === "amount"
      ? { type: it.discount_type, value: String(Number(it.discount_value ?? 0)), amount: m2(it.line_discount) }
      : null,
    taxable: it.taxable,
    // Inclusive documents show the VAT-inclusive line amount; exclusive ones the amount before VAT
    // (so the line column sums to the subtotal).
    amount: pricesInclude ? m2(it.line_total) : fromCents(cents(it.line_total) - cents(it.line_tax)),
  }));
}

type SnapshotCols = Pick<Tables<"quotes">,
  | "customer_name_snapshot" | "customer_registration_snapshot" | "customer_tax_snapshot" | "customer_address_snapshot"
  | "site_address_snapshot" | "contact_name_snapshot" | "contact_email_snapshot" | "contact_phone_snapshot"
  | "seller_name_snapshot" | "seller_legal_name_snapshot" | "seller_registration_snapshot" | "seller_tax_snapshot"
  | "seller_address_snapshot" | "seller_email_snapshot" | "seller_phone_snapshot">;

function sellerFromSnapshot(s: SnapshotCols, logo: PdfLogo | null): PdfSeller {
  return {
    name: s.seller_name_snapshot ?? "", legalName: s.seller_legal_name_snapshot, registration: s.seller_registration_snapshot,
    tax: s.seller_tax_snapshot, address: s.seller_address_snapshot, email: s.seller_email_snapshot, phone: s.seller_phone_snapshot, logo,
  };
}

function customerFromSnapshot(s: SnapshotCols): PdfCustomer {
  return {
    name: s.customer_name_snapshot ?? "", registration: s.customer_registration_snapshot, tax: s.customer_tax_snapshot,
    address: s.customer_address_snapshot, siteAddress: s.site_address_snapshot, contactName: s.contact_name_snapshot,
    contactEmail: s.contact_email_snapshot, contactPhone: s.contact_phone_snapshot,
  };
}

/** True when the document carries issue snapshots (sent/accepted/… and archived-after-issue). */
export function hasIssueSnapshot(row: { issued_at: string | null; seller_name_snapshot: string | null }): boolean {
  return !!row.issued_at && !!row.seller_name_snapshot;
}

export function quotePdfData(
  quote: Tables<"quotes">,
  items: readonly ItemRow[],
  opts: { live?: LiveParties | null; logo?: PdfLogo | null } = {},
): CommercialDocumentData {
  const issued = hasIssueSnapshot(quote);
  if (!issued && !opts.live) throw new Error("Draft quotes need live party data");
  return {
    kind: "quote",
    draft: !issued,
    watermark: null,
    heading: "Quote",
    number: quote.quote_number,
    title: quote.title,
    issueDate: quote.issue_date,
    secondaryDate: quote.expiry_date ? { label: "Valid until", value: quote.expiry_date } : null,
    currency: quote.currency,
    seller: issued ? sellerFromSnapshot(quote, opts.logo ?? null) : { ...opts.live!.seller, logo: opts.logo ?? null },
    customer: issued ? customerFromSnapshot(quote) : opts.live!.customer,
    tax: { label: quote.tax_label_snapshot, registered: quote.vat_registered_snapshot, rate: String(Number(quote.tax_rate_snapshot)), pricesInclude: quote.prices_include_tax },
    lines: toPdfLines(items, quote.prices_include_tax),
    totals: { subtotal: m2(quote.subtotal), discountTotal: m2(quote.discount_total), taxTotal: m2(quote.tax_total), total: m2(quote.total) },
    notes: quote.notes,
    terms: quote.terms,
    payment: null,
  };
}

export function invoicePdfData(
  invoice: Tables<"invoices">,
  items: readonly ItemRow[],
  opts: { live?: LiveParties | null; logo?: PdfLogo | null } = {},
): CommercialDocumentData {
  const issued = hasIssueSnapshot(invoice);
  if (!issued && !opts.live) throw new Error("Draft invoices need live party data");
  return {
    kind: "invoice",
    draft: !issued,
    watermark: invoice.status === "void" || invoice.voided_at ? "VOID" : null,
    heading: invoice.vat_registered_snapshot ? "Tax invoice" : "Invoice",
    number: invoice.invoice_number,
    title: invoice.title,
    issueDate: invoice.issue_date,
    secondaryDate: invoice.due_date ? { label: "Due date", value: invoice.due_date } : null,
    currency: invoice.currency,
    seller: issued ? sellerFromSnapshot(invoice, opts.logo ?? null) : { ...opts.live!.seller, logo: opts.logo ?? null },
    customer: issued ? customerFromSnapshot(invoice) : opts.live!.customer,
    tax: { label: invoice.tax_label_snapshot, registered: invoice.vat_registered_snapshot, rate: String(Number(invoice.tax_rate_snapshot)), pricesInclude: invoice.prices_include_tax },
    lines: toPdfLines(items, invoice.prices_include_tax),
    totals: { subtotal: m2(invoice.subtotal), discountTotal: m2(invoice.discount_total), taxTotal: m2(invoice.tax_total), total: m2(invoice.total) },
    notes: invoice.notes,
    terms: invoice.terms,
    payment: {
      details: issued ? invoice.payment_details_snapshot : opts.live!.paymentDetails,
      amountPaid: m2(invoice.amount_paid),
      amountDue: m2(invoice.amount_due),
    },
  };
}

/** Same wording as issue_invoice() so a draft preview matches the issued document. */
export function formatPaymentDetails(fs: {
  bank_name: string | null; bank_account_holder: string | null; bank_account_number: string | null;
  bank_branch_code: string | null; bank_account_type: string | null;
} | null): string | null {
  if (!fs) return null;
  const lines = [
    fs.bank_name ? `Bank: ${fs.bank_name}` : null,
    fs.bank_account_holder ? `Account holder: ${fs.bank_account_holder}` : null,
    fs.bank_account_number ? `Account number: ${fs.bank_account_number}` : null,
    fs.bank_branch_code ? `Branch code: ${fs.bank_branch_code}` : null,
    fs.bank_account_type ? `Account type: ${fs.bank_account_type}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

/** Same layout as app_private.format_address(). */
export function formatAddress(a: { line1?: string | null; line2?: string | null; suburb?: string | null; city?: string | null; province?: string | null; postal?: string | null } | null): string | null {
  if (!a) return null;
  const t = (s?: string | null) => (s ?? "").trim() || null;
  const parts = [
    t(a.line1), t(a.line2),
    [t(a.suburb), t(a.city)].filter(Boolean).join(", ") || null,
    [t(a.province), t(a.postal)].filter(Boolean).join(" ") || null,
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

/** Storage-safe PDF file name from a document number ("Q/2026-0001" → "Q-2026-0001.pdf"). */
export function pdfFileName(number: string | null, kind: "quote" | "invoice", draft: boolean): string {
  const base = (number ?? `${kind}`).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || kind;
  return `${base}${draft ? "-DRAFT" : ""}.pdf`;
}
