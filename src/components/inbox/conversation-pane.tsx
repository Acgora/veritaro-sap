"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Briefcase, Check, Copy, FileText, Mail, MessageCircle, Phone, Receipt, Send, Target, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/common/status-badge";
import { CHANNEL_LABELS, DRAFT_CHANNELS, type Channel, type DraftChannel } from "@/domain/inbox/schema";
import type { ConversationDetail, LinkedEntity } from "@/domain/inbox/service";
import { whatsappLink } from "@/domain/leads/rules";
import { formatDateTime } from "@/lib/dates";
import {
  createDraftReplyAction, discardDraftAction, logCommunicationAction, logDraftAsSentAction, markConversationReadAction,
  setConversationAttentionAction,
} from "@/app/app/inbox/actions";
import { MessageTimeline } from "./message-timeline";
import { LogCommunicationForm } from "./log-communication-form";
import { AiAssistantPanel } from "./ai-assistant-panel";

const LINK_ICONS: Record<LinkedEntity["type"], typeof Users> = { lead: Target, customer: Users, job: Briefcase, quote: FileText, invoice: Receipt };

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied — paste it into WhatsApp or your email");
  } catch {
    toast.error("Couldn't copy. Select the text and copy it manually.");
  }
}

export function ConversationPane({
  detail,
  timeZone,
  canWrite,
  aiEnabled,
  backHref,
}: {
  detail: ConversationDetail;
  timeZone: string;
  canWrite: boolean;
  aiEnabled: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const c = detail.conversation;
  const [pending, start] = useTransition();
  const [reply, setReply] = useState("");
  const [draftChannel, setDraftChannel] = useState<DraftChannel>(c.primaryChannel === "email" ? "email" : "whatsapp");
  const messagingChannel = c.primaryChannel === "whatsapp" || c.primaryChannel === "email";
  const leadId = detail.links.find((l) => l.type === "lead")?.id ?? null;
  const markedRef = useRef<string | null>(null);

  // Mark as read automatically when the conversation is opened.
  useEffect(() => {
    if (markedRef.current === c.id) return;
    markedRef.current = c.id;
    const wasUnread = c.unread;
    void markConversationReadAction(c.id).then((r) => {
      if (r.ok && wasUnread) router.refresh();
    });
  }, [c.id, c.unread, router]);

  const channel: DraftChannel = messagingChannel ? (c.primaryChannel as DraftChannel) : draftChannel;
  const wa = whatsappLink(detail.contact.phone, reply || undefined);
  const mailto = detail.contact.email
    ? `mailto:${detail.contact.email}?${new URLSearchParams({ subject: c.subject ?? "", body: reply }).toString().replace(/\+/g, "%20")}`
    : null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(msg);
        after?.();
      } else toast.error((r as { error: string }).error);
    });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline md:hidden">
          <ArrowLeft className="size-4" aria-hidden /> All conversations
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{c.title}</h2>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {c.subject && c.subject !== c.title ? <span>{c.subject}</span> : null}
              <span>{CHANNEL_LABELS[c.primaryChannel as Channel] ?? c.primaryChannel}</span>
              {c.status === "closed" ? <StatusBadge>Closed</StatusBadge> : null}
              {c.needsAttention ? <StatusBadge tone="warning">Needs attention</StatusBadge> : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {detail.contact.phone ? <Button asChild variant="secondary" size="sm"><a href={`tel:${detail.contact.phone}`}><Phone /> Call</a></Button> : null}
            {canWrite && c.needsAttention ? (
              <Button size="sm" disabled={pending} onClick={() => run(() => setConversationAttentionAction(c.id, false), "Marked done")}>
                <Check /> Mark done
              </Button>
            ) : null}
          </div>
        </div>
        {detail.links.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Linked records">
            {detail.links.map((l) => {
              const Icon = LINK_ICONS[l.type];
              return (
                <li key={`${l.type}-${l.id}`}>
                  <Link href={l.href} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs hover:bg-surface-raised">
                    <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                    <span className="sr-only">{l.type}: </span>{l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </header>

      <AiAssistantPanel enabled={aiEnabled} />

      <section aria-label="Conversation history" className="rounded-lg border border-border bg-surface p-3">
        <MessageTimeline messages={detail.messages} timeZone={timeZone} />
      </section>

      {canWrite ? (
        <section aria-labelledby="reply-heading" className="rounded-lg border border-border bg-surface p-3">
          <h3 id="reply-heading" className="text-sm font-semibold">Reply</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">No channel connected yet — copy the text or send it from your phone, then log it.</p>
          <label htmlFor="reply-body" className="sr-only">Reply text</label>
          <Textarea id="reply-body" className="mt-2" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={20000} placeholder="Write your reply…" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {!messagingChannel ? (
              <>
                <label htmlFor="draft-channel" className="text-xs text-muted-foreground">Draft for</label>
                <Select id="draft-channel" value={draftChannel} onChange={(e) => setDraftChannel(e.target.value as DraftChannel)} className="h-9 w-32">
                  {DRAFT_CHANNELS.map((ch) => <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}</option>)}
                </Select>
              </>
            ) : null}
            <Button variant="secondary" size="sm" disabled={pending || !reply.trim()}
              onClick={() => run(() => createDraftReplyAction({ conversationId: c.id, body: reply, channel }), "Draft saved (not sent)", () => setReply(""))}>
              Save draft
            </Button>
            <Button variant="secondary" size="sm" disabled={!reply.trim()} onClick={() => copy(reply)}><Copy /> Copy text</Button>
            {wa && channel === "whatsapp" ? (
              <Button asChild variant="secondary" size="sm"><a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle /> Open WhatsApp</a></Button>
            ) : null}
            {mailto && channel === "email" ? (
              <Button asChild variant="secondary" size="sm"><a href={mailto}><Mail /> Open email</a></Button>
            ) : null}
            <Button size="sm" disabled={pending || !reply.trim()}
              onClick={() => run(
                () => logCommunicationAction({ conversationId: c.id, leadId, body: reply, kind: channel === "email" ? "email" : "message", direction: "outbound" }),
                "Logged as sent by you",
                () => setReply(""),
              )}>
              <Check /> I sent it — log it
            </Button>
            <Button size="sm" variant="outline" disabled title="No channel connected yet"><Send /> Send through connected channel</Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Send through connected channel: no channel connected yet.</p>

          {detail.drafts.length > 0 ? (
            <div className="mt-3 border-t border-border pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your drafts (only you can see these)</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {detail.drafts.map((d) => (
                  <li key={d.id} className="rounded-md border border-dashed border-border p-2 text-sm">
                    <p className="mb-1 text-xs text-muted-foreground">
                      Draft — not sent · {CHANNEL_LABELS[d.channel as Channel] ?? d.channel} · {formatDateTime(d.createdAt, timeZone)}
                      {d.isAiDraft ? " · AI draft" : ""}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{d.body}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => copy(d.body)}><Copy /> Copy</Button>
                      {d.channel === "whatsapp" && whatsappLink(detail.contact.phone, d.body) ? (
                        <Button asChild variant="secondary" size="sm">
                          <a href={whatsappLink(detail.contact.phone, d.body)!} target="_blank" rel="noopener noreferrer"><MessageCircle /> Open WhatsApp</a>
                        </Button>
                      ) : null}
                      <Button size="sm" disabled={pending} onClick={() => run(() => logDraftAsSentAction(d.id, leadId), "Logged as sent by you")}>
                        <Check /> I sent it — log it
                      </Button>
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => discardDraftAction(d.id), "Draft discarded")}>
                        <Trash2 /> Discard
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {canWrite ? (
        <details className="rounded-lg border border-border bg-surface p-3">
          <summary className="cursor-pointer text-sm font-semibold">Log communication</summary>
          <p className="mt-1 text-xs text-muted-foreground">Record a call, meeting or message that happened outside Veritaro.</p>
          <div className="mt-3">
            <LogCommunicationForm idPrefix={`conv-${c.id}`} link={{ conversationId: c.id, leadId }} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
