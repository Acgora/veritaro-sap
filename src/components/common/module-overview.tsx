import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { NAV_ITEMS } from "@/lib/navigation";
import { PageHeader } from "./page-header";
import { StatusBadge } from "./status-badge";

/** Landing page for a module: lists its sub-areas and whether they're live. */
export function ModuleOverview({ moduleKey, description }: { moduleKey: string; description: string }) {
  const item = NAV_ITEMS.find((n) => n.key === moduleKey);
  if (!item) return null;
  return (
    <div>
      <PageHeader title={item.label} description={description} />
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {(item.children ?? []).map((c) => (
          <li key={c.href}>
            <Link href={c.href} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-raised">
              <span className="flex-1 font-medium">{c.label}</span>
              {c.live ? <StatusBadge tone="success">Live</StatusBadge> : <StatusBadge>Later phase</StatusBadge>}
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
