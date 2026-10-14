"use client";
import { useRef, useState, useTransition } from "react";
import { Mic, Paperclip, SendHorizontal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { askAssistantAction } from "@/app/app/actions";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";

interface Exchange {
  id: number;
  question: string;
  reply: string;
  available: boolean;
}

/**
 * Persistent AI command input. Phase 001: UI + transport only. Replies come from
 * handleCommand(), which honestly reports that no model is connected.
 */
function CommandInput({ onSubmitted, autoFocus }: { onSubmitted: (e: Exchange) => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const counter = useRef(0);

  const submit = () => {
    const q = text.trim();
    if (!q || pending) return;
    start(async () => {
      const res = await askAssistantAction(q);
      onSubmitted({ id: ++counter.current, question: q, reply: res.message, available: res.status === "answer" });
      setText("");
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 shadow-sm focus-within:outline-2 focus-within:outline-ring"
    >
      <Sparkles className="ml-1 size-4 shrink-0 text-primary" aria-hidden />
      <label htmlFor="ai-command" className="sr-only">Ask your business anything</label>
      <input
        id="ai-command"
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={4000}
        placeholder="Ask your business anything…"
        className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground"
        autoComplete="off"
      />
      <Button variant="ghost" size="icon" className="size-8" disabled title="Voice input — coming soon" aria-label="Voice input (coming soon)">
        <Mic />
      </Button>
      <Button variant="ghost" size="icon" className="size-8" disabled title="Attachments — coming soon" aria-label="Attach file (coming soon)">
        <Paperclip />
      </Button>
      <Button type="submit" size="icon" className="size-8" disabled={!text.trim() || pending} aria-label="Send">
        <SendHorizontal />
      </Button>
    </form>
  );
}

function Replies({ items }: { items: Exchange[] }) {
  if (items.length === 0) return null;
  const last = items[items.length - 1]!;
  return (
    <div role="status" aria-live="polite" className="mb-2 rounded-md border border-border bg-surface p-3 text-sm shadow-sm">
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">You:</span> {last.question}
      </p>
      <p className={cn("mt-1", !last.available && "text-warning")}>{last.reply}</p>
    </div>
  );
}

/** Desktop: docked at the bottom of the workspace. */
export function AICommandBar() {
  const [items, setItems] = useState<Exchange[]>([]);
  return (
    <div className="pointer-events-none sticky bottom-0 z-20 hidden px-6 pb-4 pt-2 md:block">
      <div className="pointer-events-auto mx-auto max-w-2xl">
        <Replies items={items} />
        <CommandInput onSubmitted={(e) => setItems((s) => [...s.slice(-4), e])} />
      </div>
    </div>
  );
}

/** Mobile + ⌘K "Ask": full dialog version of the same component. */
export function AskDialog() {
  const { askOpen, setAskOpen } = useShell();
  const [items, setItems] = useState<Exchange[]>([]);
  return (
    <Dialog open={askOpen} onOpenChange={setAskOpen}>
      <DialogContent title="Ask AI" description="Your assistant will be able to answer questions and prepare drafts. It never sends anything without your confirmation.">
        <Replies items={items} />
        <CommandInput autoFocus onSubmitted={(e) => setItems((s) => [...s.slice(-4), e])} />
      </DialogContent>
    </Dialog>
  );
}
