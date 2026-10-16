import { AlertTriangle } from "lucide-react";
import type { ScheduleConflict } from "@/domain/jobs/service";
import { formatDateTime } from "@/lib/dates";
import { formatTime } from "@/domain/jobs/calendar";

/** Warning list for find_schedule_conflicts results. Warnings only — the user may proceed. */
export function ConflictList({ conflicts, timeZone }: { conflicts: ScheduleConflict[]; timeZone: string }) {
  if (conflicts.length === 0) return null;
  return (
    <div role="alert" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-warning"><AlertTriangle className="size-4" aria-hidden /> Schedule clash</p>
      <ul className="mt-1.5 flex flex-col gap-1 text-foreground/90">
        {conflicts.map((c) => (
          <li key={`${c.jobId}-${c.userId}`}>
            <span className="font-medium">{c.userName ?? "Someone"}</span> is already on {c.jobNumber} · {c.title} ({formatDateTime(c.start, timeZone)}–{formatTime(c.end, timeZone)})
          </li>
        ))}
      </ul>
    </div>
  );
}
