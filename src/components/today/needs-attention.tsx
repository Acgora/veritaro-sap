import Link from "next/link";
import { AlertTriangle, Banknote, Briefcase, CalendarCheck, FileSignature, Target, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Tile {
  label: string;
  icon: LucideIcon;
  href: string;
  /** null = module not available yet (no fake numbers). */
  value: number | null;
  hint: string;
  tone?: "default" | "warning";
}

function AttentionTile({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  return (
    <Link
      href={tile.href}
      className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:bg-surface-raised"
    >
      <span className={cn("rounded-md p-1.5", tile.tone === "warning" && tile.value ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{tile.label}</span>
        {tile.value === null ? (
          <span className="block text-sm text-muted-foreground">Not set up yet</span>
        ) : (
          <span className="block text-lg font-semibold tabular-nums leading-tight">{tile.value}</span>
        )}
        <span className="block truncate text-xs text-muted-foreground">{tile.hint}</span>
      </span>
    </Link>
  );
}

export function NeedsAttention({ overdueTasks, dueTodayTasks }: { overdueTasks: number; dueTodayTasks: number }) {
  const tiles: Tile[] = [
    { label: "Overdue tasks", icon: AlertTriangle, href: "/app/work/tasks", value: overdueTasks, hint: overdueTasks ? "Past their due date" : "Nothing overdue", tone: "warning" },
    { label: "Tasks due today", icon: CalendarCheck, href: "/app/work/tasks", value: dueTodayTasks, hint: dueTodayTasks ? "Due before midnight" : "Nothing due today" },
    { label: "Outstanding money", icon: Banknote, href: "/app/money/invoices", value: null, hint: "Available once invoicing is live" },
    { label: "New leads", icon: Target, href: "/app/sales/leads", value: null, hint: "Available once leads are live" },
    { label: "Jobs today", icon: Briefcase, href: "/app/work/jobs", value: null, hint: "Available once jobs are live" },
    { label: "Quotes to follow up", icon: FileSignature, href: "/app/sales/quotes", value: null, hint: "Available once quotes are live" },
  ];
  return (
    <section aria-labelledby="attention-heading">
      <h2 id="attention-heading" className="mb-2 text-sm font-semibold">Needs attention</h2>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        {tiles.map((t) => <AttentionTile key={t.label} tile={t} />)}
      </div>
    </section>
  );
}
