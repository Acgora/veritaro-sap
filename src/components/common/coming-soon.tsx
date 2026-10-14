import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";
import { PageHeader } from "./page-header";
import { StatusBadge } from "./status-badge";
import { Button } from "@/components/ui/button";

/** Honest placeholder for routes whose module ships in a later build phase. No fake data. */
export function ComingSoon({ title, description, icon: Icon = Construction }: { title: string; description: string; icon?: LucideIcon }) {
  return (
    <div>
      <PageHeader title={title} actions={<StatusBadge tone="info">Coming in a later build phase</StatusBadge>} />
      <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
        <div className="mx-auto mb-3 w-fit rounded-full bg-muted p-3 text-muted-foreground">
          <Icon className="size-6" aria-hidden />
        </div>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">Nothing has been created. This area isn&apos;t active yet.</p>
        <Button asChild variant="secondary" size="sm" className="mt-5">
          <Link href="/app/today">Back to Today</Link>
        </Button>
      </div>
    </div>
  );
}
