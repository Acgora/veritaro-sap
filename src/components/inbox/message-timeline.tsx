import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { describeMessage } from "@/domain/inbox/schema";
import type { MessageItem } from "@/domain/inbox/service";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** Message history. Inbound on the left, outbound on the right, internal notes full-width. */
export function MessageTimeline({
  messages,
  timeZone,
  emptyTitle = "Nothing logged yet",
  emptyDescription = "Log calls, meetings and messages here so everyone can see what was said.",
}: {
  messages: (MessageItem & { conversationSubject?: string | null })[];
  timeZone: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (messages.length === 0) {
    return <EmptyState compact icon={MessageSquare} title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <ol className="flex flex-col gap-3" aria-label="Messages">
      {messages.map((m) => {
        const inbound = m.direction === "inbound";
        const internal = m.direction === "internal";
        return (
          <li key={m.id} className={cn("flex", inbound ? "justify-start" : internal ? "justify-center" : "justify-end")}>
            <article
              className={cn(
                "max-w-[90%] rounded-lg border px-3 py-2 text-sm sm:max-w-[80%]",
                inbound && "border-border bg-surface",
                !inbound && !internal && "border-primary/20 bg-info-soft",
                internal && "w-full border-dashed border-border bg-muted/50",
              )}
            >
              <header className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{describeMessage(m)}</span>
                {m.isAiDraft ? <StatusBadge tone="info">AI draft</StatusBadge> : null}
                <span>· {m.senderName ?? m.authorName ?? "Someone"}</span>
                <time dateTime={m.occurredAt}>· {formatDateTime(m.occurredAt, timeZone)}</time>
                {m.conversationSubject ? <span>· {m.conversationSubject}</span> : null}
              </header>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
