"use server";
import { revalidatePath } from "next/cache";
import { getServiceContext } from "@/lib/service-context";
import {
  archiveQuote, createInvoiceFromQuote, createQuote, duplicateQuote, issueQuote, saveQuoteDraft, setQuoteOutcome,
} from "@/domain/quotes/service";
import { listCustomerParties } from "@/domain/commercial/parties";
import type { AcceptMethod, CreateQuoteInput, IssueMethod, QuoteOutcome, SaveQuoteDraftInput } from "@/domain/quotes/schema";

/** Thin adapters over the quote domain service. */
function refresh(id?: string) {
  revalidatePath("/app/sales/quotes");
  if (id) revalidatePath(`/app/sales/quotes/${id}`);
  revalidatePath("/app/today");
}

export async function customerPartiesAction(customerId: string) {
  return listCustomerParties(await getServiceContext(), customerId);
}

export async function createQuoteAction(input: CreateQuoteInput) {
  const r = await createQuote(await getServiceContext(), input);
  if (r.ok) refresh(r.data.id);
  return r;
}

export async function saveQuoteDraftAction(id: string, input: SaveQuoteDraftInput) {
  const r = await saveQuoteDraft(await getServiceContext(), id, input);
  if (r.ok) refresh(id);
  return r;
}

export async function issueQuoteAction(id: string, method: IssueMethod) {
  const r = await issueQuote(await getServiceContext(), id, method);
  if (r.ok) refresh(id);
  return r;
}

export async function setQuoteOutcomeAction(id: string, outcome: QuoteOutcome, method?: AcceptMethod, reason?: string) {
  const r = await setQuoteOutcome(await getServiceContext(), id, outcome, method, reason);
  if (r.ok) refresh(id);
  return r;
}

export async function archiveQuoteAction(id: string) {
  const r = await archiveQuote(await getServiceContext(), id);
  if (r.ok) refresh(id);
  return r;
}

export async function duplicateQuoteAction(id: string) {
  const r = await duplicateQuote(await getServiceContext(), id);
  if (r.ok) refresh(r.data.id);
  return r;
}

export async function createInvoiceFromQuoteAction(quoteId: string) {
  const r = await createInvoiceFromQuote(await getServiceContext(), quoteId);
  if (r.ok) {
    refresh(quoteId);
    revalidatePath("/app/money/invoices");
  }
  return r;
}
