import { z } from "zod";
import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { Json } from "@/types/database.types";
import { sanitiseSearch } from "@/domain/customers/schema";
import { leadDisplayName } from "@/domain/leads/rules";
import {
  draftChannelFor,
  draftReplySchema,
  isUnread,
  listConversationsSchema,
  logCommunicationSchema,
  type DraftReplyInput,
  type InboxFilter,
  type ListConversationsInput,
  type LogCommunicationInput,
} from "./schema";

/**
 * Inbox / communications. Provider-independent: in this phase only manual records and drafts exist.
 * Nothing here sends anything. Inbound channel messages can only come from a future integration
 * (enforced by guard_messages). Logging always goes through public.log_communication.
 */

type ProfileName = { display_name: string | null; first_name: string | null; last_name: string | null } | null;
const personName = (p: ProfileName): string | null =>
  p ? p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || null : null;

type LeadName = { title: string; person_name: string | null; company_name: string | null } | null;

export interface ConversationListItem {
  id: string;
  title: string;
  subject: string | null;
  primaryChannel: string;
  status: string;
  needsAttention: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  leadId: string | null;
  customerId: string | null;
  jobId: string | null;
  quoteId: string | null;
  invoiceId: string | null;
  unread: boolean;
}

const CONV_LIST_COLUMNS =
  "id, subject, primary_channel, status, needs_attention, last_message_at, last_message_preview, lead_id, customer_id, job_id, quote_id, invoice_id, created_at, lead:leads!conversations_lead_fk(title, person_name, company_name), customer:customers!conversations_customer_fk(display_name), reads:conversation_reads(last_read_at, user_id)" as const;

interface RawConv {
  id: string;
  subject: string | null;
  primary_channel: string;
  status: string;
  needs_attention: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  lead_id: string | null;
  customer_id: string | null;
  job_id: string | null;
  quote_id: string | null;
  invoice_id: string | null;
  lead: LeadName;
  customer: { display_name: string } | null;
  reads: { last_read_at: string; user_id: string }[] | null;
}

function conversationTitle(c: { subject: string | null; lead: LeadName; customer: { display_name: string } | null }): string {
  if (c.lead) return leadDisplayName(c.lead);
  if (c.customer) return c.customer.display_name;
  return c.subject || "Conversation";
}

function toListItem(c: RawConv, userId: string): ConversationListItem {
  const mine = (c.reads ?? []).find((r) => r.user_id === userId);
  return {
    id: c.id,
    title: conversationTitle(c),
    subject: c.subject,
    primaryChannel: c.primary_channel,
    status: c.status,
    needsAttention: c.needs_attention,
    lastMessageAt: c.last_message_at,
    lastMessagePreview: c.last_message_preview,
    leadId: c.lead_id,
    customerId: c.customer_id,
    jobId: c.job_id,
    quoteId: c.quote_id,
    invoiceId: c.invoice_id,
    unread: isUnread(c.last_message_at, mine?.last_read_at),
  };
}

/** How many recent conversations the Unread filter scans (unread needs a cross-table comparison). */
const UNREAD_SCAN_LIMIT = 300;

export async function listConversations(
  ctx: ServiceContext,
  input: ListConversationsInput = {},
): Promise<ActionResult<{ conversations: ConversationListItem[]; total: number; page: number; pageSize: number; filter: InboxFilter }>> {
  if (!ctx.permissions.can("inbox.read")) return fail("You don't have access to the inbox.");
  const parsed = listConversationsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid filter");
  const { filter, q, page, pageSize } = parsed.data;

  let query = ctx.supabase.from("conversations").select(CONV_LIST_COLUMNS, { count: "exact" }).eq("organisation_id", ctx.organisationId);
  if (filter === "attention") query = query.eq("needs_attention", true).eq("status", "open");
  if (filter === "whatsapp") query = query.eq("primary_channel", "whatsapp");
  if (filter === "email") query = query.eq("primary_channel", "email");
  if (filter === "leads") query = query.not("lead_id", "is", null);
  if (filter === "unread") query = query.not("last_message_at", "is", null);
  if (q) {
    const term = sanitiseSearch(q);
    if (term) query = query.or(`subject.ilike.*${term}*,last_message_preview.ilike.*${term}*`);
  }
  query = query.order("last_message_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });

  const from = (page - 1) * pageSize;
  const { data, error, count } = filter === "unread" ? await query.limit(UNREAD_SCAN_LIMIT) : await query.range(from, from + pageSize - 1);
  if (error) {
    logServerError("inbox.list", error);
    return fail(toUserMessage(error, "We couldn't load the inbox."));
  }
  let items = ((data ?? []) as unknown as RawConv[]).map((c) => toListItem(c, ctx.userId));
  let total = count ?? 0;
  if (filter === "unread") {
    items = items.filter((c) => c.unread);
    total = items.length;
    items = items.slice(from, from + pageSize);
  }
  return ok({ conversations: items, total, page, pageSize, filter });
}

export interface LinkedEntity {
  type: "lead" | "customer" | "job" | "quote" | "invoice";
  id: string;
  label: string;
  href: string;
}

export interface MessageItem {
  id: string;
  conversationId: string;
  channel: string;
  kind: string;
  direction: string;
  status: string;
  body: string;
  senderName: string | null;
  authorUserId: string | null;
  authorName: string | null;
  isAiDraft: boolean;
  occurredAt: string;
  createdAt: string;
  metadata: Record<string, Json | undefined>;
}

export interface ConversationDetail {
  conversation: ConversationListItem & { createdAt: string };
  links: LinkedEntity[];
  /** Non-draft history, oldest first. */
  messages: MessageItem[];
  /** The viewer's own open drafts (drafts are private to their author). */
  drafts: MessageItem[];
  /** Best known contact details for hand-off links (tel:, wa.me, mailto:). */
  contact: { name: string | null; phone: string | null; email: string | null };
}

const MESSAGE_COLUMNS =
  "id, conversation_id, channel, kind, direction, status, body, sender_name, author_user_id, is_ai_draft, occurred_at, created_at, metadata, author:profiles!messages_author_user_id_fkey(display_name, first_name, last_name)" as const;

type RawMessage = Omit<MessageItem, "conversationId" | "senderName" | "authorUserId" | "authorName" | "isAiDraft" | "occurredAt" | "createdAt" | "metadata"> & {
  conversation_id: string;
  sender_name: string | null;
  author_user_id: string | null;
  is_ai_draft: boolean;
  occurred_at: string;
  created_at: string;
  metadata: Json;
  author: ProfileName;
};

function toMessage(m: RawMessage): MessageItem {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    channel: m.channel,
    kind: m.kind,
    direction: m.direction,
    status: m.status,
    body: m.body,
    senderName: m.sender_name,
    authorUserId: m.author_user_id,
    authorName: personName(m.author),
    isAiDraft: m.is_ai_draft,
    occurredAt: m.occurred_at,
    createdAt: m.created_at,
    metadata: (m.metadata && typeof m.metadata === "object" && !Array.isArray(m.metadata) ? m.metadata : {}) as Record<string, Json | undefined>,
  };
}

/** A draft that was logged as sent or discarded is kept (messages are immutable) but hidden. */
const isOpenDraft = (m: MessageItem) => m.status === "draft" && !m.metadata.logged_message_id && !m.metadata.discarded_at;

export async function getConversation(ctx: ServiceContext, id: string): Promise<ActionResult<ConversationDetail>> {
  if (!ctx.permissions.can("inbox.read")) return fail("You don't have access to the inbox.");
  if (!z.uuid().safeParse(id).success) return fail("We couldn't find that conversation.");
  const [c, msgs] = await Promise.all([
    ctx.supabase.from("conversations").select(`${CONV_LIST_COLUMNS}`).eq("organisation_id", ctx.organisationId).eq("id", id).maybeSingle(),
    ctx.supabase.from("messages").select(MESSAGE_COLUMNS).eq("organisation_id", ctx.organisationId).eq("conversation_id", id)
      .order("occurred_at", { ascending: true }).order("created_at", { ascending: true }).limit(500),
  ]);
  const error = c.error ?? msgs.error;
  if (error) {
    logServerError("inbox.get", error);
    return fail(toUserMessage(error, "We couldn't load this conversation."));
  }
  if (!c.data) return fail("We couldn't find that conversation, or you don't have access to it.");
  const raw = c.data as unknown as RawConv & { created_at: string };
  const conv = { ...toListItem(raw, ctx.userId), createdAt: raw.created_at };

  const all = ((msgs.data ?? []) as unknown as RawMessage[]).map(toMessage);
  const messages = all.filter((m) => m.status !== "draft");
  const drafts = all.filter((m) => isOpenDraft(m) && m.authorUserId === ctx.userId);

  const can = ctx.permissions.can.bind(ctx.permissions);
  const [lead, customer, job, quote, invoice] = await Promise.all([
    raw.lead_id && can("leads.read")
      ? ctx.supabase.from("leads").select("id, title, person_name, company_name, email, phone").eq("organisation_id", ctx.organisationId).eq("id", raw.lead_id).maybeSingle()
      : Promise.resolve(null),
    raw.customer_id && can("customers.read")
      ? ctx.supabase.from("customers").select("id, display_name, email, phone").eq("organisation_id", ctx.organisationId).eq("id", raw.customer_id).maybeSingle()
      : Promise.resolve(null),
    raw.job_id && ctx.permissions.canAny("jobs.read_all", "jobs.read_assigned")
      ? ctx.supabase.from("jobs").select("id, job_number, title").eq("organisation_id", ctx.organisationId).eq("id", raw.job_id).maybeSingle()
      : Promise.resolve(null),
    raw.quote_id && can("quotes.read")
      ? ctx.supabase.from("quotes").select("id, quote_number").eq("organisation_id", ctx.organisationId).eq("id", raw.quote_id).maybeSingle()
      : Promise.resolve(null),
    raw.invoice_id && can("invoices.read")
      ? ctx.supabase.from("invoices").select("id, invoice_number").eq("organisation_id", ctx.organisationId).eq("id", raw.invoice_id).maybeSingle()
      : Promise.resolve(null),
  ]);

  const links: LinkedEntity[] = [];
  if (lead?.data) links.push({ type: "lead", id: lead.data.id, label: leadDisplayName(lead.data), href: `/app/sales/leads/${lead.data.id}` });
  if (customer?.data) links.push({ type: "customer", id: customer.data.id, label: customer.data.display_name, href: `/app/sales/customers/${customer.data.id}` });
  if (job?.data) links.push({ type: "job", id: job.data.id, label: `${job.data.job_number} · ${job.data.title}`, href: `/app/work/jobs/${job.data.id}` });
  if (quote?.data) links.push({ type: "quote", id: quote.data.id, label: quote.data.quote_number, href: `/app/sales/quotes/${quote.data.id}` });
  if (invoice?.data) links.push({ type: "invoice", id: invoice.data.id, label: invoice.data.invoice_number ?? "Draft invoice", href: `/app/money/invoices/${invoice.data.id}` });

  const contact = {
    name: lead?.data ? leadDisplayName(lead.data) : (customer?.data?.display_name ?? null),
    phone: lead?.data?.phone ?? customer?.data?.phone ?? null,
    email: lead?.data?.email ?? customer?.data?.email ?? null,
  };

  return ok({ conversation: conv, links, messages, drafts, contact });
}

/** All non-draft communication on conversations linked to a lead, oldest first (lead Communication tab). */
export async function listMessagesForLead(ctx: ServiceContext, leadId: string, limit = 300): Promise<ActionResult<(MessageItem & { conversationSubject: string | null })[]>> {
  if (!ctx.permissions.can("inbox.read")) return ok([]);
  const { data: convs, error: convError } = await ctx.supabase
    .from("conversations").select("id, subject").eq("organisation_id", ctx.organisationId).eq("lead_id", leadId).limit(50);
  if (convError) {
    logServerError("inbox.leadConversations", convError);
    return fail(toUserMessage(convError, "We couldn't load communication."));
  }
  if (!convs || convs.length === 0) return ok([]);
  const subjects = new Map(convs.map((c) => [c.id, c.subject]));
  const { data, error } = await ctx.supabase
    .from("messages").select(MESSAGE_COLUMNS).eq("organisation_id", ctx.organisationId)
    .in("conversation_id", convs.map((c) => c.id)).neq("status", "draft")
    .order("occurred_at", { ascending: true }).limit(Math.min(limit, 500));
  if (error) {
    logServerError("inbox.leadMessages", error);
    return fail(toUserMessage(error, "We couldn't load communication."));
  }
  return ok(((data ?? []) as unknown as RawMessage[]).map((m) => ({ ...toMessage(m), conversationSubject: subjects.get(m.conversation_id) ?? null })));
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

const noWrite = () => fail("You don't have permission to log communication.");

/**
 * Log a call / note / meeting / message / email that happened outside Veritaro.
 * Finds or creates the conversation for the linked record (lead first, then customer).
 */
export async function logCommunication(ctx: ServiceContext, input: LogCommunicationInput): Promise<ActionResult<{ conversationId: string; messageId: string }>> {
  if (!ctx.permissions.can("inbox.write")) return noWrite();
  const parsed = logCommunicationSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;
  const { data, error } = await ctx.supabase.rpc("log_communication", {
    p_organisation_id: ctx.organisationId,
    p_body: v.body,
    p_kind: v.kind,
    p_direction: v.direction,
    p_customer_id: v.customerId ?? undefined,
    p_lead_id: v.leadId ?? undefined,
    p_job_id: v.jobId ?? undefined,
    p_quote_id: v.quoteId ?? undefined,
    p_invoice_id: v.invoiceId ?? undefined,
    p_conversation_id: v.conversationId ?? undefined,
    p_occurred_at: v.occurredAt ?? undefined,
    p_subject: v.subject ?? undefined,
  });
  if (error) {
    logServerError("inbox.log", error);
    return fail(toUserMessage(error, "We couldn't log that."));
  }
  const r = z.object({ conversation_id: z.uuid(), message_id: z.uuid() }).safeParse(data);
  if (!r.success) return fail("We couldn't log that.");
  return ok({ conversationId: r.data.conversation_id, messageId: r.data.message_id });
}

/** Per-user read marker (drives the Unread filter). */
export async function markConversationRead(ctx: ServiceContext, conversationId: string): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("inbox.read")) return fail("You don't have access to the inbox.");
  const { error } = await ctx.supabase.from("conversation_reads").upsert(
    { conversation_id: conversationId, user_id: ctx.userId, organisation_id: ctx.organisationId, last_read_at: new Date().toISOString() },
    { onConflict: "conversation_id,user_id" },
  );
  if (error) {
    logServerError("inbox.read", error);
    return fail(toUserMessage(error, "We couldn't mark it as read."));
  }
  return ok({ id: conversationId });
}

/** "Mark done" clears needs_attention; pass true to flag it again. */
export async function setConversationAttention(ctx: ServiceContext, conversationId: string, needsAttention: boolean): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("inbox.write")) return fail("You don't have permission to change conversations.");
  const { data, error } = await ctx.supabase.from("conversations").update({ needs_attention: needsAttention })
    .eq("organisation_id", ctx.organisationId).eq("id", conversationId).select("id").maybeSingle();
  if (error) {
    logServerError("inbox.attention", error);
    return fail(toUserMessage(error, "We couldn't update the conversation."));
  }
  if (!data) return fail("We couldn't find that conversation.");
  return ok({ id: data.id });
}

export const markConversationDone = (ctx: ServiceContext, conversationId: string) => setConversationAttention(ctx, conversationId, false);

/**
 * Save an OUTBOUND DRAFT reply. Nothing is sent: no channel is connected. The draft is private to its author.
 * Manual conversations get a draft for the channel the user intends to use (default WhatsApp), because
 * guard_messages turns every 'manual' insert into a logged record.
 */
export async function createDraftReply(ctx: ServiceContext, input: DraftReplyInput & { isAiDraft?: boolean }): Promise<ActionResult<{ id: string; channel: string }>> {
  if (!ctx.permissions.can("inbox.write")) return fail("You don't have permission to draft replies.");
  const parsed = draftReplySchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const { conversationId, body, channel: requested } = parsed.data;
  const { data: conv, error: convError } = await ctx.supabase.from("conversations").select("id, primary_channel")
    .eq("organisation_id", ctx.organisationId).eq("id", conversationId).maybeSingle();
  if (convError) {
    logServerError("inbox.draft.conv", convError);
    return fail(toUserMessage(convError, "We couldn't save the draft."));
  }
  if (!conv) return fail("We couldn't find that conversation.");
  const channel = draftChannelFor(conv.primary_channel, requested);
  const { data, error } = await ctx.supabase.from("messages").insert({
    organisation_id: ctx.organisationId,
    conversation_id: conversationId,
    channel,
    kind: channel === "email" ? "email" : "message",
    direction: "outbound",
    status: "draft",
    body,
    is_ai_draft: !!input.isAiDraft,
  }).select("id, channel, status").single();
  if (error) {
    logServerError("inbox.draft", error);
    return fail(toUserMessage(error, "We couldn't save the draft."));
  }
  if (data.status !== "draft") {
    // Defence in depth: never let a "draft" become anything else silently.
    logServerError("inbox.draft.status", { message: `Draft saved with status ${data.status}` });
    return fail("We couldn't save the draft.");
  }
  return ok({ id: data.id, channel: data.channel });
}

async function readOwnDraft(ctx: ServiceContext, messageId: string) {
  return ctx.supabase.from("messages").select("id, conversation_id, channel, body, metadata, status, author_user_id")
    .eq("organisation_id", ctx.organisationId).eq("id", messageId).eq("status", "draft").eq("author_user_id", ctx.userId).maybeSingle();
}

const metaObject = (m: Json) => (m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, Json>) : {});

/** Hide a draft (messages are immutable; it is marked discarded, never deleted). */
export async function discardDraft(ctx: ServiceContext, messageId: string): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("inbox.write")) return noWrite();
  const { data: d, error: e1 } = await readOwnDraft(ctx, messageId);
  if (e1 || !d) return fail(e1 ? toUserMessage(e1, "We couldn't discard the draft.") : "We couldn't find that draft.");
  const { error } = await ctx.supabase.from("messages").update({ metadata: { ...metaObject(d.metadata), discarded_at: new Date().toISOString() } })
    .eq("organisation_id", ctx.organisationId).eq("id", messageId);
  if (error) {
    logServerError("inbox.draft.discard", error);
    return fail(toUserMessage(error, "We couldn't discard the draft."));
  }
  return ok({ id: messageId });
}

/**
 * The user sent the draft themselves (phone/WhatsApp/email app): record it as a logged outbound
 * message via log_communication, then hide the draft. Honest: Veritaro did not send it.
 */
export async function logDraftAsSent(ctx: ServiceContext, messageId: string): Promise<ActionResult<{ conversationId: string; messageId: string }>> {
  if (!ctx.permissions.can("inbox.write")) return noWrite();
  const { data: d, error: e1 } = await readOwnDraft(ctx, messageId);
  if (e1 || !d) return fail(e1 ? toUserMessage(e1, "We couldn't log the message.") : "We couldn't find that draft.");
  const logged = await logCommunication(ctx, {
    conversationId: d.conversation_id,
    body: d.body,
    kind: d.channel === "email" ? "email" : "message",
    direction: "outbound",
  });
  if (!logged.ok) return logged;
  const { error } = await ctx.supabase.from("messages")
    .update({ metadata: { ...metaObject(d.metadata), logged_message_id: logged.data.messageId, logged_channel: d.channel } })
    .eq("organisation_id", ctx.organisationId).eq("id", messageId);
  if (error) logServerError("inbox.draft.consume", error); // the log succeeded; a visible leftover draft is harmless
  return logged;
}
