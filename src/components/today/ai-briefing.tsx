"use client";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { summariseTodayAction } from "@/app/app/today/actions";

/**
 * Today briefing. The deterministic sentence (built from attention items, no AI) is ALWAYS
 * shown. "Summarise with AI" asks the gateway to rephrase/prioritise those same items;
 * the AI never sees raw records and never computes numbers.
 *
 * `briefing` is kept from the Phase 001 contract: a pre-generated briefing, if any.
 */
export function AIBriefing({
  sentence,
  briefing = null,
  ai,
}: {
  sentence: string;
  briefing?: { generatedAt: string; points: string[] } | null;
  ai: { allowed: boolean; configured: boolean; hasItems: boolean };
}) {
  const [pending, start] = useTransition();
  const [aiText, setAiText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disabledReason = !ai.configured ? "AI isn't set up for your organisation yet." : null;

  return (
    <section aria-labelledby="briefing-heading" className="rounded-lg border border-border bg-info-soft/40 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <h2 id="briefing-heading" className="text-sm font-semibold">Briefing</h2>
        </div>
        {ai.allowed && ai.hasItems ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !!disabledReason}
            title={disabledReason ?? undefined}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await summariseTodayAction();
                if (r.ok) setAiText(r.data.text);
                else setError(r.error);
              })
            }
          >
            <Sparkles /> {pending ? "Summarising…" : aiText ? "Summarise again" : "Summarise with AI"}
          </Button>
        ) : null}
      </div>
      <p className="text-sm">{sentence}</p>
      {briefing && briefing.points.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {briefing.points.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      ) : null}
      {aiText ? (
        <div className="mt-3 border-t border-border pt-3" aria-live="polite">
          <p className="mb-1 text-xs font-medium text-muted-foreground">AI summary · based only on the items above</p>
          <p className="text-sm">{aiText}</p>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm text-muted-foreground" role="status">{error}</p> : null}
      {disabledReason && ai.allowed && ai.hasItems ? <p className="mt-2 text-xs text-muted-foreground">{disabledReason}</p> : null}
    </section>
  );
}
