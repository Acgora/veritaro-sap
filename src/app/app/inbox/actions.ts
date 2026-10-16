"use server";
import { revalidatePath } from "next/cache";
import { getServiceContext } from "@/lib/service-context";
import {
  createDraftReply, discardDraft, logCommunication, logDraftAsSent, markConversationRead, setConversationAttention,
} from "@/domain/inbox/service";
import type { DraftReplyInput, LogCommunicationInput } from "@/domain/inbox/schema";

/** Thin adapters over the inbox domain service. */
function refresh(opts: { leadId?: string | null; customerId?: string | null } = {}) {
  revalidatePath("/app/inbox");
  revalidatePath("/app/today");
  if (opts.leadId) {
    revalidatePath(`/app/sales/leads/${opts.leadId}`);
    revalidatePath("/app/sales/leads");
  }
  if (opts.customerId) revalidatePath(`/app/sales/customers/${opts.customerId}`);
}

export async function logCommunicationAction(input: LogCommunicationInput) {
  const r = await logCommunication(await getServiceContext(), input);
  if (r.ok) refresh({ leadId: input.leadId, customerId: input.customerId });
  return r;
}

/** Called automatically when a conversation is opened. Does not revalidate (avoids a render loop). */
export async function markConversationReadAction(conversationId: string) {
  return markConversationRead(await getServiceContext(), conversationId);
}

export async function setConversationAttentionAction(conversationId: string, needsAttention: boolean) {
  const r = await setConversationAttention(await getServiceContext(), conversationId, needsAttention);
  if (r.ok) refresh();
  return r;
}

export async function createDraftReplyAction(input: DraftReplyInput) {
  const r = await createDraftReply(await getServiceContext(), input);
  if (r.ok) refresh();
  return r;
}

export async function discardDraftAction(messageId: string) {
  const r = await discardDraft(await getServiceContext(), messageId);
  if (r.ok) refresh();
  return r;
}

export async function logDraftAsSentAction(messageId: string, leadId?: string | null) {
  const r = await logDraftAsSent(await getServiceContext(), messageId);
  if (r.ok) refresh({ leadId });
  return r;
}
