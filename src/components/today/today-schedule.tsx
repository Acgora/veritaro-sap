import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import type { TaskWithAssignee } from "@/domain/tasks/service";
import { TASK_PRIORITY_LABELS, type TaskPriority } from "@/domain/tasks/schema";

function timeIn(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
}

/** Timeline for today. Jobs/bookings will merge in here when the Work module ships. */
export function TodaySchedule({ tasks, timeZone }: { tasks: TaskWithAssignee[]; timeZone: string }) {
  return (
    <div>
      {tasks.length === 0 ? (
        <EmptyState compact icon={CalendarDays} title="No jobs scheduled today." description="Tasks due today will show here too." />
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <time dateTime={t.due_at ?? undefined} className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                {t.due_at ? timeIn(t.due_at, timeZone) : ""}
              </time>
              <Link href="/app/work/tasks" className="min-w-0 flex-1 truncate text-sm hover:underline">{t.title}</Link>
              {t.priority === "high" || t.priority === "urgent" ? (
                <StatusBadge tone={t.priority === "urgent" ? "danger" : "warning"}>{TASK_PRIORITY_LABELS[t.priority as TaskPriority]}</StatusBadge>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">Jobs and bookings will appear here once scheduling is live.</p>
    </div>
  );
}
