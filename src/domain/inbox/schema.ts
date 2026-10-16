import { z } from "zod";

/** Kinds a person can log by hand ('event' is system-only). */
export const LOGGABLE_KINDS = ["note", "call", "meeting", "message", "email"] as const;
export const DIRECTIONS = ["inbound", "outbound", "internal"] as const;
export const CHANNELS = ["email", "whatsapp", "web", "manual", "system"] as const;
/** Channels a draft can be written for (no provider is connected — drafts are copied/sent by hand). */
export const DRAFT_CHANNELS = ["whatsapp", "email"] as const;
export const INBOX_FILTERS = ["all", "unread", "attention", "whatsapp", "email", "leads"] as const;

export type LoggableKind = (typeof LOGGABLE_KINDS)[number];
export type Direction = (typeof DIRECTIONS)[number];
export type Channel = (typeof CHANNELS)[number];
export type DraftChannel = (typeof DRAFT_CHANNELS)[number];
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const KIND_LABELS: Record<LoggableKind | "event", string> = {
  note: "Note", call: "Call", meeting: "Meeting", message: "Message", email: "Email", event: "Event",
};
export const DIRECTION_LABELS: Record<Direction, string> = { inbound: "From customer", outbound: "To customer", internal: "Internal" };
export const CHANNEL_LABELS: Record<Channel, string> = {
  email: "Email", whatsapp: "WhatsApp", web: "Website", manual: "Logged manually", system: "System",
};
export const MESSAGE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft — not sent", queued: "Queued", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed",
  received: "Received", logged: "Logged",
};
export const INBOX_FILTER_LABELS: Record<InboxFilter, string> = {
  all: "All", unread: "Unread", attention: "Needs attention", whatsapp: "WhatsApp", email: "Email", leads: "Leads",
};

const optUuid = z
  .union([z.uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const optDateTime = z
  .union([z.iso.datetime({ offset: true }), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const body = z.string().trim().min(1, "Write what was said").max(20000, "Keep it under 20,000 characters");

export const logCommunicationSchema = z
  .object({
    body,
    kind: z.enum(LOGGABLE_KINDS).default("note"),
    direction: z.enum(DIRECTIONS).default("internal"),
    occurredAt: optDateTime,
    subject: z.string().trim().max(300).optional().nullable().transform((v) => (v ? v : null)),
    conversationId: optUuid,
    leadId: optUuid,
    customerId: optUuid,
    jobId: optUuid,
    quoteId: optUuid,
    invoiceId: optUuid,
  })
  .superRefine((v, c) => {
    if (v.occurredAt && new Date(v.occurredAt).getTime() > Date.now() + 5 * 60_000) {
      c.addIssue({ code: "custom", path: ["occurredAt"], message: "That time is in the future" });
    }
  });

export const draftReplySchema = z.object({
  conversationId: z.uuid(),
  body: z.string().trim().min(1, "Write a reply first").max(20000),
  channel: z.enum(DRAFT_CHANNELS).optional(),
});

export const listConversationsSchema = z.object({
  filter: z.enum(INBOX_FILTERS).default("all"),
  q: z.string().trim().max(100).optional().transform((v) => (v ? v : undefined)),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export type LogCommunicationInput = z.input<typeof logCommunicationSchema>;
export type DraftReplyInput = z.input<typeof draftReplySchema>;
export type ListConversationsInput = z.input<typeof listConversationsSchema>;

// -----------------------------------------------------------------------------
// Pure helpers (client-safe)
// -----------------------------------------------------------------------------

/** Unread when there is a (non-draft) message newer than the user's last read. */
export function isUnread(lastMessageAt: string | null, lastReadAt: string | null | undefined): boolean {
  if (!lastMessageAt) return false;
  if (!lastReadAt) return true;
  return new Date(lastMessageAt).getTime() > new Date(lastReadAt).getTime();
}

/** Channel a reply draft should use: the conversation's own, if it is a messaging channel. */
export function draftChannelFor(primaryChannel: string, requested?: DraftChannel): DraftChannel {
  if (primaryChannel === "whatsapp" || primaryChannel === "email") return primaryChannel;
  return requested ?? "whatsapp";
}

/** Short, honest label for a message: e.g. "Call · To customer · Logged". */
export function describeMessage(m: { kind: string; direction: string; channel: string; status: string }): string {
  const kind = KIND_LABELS[m.kind as LoggableKind] ?? m.kind;
  const dir = DIRECTION_LABELS[m.direction as Direction] ?? m.direction;
  const status = m.channel === "manual" ? "Logged" : (MESSAGE_STATUS_LABELS[m.status] ?? m.status);
  const channel = m.channel === "manual" || m.channel === "system" ? null : CHANNEL_LABELS[m.channel as Channel];
  return [kind, channel, m.direction === "internal" ? null : dir, status].filter(Boolean).join(" · ");
}
