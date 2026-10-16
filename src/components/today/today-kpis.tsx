import Link from "next/link";
import type { TodayKpi } from "@/domain/today/service";
import { cn } from "@/lib/utils";

/** KPI row — each tile is a link to the filtered list behind the number. Only sections the user may see are passed in. */
export function TodayKpis({ kpis }: { kpis: TodayKpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Key numbers">
      {kpis.map((k) => (
        <li key={k.key}>
          <Link
            href={k.href}
            className="flex h-full flex-col rounded-lg border border-border bg-surface p-3 transition-colors hover:bg-surface-raised"
          >
            <span className="text-xs text-muted-foreground">{k.label}</span>
            <span
              className={cn(
                "text-lg font-semibold leading-tight tabular-nums",
                k.tone === "danger" && "text-danger",
                k.tone === "warning" && "text-warning",
              )}
            >
              {k.value}
            </span>
            {k.hint ? <span className="truncate text-xs text-muted-foreground">{k.hint}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
