import { History } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { UserAvatar } from "@/components/common/user-avatar";
import { describeActivity } from "@/domain/activity/describe";
import type { ActivityItem } from "@/domain/activity/service";
import { formatRelative } from "@/lib/dates";

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={History}
        title="No activity yet"
        description="As you create customers, quotes, jobs and invoices, your business history will appear here."
      />
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2.5">
          <UserAvatar size="sm" name={item.actorType === "ai" ? "AI" : item.actorName} />
          <div className="min-w-0 text-sm">
            <p className="leading-snug">{describeActivity(item)}</p>
            <p className="text-xs text-muted-foreground">
              <time dateTime={item.createdAt}>{formatRelative(item.createdAt)}</time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
