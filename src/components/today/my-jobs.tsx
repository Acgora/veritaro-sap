import Link from "next/link";
import { ChevronRight, HardHat, MapPin } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { EntityStatus } from "@/components/common/entity-status";
import type { MyJob } from "@/domain/today/service";
import { timeInZone } from "@/domain/today/format";

function JobCard({ job, timeZone }: { job: MyJob; timeZone: string }) {
  return (
    <li>
      <Link
        href={`/app/work/jobs/${job.id}`}
        className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:bg-surface-raised active:bg-surface-raised"
      >
        <span className="w-14 shrink-0 text-center">
          <span className="block text-base font-semibold tabular-nums">{job.scheduledStart ? timeInZone(job.scheduledStart, timeZone) : "—"}</span>
          {job.scheduledEnd ? <span className="block text-xs tabular-nums text-muted-foreground">to {timeInZone(job.scheduledEnd, timeZone)}</span> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{job.jobNumber} · {job.title}</span>
          {job.customerName ? <span className="block truncate text-sm text-muted-foreground">{job.customerName}</span> : null}
          {job.siteAddress ? (
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3 shrink-0" aria-hidden />{job.siteAddress}</span>
          ) : null}
        </span>
        <EntityStatus entity="job" status={job.status} />
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

/** Field-agent view: own jobs today (big tap targets), then assigned jobs that still need a date. */
export function MyJobsToday({ jobs, timeZone }: { jobs: MyJob[]; timeZone: string }) {
  const scheduled = jobs.filter((j) => j.scheduledStart);
  const unscheduled = jobs.filter((j) => !j.scheduledStart);
  return (
    <div className="flex flex-col gap-3">
      {scheduled.length === 0 ? (
        <EmptyState compact icon={HardHat} title="No jobs for you today" description="Jobs assigned to you will appear here with the customer and address." />
      ) : (
        <ol className="flex flex-col gap-2">{scheduled.map((j) => <JobCard key={j.id} job={j} timeZone={timeZone} />)}</ol>
      )}
      {unscheduled.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Assigned to you, not scheduled yet</p>
          <ol className="flex flex-col gap-2">{unscheduled.map((j) => <JobCard key={j.id} job={j} timeZone={timeZone} />)}</ol>
        </div>
      ) : null}
    </div>
  );
}
