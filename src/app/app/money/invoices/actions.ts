"use server";
import { revalidatePath } from "next/cache";
import { getServiceContext } from "@/lib/service-context";
import {
  archiveInvoice, createInvoiceDraft, createInvoiceFromJob, createInvoiceFromQuote, issueInvoice, listInvoiceSources,
  saveInvoiceDraft, voidInvoice,
} from "@/domain/invoices/service";
import type { CreateInvoiceDraftInput, SaveInvoiceDraftInput } from "@/domain/invoices/schema";

/** Thin adapters over the invoice domain service. */
function refresh(id?: string) {
  revalidatePath("/app/money");
  revalidatePath("/app/money/invoices");
  if (id) revalidatePath(`/app/money/invoices/${id}`);
  revalidatePath("/app/today");
}

export async function listInvoiceSourcesAction() {
  return listInvoiceSources(await getServiceContext());
}

export async function createInvoiceDraftAction(input: CreateInvoiceDraftInput) {
  const r = await createInvoiceDraft(await getServiceContext(), input);
  if (r.ok) refresh(r.data.id);
  return r;
}

export async function createInvoiceFromJobAction(jobId: string) {
  const r = await createInvoiceFromJob(await getServiceContext(), jobId);
  if (r.ok) refresh(r.data.invoiceId);
  return r;
}

export async function createInvoiceFromQuoteAction(quoteId: string) {
  const r = await createInvoiceFromQuote(await getServiceContext(), quoteId);
  if (r.ok) {
    refresh(r.data.invoiceId);
    revalidatePath(`/app/sales/quotes/${quoteId}`);
  }
  return r;
}

export async function saveInvoiceDraftAction(id: string, input: SaveInvoiceDraftInput) {
  const r = await saveInvoiceDraft(await getServiceContext(), id, input);
  if (r.ok) refresh(id);
  return r;
}

export async function issueInvoiceAction(id: string) {
  const r = await issueInvoice(await getServiceContext(), id);
  if (r.ok) refresh(id);
  return r;
}

export async function voidInvoiceAction(id: string, reason: string) {
  const r = await voidInvoice(await getServiceContext(), id, reason);
  if (r.ok) refresh(id);
  return r;
}

export async function archiveInvoiceAction(id: string) {
  const r = await archiveInvoice(await getServiceContext(), id);
  if (r.ok) refresh(id);
  return r;
}
