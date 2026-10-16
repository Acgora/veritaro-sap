"use client";
import Link from "next/link";
import { ArrowLeft, Clock, MapPin, Navigation, Phone, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityStatus } from "@/components/common/entity-status";
import { StatusBadge } from "@/components/common/status-badge";
import type { FieldJobDetail } from "@/domain/jobs/service";
import { JOB_PRIORITY_LABELS, type JobPriority } from "@/domain/jobs/schema";
import { formatDateKey, formatTimeRange, mapsHref, telHref, zonedDateKey } from "@/domain/jobs/calendar";
import { formatDateTime } from "@/lib/dates";
import { JobStatusActions } from "./status-actions";
import { JobNotes } from "./job-notes";
import { JobPhotos } from "./job-photos";

/**
 * Field (mobile) job view for people who hold jobs.read_assigned only. Shows exactly what
 * get_field_job returns: no money, no other sites, no customer history.
 */
export function FieldJobView({ detail, photoUrls, organisationId, timeZone, can }: {
  detail: FieldJobDetail;
  photoUrls: Record<string, string>;
  organisationId: string;
  timeZone: string;
  can: { work: boolean; write: boolean };
}) {
  const { job, notes, photos } = detail;
  const nav = mapsHref(job.site_address);
  const call = telHref(job.contact_phone);
  const closed = job.status === "completed" || job.status === "cancelled";
  const canAdd = (can.work || can.write) && job.status !== "cancelled";

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 pb-8">
      <div>
        <Link href="/app/work/jobs" className="inline-flex h-10 items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> My jobs
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{job.job_number}</span>
          <EntityStatus entity="job" status={job.status} />
          {job.priority === "high" || job.priority === "urgent" ? (
            <StatusBadge tone={job.priority === "urgent" ? "danger" : "warning"}>{JOB_PRIORITY_LABELS[job.priority as JobPriority]}</StatusBadge>
          ) : null}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{job.title}</h1>
        {job.customer_name ? <p className="text-base text-muted-foreground">{job.customer_name}</p> : null}
      </div>

      <section aria-label="When" className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4">
        <Clock className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
        <div className="text-base">
          {job.scheduled_start ? (
            <>
              <p className="font-medium">{formatDateKey(zonedDateKey(job.scheduled_start, timeZone), { weekday: "long", day: "numeric", month: "long" })}</p>
              <p className="text-muted-foreground">{formatTimeRange(job.scheduled_start, job.scheduled_end, timeZone)}</p>
            </>
          ) : (
            <p className="text-muted-foreground">Not scheduled yet</p>
          )}
          {job.actual_start ? <p className="text-sm text-muted-foreground">Started {formatDateTime(job.actual_start, timeZone)}</p> : null}
          {job.completed_at ? <p className="text-sm text-muted-foreground">Completed {formatDateTime(job.completed_at, timeZone)}</p> : null}
        </div>
      </section>

      <section aria-label="Site" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex items-start gap-3">
          <MapPin className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <div className="min-w-0 text-base">
            {job.site_label ? <p className="font-medium">{job.site_label}</p> : null}
            <p>{job.site_address ?? <span className="text-muted-foreground">No site address on this job</span>}</p>
            {job.site_notes ? <p className="mt-1 text-sm text-muted-foreground">Access: {job.site_notes}</p> : null}
          </div>
        </div>
        {nav ? (
          <Button asChild size="lg" variant="secondary" className="h-12 w-full text-base">
            <a href={nav} target="_blank" rel="noopener noreferrer"><Navigation /> Navigate</a>
          </Button>
        ) : null}
      </section>

      {job.contact_name || job.contact_phone ? (
        <section aria-label="Contact" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center gap-3 text-base">
            <User className="size-5 text-muted-foreground" aria-hidden />
            <span>{job.contact_name ?? "Customer"}</span>
          </div>
          {call ? (
            <Button asChild size="lg" variant="secondary" className="h-12 w-full text-base">
              <a href={call}><Phone /> Call {job.contact_name?.split(" ")[0] ?? ""}</a>
            </Button>
          ) : null}
        </section>
      ) : null}

      {job.description ? (
        <section aria-labelledby="scope-h" className="rounded-lg border border-border bg-surface p-4">
          <h2 id="scope-h" className="mb-2 text-sm font-semibold">What to do</h2>
          <p className="whitespace-pre-wrap text-base">{job.description}</p>
        </section>
      ) : null}

      {!closed ? <JobStatusActions job={job} can={{ work: can.work, write: false }} size="lg" big /> : null}
      {job.status === "completed" && job.completion_notes ? (
        <section aria-labelledby="done-h" className="rounded-lg border border-border bg-surface p-4">
          <h2 id="done-h" className="mb-2 text-sm font-semibold">Completion notes</h2>
          <p className="whitespace-pre-wrap text-base">{job.completion_notes}</p>
        </section>
      ) : null}

      <section aria-labelledby="photos-h" className="rounded-lg border border-border bg-surface p-4">
        <h2 id="photos-h" className="mb-3 text-sm font-semibold">Photos</h2>
        <JobPhotos photos={photos} urls={photoUrls} organisationId={organisationId} jobId={job.id} canAdd={canAdd} timeZone={timeZone} big />
      </section>

      <section aria-labelledby="notes-h" className="rounded-lg border border-border bg-surface p-4">
        <h2 id="notes-h" className="mb-3 text-sm font-semibold">Notes</h2>
        <JobNotes jobId={job.id} notes={notes} canAdd={canAdd} timeZone={timeZone} big />
      </section>
    </div>
  );
}
