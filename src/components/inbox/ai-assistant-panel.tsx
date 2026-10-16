"use client";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/shell/shell-context";

/**
 * Placeholder for conversation AI (summary / suggested reply). Opens the global assistant.
 * The shell can't take a prefilled prompt yet, so the user types the request themselves.
 */
export function AiAssistantPanel({ enabled, existingSummary }: { enabled: boolean; existingSummary?: string | null }) {
  const { openAsk } = useShell();
  return (
    <section aria-labelledby="ai-panel-heading" className="rounded-lg border border-border bg-surface p-3">
      <h2 id="ai-panel-heading" className="flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4 text-primary" aria-hidden /> AI assistant
      </h2>
      {existingSummary ? <p className="mt-1 whitespace-pre-wrap text-sm">{existingSummary}</p> : null}
      <p className="mt-1 text-sm text-muted-foreground">Ask the assistant to summarise this conversation or draft a reply</p>
      {enabled ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={openAsk}>
          <Sparkles /> Ask the assistant
        </Button>
      ) : null}
    </section>
  );
}
