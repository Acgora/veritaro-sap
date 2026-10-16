import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs (?tab=key). Server-renderable; keeps tab state in the URL so back/refresh work. */
export function TabsNav({ tabs, active, label, extraQuery }: {
  tabs: readonly { key: string; label: string; count?: number | null }[];
  active: string;
  label: string;
  /** Other query params to preserve, e.g. "view=board". */
  extraQuery?: string;
}) {
  return (
    <nav aria-label={label} className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`?tab=${t.key}${extraQuery ? `&${extraQuery}` : ""}`}
          scroll={false}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
            active === t.key && "border-primary font-medium text-foreground",
          )}
        >
          {t.label}
          {typeof t.count === "number" ? <span className="ml-1 text-xs text-muted-foreground">({t.count})</span> : null}
        </Link>
      ))}
    </nav>
  );
}
