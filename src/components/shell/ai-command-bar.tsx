"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ExternalLink, Mic, Paperclip, SendHorizontal, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  askAssistantAction, cancelAssistantActionAction, confirmAssistantActionAction, undoAssistantCardAction,
} from "@/app/app/actions";
import type { AssistantReply } from "@/lib/ai/orchestrator";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";

interface Exchange {
  id: number;
  question: string;
  reply: AssistantReply;
}

function useAssistant() {
  const [items, setItems] = useState<Exchange[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const counter = useRef(0);
  const push = (question: string, reply: AssistantReply) => {
    if (reply.conversationId) setConversationId(reply.conversationId);
    setItems((s) => [...s.slice(-4), { id: ++counter.current, question, reply }]);
  };
  return { items, conversationId, push, reset: () => { setItems([]); setConversationId(undefined); } };
}

function CommandInput({ onSubmit, pending, autoFocus }: { onSubmit: (text: string) => void; pending: boolean; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        if (!q || pending) return;
        onSubmit(q);
        setText("");
      }}
      className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 shadow-sm focus-within:outline-2 focus-within:outline-ring"
    >
      <Sparkles className="ml-1 size-4 shrink-0 text-primary" aria-hidden />
      <label htmlFor={autoFocus ? "ai-command-dialog" : "ai-command"} className="sr-only">Ask your business anything</label>
      <input
        id={autoFocus ? "ai-command-dialog" : "ai-command"}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        placeholder={pending ? "Working…" : "Ask your business anything…"}
        className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground"
        autoComplete="off"
      />
      <Button variant="ghost" size="icon" className="size-8" disabled title="Voice input — coming soon" aria-label="Voice input (coming soon)"><Mic /></Button>
      <Button variant="ghost" size="icon" className="size-8" disabled title="Attachments — coming soon" aria-label="Attach file (coming soon)"><Paperclip /></Button>
      <Button type="submit" size="icon" className="size-8" disabled={!text.trim() || pending} aria-label="Send"><SendHorizontal /></Button>
    </form>
  );
}

function Replies({ items, onConfirm, onCancel, onUndo, pending }: {
  items: Exchange[];
  onConfirm: (actionId: string) => void;
  onCancel: (actionId: string) => void;
  onUndo: (kind: "customer" | "task", id: string) => void;
  pending: boolean;
}) {
  if (items.length === 0) return null;
  const last = items[items.length - 1]!;
  const r = last.reply;
  const muted = r.status === "unavailable" || r.status === "blocked" || r.status === "error";
  return (
    <div role="status" aria-live="polite" className="mb-2 rounded-md border border-border bg-surface p-3 text-sm shadow-sm">
      <p className="text-muted-foreground"><span className="font-medium text-foreground">You:</span> {last.question}</p>
      <p className={cn("mt-1 whitespace-pre-wrap", muted && "text-warning")}>{r.message}</p>
      {r.cards.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {r.cards.map((c, i) => (
            <li key={i} className="flex items-center gap-1 rounded-md border border-border bg-surface-raised px-2 py-1">
              <Link href={c.href} className="inline-flex items-center gap-1 text-primary hover:underline">{c.label} <ExternalLink className="size-3" aria-hidden /></Link>
              {c.undo ? (
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" disabled={pending} onClick={() => onUndo(c.undo!.kind, c.undo!.id)}>
                  <Undo2 className="size-3" /> Undo
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {r.confirmation ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning-soft p-2">
          <span className="flex-1 font-medium">{r.confirmation.summary}?</span>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => onCancel(r.confirmation!.actionId)}>Cancel</Button>
          <Button size="sm" variant="danger" disabled={pending} onClick={() => onConfirm(r.confirmation!.actionId)}>Confirm</Button>
        </div>
      ) : null}
    </div>
  );
}

function useAssistantHandlers(a: ReturnType<typeof useAssistant>) {
  const router = useRouter();
  const pathname = usePathname();
  // Plain state, not useTransition: router.refresh() started inside an async transition is entangled with it,
  // and when Next discards that refresh (e.g. superseded by a prefetch/revalidation) isPending never clears —
  // the bar stayed on "Working…" with Send disabled. Busy now covers only the assistant request itself.
  const [pending, setPending] = useState(false);
  const start = (task: () => Promise<void>) => {
    setPending(true);
    task()
      .catch(() => toast.error("The assistant isn't available right now. Everything else works normally."))
      .finally(() => setPending(false));
  };
  const ask = (text: string) =>
    start(async () => {
      try {
        // Pathname is only a hint; the server re-verifies the entity through RLS.
        const reply = await askAssistantAction(text, a.conversationId, pathname);
        a.push(text, reply);
        if (reply.cards.length) router.refresh();
      } catch {
        a.push(text, { status: "unavailable", message: "The assistant isn't available right now. Everything else works normally.", cards: [] });
      }
    });
  const confirm = (id: string) =>
    start(async () => {
      const reply = await confirmAssistantActionAction(id);
      a.push("Confirm", reply);
      router.refresh();
    });
  const cancel = (id: string) =>
    start(async () => {
      a.push("Cancel", await cancelAssistantActionAction(id));
    });
  const undo = (kind: "customer" | "task", id: string) =>
    start(async () => {
      const r = await undoAssistantCardAction(kind, id);
      if (r.ok) toast.success(kind === "customer" ? "Customer removed (archived)" : "Task archived");
      else toast.error(r.error);
      router.refresh();
    });
  return { pending, ask, confirm, cancel, undo };
}

/** Desktop: docked at the bottom of the workspace. */
export function AICommandBar({ enabled }: { enabled: boolean }) {
  const a = useAssistant();
  const h = useAssistantHandlers(a);
  if (!enabled) return null;
  return (
    <div className="pointer-events-none sticky bottom-0 z-20 hidden px-6 pb-4 pt-2 md:block">
      <div className="pointer-events-auto mx-auto max-w-2xl">
        <Replies items={a.items} onConfirm={h.confirm} onCancel={h.cancel} onUndo={h.undo} pending={h.pending} />
        <CommandInput onSubmit={h.ask} pending={h.pending} />
      </div>
    </div>
  );
}

/** Mobile + ⌘K "Ask": dialog version sharing the same handlers. */
export function AskDialog({ enabled }: { enabled: boolean }) {
  const { askOpen, setAskOpen } = useShell();
  const a = useAssistant();
  const h = useAssistantHandlers(a);
  return (
    <Dialog open={askOpen} onOpenChange={setAskOpen}>
      <DialogContent title="Ask AI" description="The assistant can find and prepare records. It never sends or deletes anything without your confirmation.">
        {enabled ? (
          <>
            <Replies items={a.items} onConfirm={h.confirm} onCancel={h.cancel} onUndo={h.undo} pending={h.pending} />
            <CommandInput onSubmit={h.ask} pending={h.pending} autoFocus />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">The AI assistant isn&apos;t included in your role.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
