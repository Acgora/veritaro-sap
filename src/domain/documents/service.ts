import "server-only";
import { createHash } from "node:crypto";
import { fail, ok, logServerError, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { Tables } from "@/types/database.types";
import { renderCommercialPdf } from "@/lib/pdf/render";
import {
  formatAddress, formatPaymentDetails, hasIssueSnapshot, invoicePdfData, pdfFileName, quotePdfData,
  type LiveParties, type PdfLogo,
} from "@/lib/pdf/document-data";

/**
 * Quote / invoice PDFs. Everything runs with the USER's Supabase client (RLS + storage
 * policies apply; never the service role). Issued documents are rendered from snapshots,
 * stored once in the private `documents` bucket at {org}/{module}/{id}/{number}.pdf and
 * registered in public.documents (immutable); later requests stream the stored file.
 */

export interface PdfResult {
  buffer: Buffer;
  fileName: string;
  issued: boolean;
  /** "stored" = streamed from Storage; "rendered" = generated for this request. */
  source: "stored" | "rendered";
}

const NOT_FOUND = "We couldn't find that document, or you don't have access to it.";

// ---------------------------------------------------------------------------------------------
// Logo (organisations.logo_url). Fetched defensively: https only, no private hosts, small, PNG/JPEG.
// ---------------------------------------------------------------------------------------------
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

export async function fetchLogo(url: string | null | undefined): Promise<PdfLogo | null> {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" || PRIVATE_HOST.test(u.hostname)) return null;
  try {
    const res = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(3000), cache: "no-store" });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > 1_500_000) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 1_500_000) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { data: buf, format: "png" };
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { data: buf, format: "jpg" };
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Live party data for DRAFT previews (mirrors app_private.document_snapshot()).
// ---------------------------------------------------------------------------------------------
async function loadLiveParties(ctx: ServiceContext, ref: { customerId: string; contactId: string | null; siteAddressId: string | null }): Promise<LiveParties & { logoUrl: string | null }> {
  const sb = ctx.supabase;
  const [org, fs, customer, contacts, addresses] = await Promise.all([
    sb.from("organisations").select("name, legal_name, registration_number, vat_number, email, phone, logo_url, address_line1, address_line2, suburb, city, province, postal_code")
      .eq("id", ctx.organisationId).maybeSingle(),
    sb.from("organisation_financial_settings").select("vat_registered, bank_name, bank_account_holder, bank_account_number, bank_branch_code, bank_account_type")
      .eq("organisation_id", ctx.organisationId).maybeSingle(),
    sb.from("customers").select("display_name, registration_number, vat_number, email, phone")
      .eq("organisation_id", ctx.organisationId).eq("id", ref.customerId).maybeSingle(),
    sb.from("customer_contacts").select("id, first_name, last_name, email, phone, is_primary")
      .eq("organisation_id", ctx.organisationId).eq("customer_id", ref.customerId).limit(100),
    sb.from("customer_addresses").select("id, line1, line2, suburb, city, province, postal_code, is_default_billing")
      .eq("organisation_id", ctx.organisationId).eq("customer_id", ref.customerId).limit(100),
  ]);
  const o = org.data;
  const c = customer.data;
  const contact = (contacts.data ?? []).find((x) => x.id === ref.contactId) ?? (contacts.data ?? []).find((x) => x.is_primary) ?? null;
  const site = (addresses.data ?? []).find((a) => a.id === ref.siteAddressId) ?? null;
  const billing = (addresses.data ?? []).find((a) => a.is_default_billing) ?? site;
  const addr = (a: typeof site) => (a ? formatAddress({ line1: a.line1, line2: a.line2, suburb: a.suburb, city: a.city, province: a.province, postal: a.postal_code }) : null);
  const contactName = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() || null : null;
  return {
    logoUrl: o?.logo_url ?? null,
    seller: {
      name: o?.name ?? "",
      legalName: o?.legal_name ?? null,
      registration: o?.registration_number ?? null,
      tax: fs.data?.vat_registered ? (o?.vat_number ?? null) : null,
      address: o ? formatAddress({ line1: o.address_line1, line2: o.address_line2, suburb: o.suburb, city: o.city, province: o.province, postal: o.postal_code }) : null,
      email: o?.email ?? null,
      phone: o?.phone ?? null,
    },
    customer: {
      name: c?.display_name ?? "Customer",
      registration: c?.registration_number ?? null,
      tax: c?.vat_number ?? null,
      address: addr(billing),
      siteAddress: addr(site),
      contactName,
      contactEmail: contact?.email ?? c?.email ?? null,
      contactPhone: contact?.phone ?? c?.phone ?? null,
    },
    paymentDetails: formatPaymentDetails(fs.data ?? null),
  };
}

async function currentLogoUrl(ctx: ServiceContext): Promise<string | null> {
  const { data } = await ctx.supabase.from("organisations").select("logo_url").eq("id", ctx.organisationId).maybeSingle();
  return data?.logo_url ?? null;
}

// ---------------------------------------------------------------------------------------------
// Storage (private `documents` bucket + public.documents register)
// ---------------------------------------------------------------------------------------------
type DocEntity = { entityType: "quote" | "invoice"; module: "quotes" | "invoices"; kind: "quote_pdf" | "invoice_pdf"; entityId: string; number: string };

async function downloadStored(ctx: ServiceContext, path: string): Promise<Buffer | null> {
  const { data, error } = await ctx.supabase.storage.from("documents").download(path);
  if (error || !data) {
    logServerError("documents.download", error);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

async function findStored(ctx: ServiceContext, e: DocEntity): Promise<Tables<"documents"> | null> {
  const { data, error } = await ctx.supabase.from("documents").select("*")
    .eq("organisation_id", ctx.organisationId).eq("entity_type", e.entityType).eq("entity_id", e.entityId).eq("kind", e.kind)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) logServerError("documents.find", error);
  return data ?? null;
}

/**
 * Return the stored issued PDF, or render + store it (when the user may issue this document
 * type — the bucket/table policies require quotes.issue / invoices.issue to write). Users who
 * can only read get a freshly rendered copy that is not stored.
 */
async function storedOrRender(ctx: ServiceContext, e: DocEntity, render: () => Promise<Buffer>, canStore: boolean): Promise<{ buffer: Buffer; source: "stored" | "rendered" }> {
  const existing = await findStored(ctx, e);
  if (existing) {
    const buf = await downloadStored(ctx, existing.storage_path);
    if (buf) return { buffer: buf, source: "stored" };
  }
  const fileName = pdfFileName(e.number, e.entityType, false);
  const path = `${ctx.organisationId}/${e.module}/${e.entityId}/${fileName}`;
  if (!canStore) return { buffer: await render(), source: "rendered" };

  let buffer = await render();
  const up = await ctx.supabase.storage.from("documents").upload(path, buffer, { contentType: "application/pdf", upsert: false, cacheControl: "31536000" });
  if (up.error) {
    // A concurrent request may have stored it first: the stored object is canonical.
    const again = await downloadStored(ctx, path);
    if (!again) {
      logServerError("documents.upload", up.error);
      return { buffer, source: "rendered" };
    }
    buffer = again;
  }
  if (!existing) {
    const { error } = await ctx.supabase.from("documents").insert({
      organisation_id: ctx.organisationId, entity_type: e.entityType, entity_id: e.entityId, kind: e.kind,
      storage_bucket: "documents", storage_path: path, file_name: fileName, byte_size: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"), version: 1, created_by: ctx.userId,
    });
    if (error && error.code !== "23505") logServerError("documents.register", error);
  }
  return { buffer, source: up.error ? "stored" : "rendered" };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------
export async function getQuotePdf(ctx: ServiceContext, quoteId: string): Promise<ActionResult<PdfResult>> {
  if (!ctx.permissions.can("quotes.read")) return fail(NOT_FOUND);
  const [q, items] = await Promise.all([
    ctx.supabase.from("quotes").select("*").eq("organisation_id", ctx.organisationId).eq("id", quoteId).maybeSingle(),
    ctx.supabase.from("quote_items").select("*").eq("organisation_id", ctx.organisationId).eq("quote_id", quoteId).order("sort_order").order("created_at").limit(500),
  ]);
  if (q.error || items.error) {
    logServerError("documents.quote", q.error ?? items.error);
    return fail("We couldn't create the PDF.");
  }
  if (!q.data) return fail(NOT_FOUND);
  const quote = q.data;
  try {
    if (hasIssueSnapshot(quote)) {
      const render = async () => renderCommercialPdf(quotePdfData(quote, items.data ?? [], { logo: await fetchLogo(await currentLogoUrl(ctx)) }));
      const r = await storedOrRender(ctx, { entityType: "quote", module: "quotes", kind: "quote_pdf", entityId: quote.id, number: quote.quote_number },
        render, ctx.permissions.can("quotes.issue"));
      return ok({ buffer: r.buffer, fileName: pdfFileName(quote.quote_number, "quote", false), issued: true, source: r.source });
    }
    const live = await loadLiveParties(ctx, { customerId: quote.customer_id, contactId: quote.contact_id, siteAddressId: quote.site_address_id });
    const buffer = await renderCommercialPdf(quotePdfData(quote, items.data ?? [], { live, logo: await fetchLogo(live.logoUrl) }));
    return ok({ buffer, fileName: pdfFileName(quote.quote_number, "quote", true), issued: false, source: "rendered" });
  } catch (e) {
    logServerError("documents.quote.render", e);
    return fail("We couldn't create the PDF.");
  }
}

export async function getInvoicePdf(ctx: ServiceContext, invoiceId: string): Promise<ActionResult<PdfResult>> {
  if (!ctx.permissions.can("invoices.read")) return fail(NOT_FOUND);
  const [i, items] = await Promise.all([
    ctx.supabase.from("invoices").select("*").eq("organisation_id", ctx.organisationId).eq("id", invoiceId).maybeSingle(),
    ctx.supabase.from("invoice_items").select("*").eq("organisation_id", ctx.organisationId).eq("invoice_id", invoiceId).order("sort_order").order("created_at").limit(500),
  ]);
  if (i.error || items.error) {
    logServerError("documents.invoice", i.error ?? items.error);
    return fail("We couldn't create the PDF.");
  }
  if (!i.data) return fail(NOT_FOUND);
  const invoice = i.data;
  try {
    if (hasIssueSnapshot(invoice) && invoice.invoice_number) {
      const logo = await fetchLogo(await currentLogoUrl(ctx));
      // The stored copy is the invoice AS ISSUED (nothing paid, not void). It is immutable, so a
      // later payment or void is shown on a freshly rendered copy (same snapshots, current balance).
      const asIssued: Tables<"invoices"> = { ...invoice, status: "issued", amount_paid: 0, amount_due: invoice.total, voided_at: null };
      const changedSinceIssue = Number(invoice.amount_paid) > 0 || !!invoice.voided_at || invoice.status === "void";
      const stored = await storedOrRender(
        ctx,
        { entityType: "invoice", module: "invoices", kind: "invoice_pdf", entityId: invoice.id, number: invoice.invoice_number },
        () => renderCommercialPdf(invoicePdfData(asIssued, items.data ?? [], { logo })),
        ctx.permissions.can("invoices.issue"),
      );
      const fileName = pdfFileName(invoice.invoice_number, "invoice", false);
      if (!changedSinceIssue) return ok({ buffer: stored.buffer, fileName, issued: true, source: stored.source });
      const buffer = await renderCommercialPdf(invoicePdfData(invoice, items.data ?? [], { logo }));
      return ok({ buffer, fileName, issued: true, source: "rendered" });
    }
    const live = await loadLiveParties(ctx, { customerId: invoice.customer_id, contactId: invoice.contact_id, siteAddressId: invoice.site_address_id });
    const buffer = await renderCommercialPdf(invoicePdfData(invoice, items.data ?? [], { live, logo: await fetchLogo(live.logoUrl) }));
    return ok({ buffer, fileName: pdfFileName(invoice.invoice_number, "invoice", true), issued: false, source: "rendered" });
  } catch (e) {
    logServerError("documents.invoice.render", e);
    return fail("We couldn't create the PDF.");
  }
}

/** Shared Response builder for the PDF route handlers. */
export function pdfResponse(r: PdfResult, download: boolean): Response {
  const safeName = r.fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(new Uint8Array(r.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(r.buffer.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Veritaro-Pdf-Source": r.source,
    },
  });
}
