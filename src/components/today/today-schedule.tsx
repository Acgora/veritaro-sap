import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { EntityStatus } from "@/components/common/entity-status";
import { StatusBadge } from "@/components/common/status-badge";
import type { TaskWithAssignee } from "@/domain/tasks/service";
import type { JobToday } from "@/domain/today/schema";
import { TASK_PRIORITY_LABELS, type TaskPriority } from "@/domain/tasks/schema";
import { timeInZone } from "@/domain/today/format";

/** Today's jobs (from today_summary) followed by tasks due today. */
export function TodaySchedule({ jobs, tasks, timeZone, showJobs }: { jobs: JobToday[]; tasks: TaskWithAssignee[]; timeZone: string; showJobs: boolean }) {
  if ((!showJobs || jobs.length === 0) && tasks.length === 0) {
    return (
      <EmptyState
        compact
        icon={CalendarDays}
        title={showJobs ? "No jobs or tasks scheduled today" : "No tasks due today"}
        action={showJobs ? <Link href="/app/work/calendar" className="text-sm text-primary hover:underline">Open the calendar</Link> : undefined}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {showJobs && jobs.length > 0 ? (
        <ol className="flex flex-col divide-y divide-border" aria-label="Jobs today">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={`/app/work/jobs/${j.id}`} className="flex min-h-11 items-center gap-3 py-2 hover:underline-offset-2">
                <time dateTime={j.scheduled_start ?? undefined} className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {j.scheduled_start ? timeInZone(j.scheduled_start, timeZone) : ""}
                </time>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium hover:underline">{j.job_number} · {j.title}</span>
                </span>
                {j.team_size === 0 && j.status === "scheduled" ? <StatusBadge tone="warning">No team</StatusBadge> : null}
                <EntityStatus entity="job" status={j.status} />
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
      {tasks.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Tasks due today</p>
          <ol className="flex flex-col divide-y divide-border">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <time dateTime={t.due_at ?? undefined} className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {t.due_at ? timeInZone(t.due_at, timeZone) : ""}
                </time>
                <Link href="/app/work/tasks" className="min-w-0 flex-1 truncate text-sm hover:underline">{t.title}</Link>
                {t.priority === "high" || t.priority === "urgent" ? (
                  <StatusBadge tone={t.priority === "urgent" ? "danger" : "warning"}>{TASK_PRIORITY_LABELS[t.priority as TaskPriority]}</StatusBadge>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
