import { Sparkles } from "lucide-react";

/**
 * Container for the future AI morning briefing. Accepts a briefing when one exists;
 * otherwise shows an honest onboarding state. Never renders invented content.
 */
export function AIBriefing({ briefing }: { briefing?: { generatedAt: string; points: string[] } | null }) {
  return (
    <section aria-labelledby="briefing-heading" className="rounded-lg border border-border bg-info-soft/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 id="briefing-heading" className="text-sm font-semibold">AI briefing</h2>
      </div>
      {briefing && briefing.points.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {briefing.points.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Your assistant will highlight what matters each morning here — overdue invoices, unanswered leads, quotes to chase,
          today&apos;s jobs and upcoming deadlines. It isn&apos;t switched on yet.
        </p>
      )}
    </section>
  );
}
