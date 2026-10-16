"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Briefcase, Camera, ChevronLeft, MapPin, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, SheetContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/empty-state";
import { EntityStatus } from "@/components/common/entity-status";
import { StatusBadge } from "@/components/common/status-badge";
import { cn } from "@/lib/utils";
import { JOB_PRIORITY_LABELS, type JobPriority } from "@/domain/jobs/schema";
import type { JobListItem } from "@/domain/jobs/service";
import { formatDateKey, formatTimeRange, zonedDateKey } from "@/domain/jobs/calendar";
import { listPhotoJobsAction } from "@/app/app/work/jobs/actions";
import { NewJobForm } from "./job-form";
import { PhotoUpload } from "./photo-upload";
import type { MemberOption } from "./assign-dialog";

const CHIPS = [
  { key: "open", label: "Open" },
  { key: "unscheduled", label: "Unscheduled" },
  { key: "scheduled", label: "Scheduled" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;

export interface JobsListFilters { status: string; mine: boolean; date: string; q: string }

export function JobRow({ job, timeZone, showCustomer = true }: { job: JobListItem; timeZone: string; showCustomer?: boolean }) {
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <Link href={`/app/work/jobs/${job.id}`} className="text-sm font-medium hover:underline">
          <span className="text-muted-foreground">{job.job_number}</span> · {job.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {[
            showCustomer ? job.customer_name : null,
            job.scheduled_start
              ? `${formatDateKey(zonedDateKey(job.scheduled_start, timeZone), { weekday: "short", day: "numeric", month: "short" })} ${formatTimeRange(job.scheduled_start, job.scheduled_end, timeZone)}`
              : "Not scheduled",
            job.assignees.length ? job.assignees.map((a) => a.name).join(", ") : null,
          ].filter(Boolean).join(" · ")}
        </p>
        {job.site_address ? <p className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="size-3" aria-hidden />{job.site_address}</p> : null}
      </div>
      {job.priority === "high" || job.priority === "urgent" ? (
        <StatusBadge tone={job.priority === "urgent" ? "danger" : "warning"}>{JOB_PRIORITY_LABELS[job.priority as JobPriority]}</StatusBadge>
      ) : null}
      <EntityStatus entity="job" status={job.displayStatus} />
    </li>
  );
}

export function JobsList(props: {
  jobs: JobListItem[];
  total: number;
  page: number;
  pageSize: number;
  filters: JobsListFilters;
  readAll: boolean;
  canCreate: boolean;
  canPhoto: boolean;
  customers: { id: string; display_name: string }[];
  members: MemberOption[];
  timeZone: string;
  organisationId: string;
  openCreate: boolean;
  openPhoto: boolean;
  presetDate?: string;
  presetCustomerId?: string;
}) {
  const { jobs, total, page, pageSize, filters, readAll, canCreate, timeZone } = props;
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(props.openCreate && canCreate);
  const [photoOpen, setPhotoOpen] = useState(props.openPhoto && props.canPhoto);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const href = (patch: Record<string, string | number | boolean>) => {
    const q = new URLSearchParams({ status: filters.status, page: String(page) });
    if (filters.mine) q.set("mine", "1");
    if (filters.date) q.set("date", filters.date);
    if (filters.q) q.set("q", filters.q);
    for (const [k, v] of Object.entries(patch)) {
      if (v === false || v === "") q.delete(k);
      else q.set(k, v === true ? "1" : String(v));
    }
    return `${pathname}?${q.toString()}`;
  };
  const clearOpenParams = () => { if (props.openCreate || props.openPhoto) router.replace(href({})); };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav aria-label="Job status" className="flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <Link
              key={c.key}
              href={href({ status: c.key, page: 1 })}
              aria-current={filters.status === c.key ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-full border border-border px-3 text-sm text-muted-foreground hover:bg-surface-raised",
                filters.status === c.key && "border-primary bg-info-soft font-medium text-primary",
              )}
            >
              {c.label}
            </Link>
          ))}
        </nav>
      </div>
      <form role="search" action={pathname} className="mb-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="status" value={filters.status} />
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-3 size-4 text-muted-foreground" aria-hidden />
          <label htmlFor="job-search" className="sr-only">Search jobs</label>
          <Input id="job-search" name="q" defaultValue={filters.q} placeholder={readAll ? "Search job number, title or customer" : "Search my jobs"} className="h-10 pl-8" />
        </div>
        <label htmlFor="job-date" className="sr-only">Scheduled on</label>
        <Input id="job-date" name="date" type="date" defaultValue={filters.date} className="h-10 w-40" />
        {readAll ? (
          <label className="flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm">
            <input type="checkbox" name="mine" value="1" defaultChecked={filters.mine} className="size-4" /> My jobs
          </label>
        ) : null}
        <Button type="submit" variant="secondary" className="h-10">Apply</Button>
        {filters.date || filters.q || filters.mine ? <Button asChild variant="ghost" className="h-10"><Link href={`${pathname}?status=${filters.status}`}>Clear</Link></Button> : null}
        <div className="flex-1" />
        {props.canPhoto ? <Button variant="secondary" className="h-10" onClick={() => setPhotoOpen(true)}><Camera /> Add job photo</Button> : null}
        {canCreate ? <Button className="h-10" onClick={() => setCreating(true)}><Plus /> New job</Button> : null}
      </form>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={Briefcase}
            title={filters.q || filters.date ? "No jobs match these filters" : readAll ? "No jobs here yet" : "No jobs assigned to you"}
            description={readAll && !filters.q
              ? "Jobs come from accepted quotes, or add one directly for a customer."
              : !readAll ? "When someone assigns you a job it shows up here." : undefined}
            action={canCreate && !filters.q ? <Button size="sm" onClick={() => setCreating(true)}><Plus /> New job</Button> : undefined}
          />
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {jobs.map((j) => <JobRow key={j.id} job={j} timeZone={timeZone} />)}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {pages} · {total} jobs</span>
          <div className="flex gap-2">
            {page > 1 ? <Button asChild variant="secondary" size="sm"><Link href={href({ page: page - 1 })}>Previous</Link></Button> : null}
            {page < pages ? <Button asChild variant="secondary" size="sm"><Link href={href({ page: page + 1 })}>Next</Link></Button> : null}
          </div>
        </nav>
      ) : null}

      {canCreate ? (
        <Dialog open={creating} onOpenChange={(o) => { setCreating(o); if (!o) clearOpenParams(); }}>
          <DialogContent title="New job" className="max-w-xl">
            <NewJobForm
              customers={props.customers}
              members={props.members}
              timeZone={timeZone}
              presetDate={props.presetDate}
              presetCustomerId={props.presetCustomerId}
              onDone={() => { setCreating(false); clearOpenParams(); }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      {props.canPhoto ? (
        <Dialog open={photoOpen} onOpenChange={(o) => { setPhotoOpen(o); if (!o) clearOpenParams(); }}>
          {photoOpen ? (
            <SheetContent title="Add job photo" className="sm:mx-auto sm:max-w-lg">
              <PhotoJobPicker organisationId={props.organisationId} timeZone={timeZone} onDone={() => { setPhotoOpen(false); clearOpenParams(); }} />
            </SheetContent>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}

/** Pick one of my jobs for today / in progress, then upload a photo to it. */
function PhotoJobPicker({ organisationId, timeZone, onDone }: { organisationId: string; timeZone: string; onDone: () => void }) {
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);
  const [picked, setPicked] = useState<JobListItem | null>(null);
  const [loading, start] = useTransition();

  useEffect(() => {
    start(async () => {
      const r = await listPhotoJobsAction();
      if (!r.ok) { toast.error(r.error); setJobs([]); return; }
      setJobs(r.data.filter((j) => j.status !== "cancelled"));
    });
  }, []);

  if (picked) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" onClick={() => setPicked(null)} className="inline-flex h-10 items-center gap-1 self-start text-sm text-muted-foreground hover:underline">
          <ChevronLeft className="size-4" aria-hidden /> Choose another job
        </button>
        <p className="text-sm"><span className="text-muted-foreground">{picked.job_number}</span> · <span className="font-medium">{picked.title}</span></p>
        <PhotoUpload organisationId={organisationId} jobId={picked.id} big onUploaded={onDone} />
      </div>
    );
  }
  if (loading || jobs === null) return <p className="py-6 text-center text-sm text-muted-foreground">Loading your jobs…</p>;
  if (jobs.length === 0) {
    return (
      <EmptyState compact icon={Camera} title="No jobs for you today"
        description="Photos are added to jobs you're assigned to that are scheduled today or in progress. Open any other job to add a photo there."
        action={<Button asChild variant="secondary"><Link href="/app/work/jobs" onClick={onDone}>See all jobs</Link></Button>} />
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {jobs.map((j) => (
        <li key={j.id}>
          <button type="button" onClick={() => setPicked(j)}
            className="flex min-h-14 w-full items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left hover:bg-surface-raised">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{j.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[j.job_number, j.customer_name, j.scheduled_start ? formatTimeRange(j.scheduled_start, j.scheduled_end, timeZone) : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <EntityStatus entity="job" status={j.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}
