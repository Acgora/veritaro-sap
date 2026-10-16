import Link from "next/link";
import { AlertTriangle, ChevronRight, CircleAlert, CircleCheck, Info } from "lucide-react";
import type { AttentionItem } from "@/domain/today/service";
import { cn } from "@/lib/utils";

const ICON = { danger: CircleAlert, warning: AlertTriangle, info: Info } as const;
const TONE = {
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-primary",
} as const;

/** Prioritised, actionable list built by buildAttentionItems. Each row links straight to the fix. */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
        <span className="rounded-full bg-success-soft p-2 text-success"><CircleCheck className="size-5" aria-hidden /></span>
        <div>
          <p className="text-sm font-medium">Nothing needs your attention right now</p>
          <p className="text-sm text-muted-foreground">Overdue invoices, unanswered quotes, new leads and unassigned jobs will show up here.</p>
        </div>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {items.map((i) => {
        const Icon = ICON[i.severity];
        return (
          <li key={i.key}>
            <Link href={i.href} className="flex min-h-14 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-raised">
              <span className={cn("shrink-0 rounded-md p-1.5", TONE[i.severity])}>
                <Icon className="size-4" aria-hidden />
                <span className="sr-only">{i.severity === "danger" ? "Urgent" : i.severity === "warning" ? "Needs action" : "For information"}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{i.title}</span>
                {i.detail ? <span className="block truncate text-xs text-muted-foreground">{i.detail}</span> : null}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
