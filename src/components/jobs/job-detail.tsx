"use client";
import { useState } from "react";
import Link from "next/link";
import {
  CalendarClock, Camera, FileText, ListPlus, MapPin, MessageSquarePlus, Navigation, Pencil, Phone, Receipt, UserMinus, UserPlus, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { EntityStatus } from "@/components/common/entity-status";
import { StatusBadge } from "@/components/common/status-badge";
import { TabsNav } from "@/components/common/tabs-nav";
import { ActivityFeed } from "@/components/today/activity-feed";
import type { ActivityItem } from "@/domain/activity/service";
import { ASSIGNMENT_ROLE_LABELS, JOB_PRIORITY_LABELS, type AssignmentRole, type JobPriority } from "@/domain/jobs/schema";
import type { JobDetail } from "@/domain/jobs/service";
import { formatDateKey, formatTimeRange, mapsHref, telHref, zonedDateKey } from "@/domain/jobs/calendar";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { createInvoiceFromJobAction, unassignMemberAction } from "@/app/app/work/jobs/actions";
import { AssignDialog, type MemberOption } from "./assign-dialog";
import { ScheduleDialog } from "./schedule-dialog";
import { JobStatusActions } from "./status-actions";
import { JobNotes } from "./job-notes";
import { JobPhotos } from "./job-photos";
import { EditJobForm } from "./edit-job-form";

export const JOB_TABS = ["overview", "schedule", "team", "notes", "photos", "expenses", "documents", "activity"] as const;
export type JobTab = (typeof JOB_TABS)[number];

export interface JobDetailCan {
  write: boolean;
  work: boolean;
  createTask: boolean;
  readActivity: boolean;
  invoiceWrite: boolean;
  readCustomers: boolean;
  readQuotes: boolean;
  readInvoices: boolean;
}

export function JobDetailView({ detail, tab, activity, members, photoUrls, organisationId, timeZone, can, justCreated }: {
  detail: JobDetail;
  tab: JobTab;
  activity: ActivityItem[];
  members: MemberOption[];
  photoUrls: Record<string, string>;
  organisationId: string;
  timeZone: string;
  can: JobDetailCan;
  justCreated: boolean;
}) {
  const { job } = detail;
  const [scheduling, setScheduling] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const closed = job.status === "completed" || job.status === "cancelled";
  const editable = can.write && !closed;
  const canNotes = (can.write || can.work) && job.status !== "cancelled";
  const nav = mapsHref(detail.site?.address);
  const call = telHref(detail.contact?.phone ?? detail.customer?.phone);

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "schedule", label: "Schedule" },
    { key: "team", label: "Team", count: detail.assignments.length },
    { key: "notes", label: "Notes", count: detail.notes.length },
    { key: "photos", label: "Photos", count: detail.photos.length },
    { key: "expenses", label: "Expenses" },
    { key: "documents", label: "Documents" },
    { key: "activity", label: "Activity" },
  ];

  const when = job.scheduled_start
    ? `${formatDateKey(zonedDateKey(job.scheduled_start, timeZone))} · ${formatTimeRange(job.scheduled_start, job.scheduled_end, timeZone)}`
    : "Not scheduled";

  return (
    <div>
      <header className="mb-4 flex flex-col gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground"><Link href="/app/work/jobs" className="hover:underline">Jobs</Link> · {job.job_number}</p>
          <h1 className="text-xl font-semibold tracking-tight">{job.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <EntityStatus entity="job" status={detail.displayStatus} />
            {job.priority !== "normal" ? (
              <StatusBadge tone={job.priority === "urgent" ? "danger" : job.priority === "high" ? "warning" : "neutral"}>
                {JOB_PRIORITY_LABELS[job.priority as JobPriority] ?? job.priority} priority
              </StatusBadge>
            ) : null}
            {detail.customer ? (
              can.readCustomers ? <Link href={`/app/sales/customers/${detail.customer.id}`} className="hover:underline">{detail.customer.display_name}</Link> : <span>{detail.customer.display_name}</span>
            ) : null}
            <span>· {when}</span>
          </p>
        </div>
        {justCreated ? <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">Job created from the accepted quote. Schedule it and assign your team.</p> : null}
        <div className="flex flex-wrap gap-2">
          {editable ? <Button size="sm" variant="secondary" onClick={() => setScheduling(true)}><CalendarClock /> {job.scheduled_start ? "Reschedule" : "Schedule"}</Button> : null}
          {can.write && job.status !== "cancelled" ? <Button size="sm" variant="secondary" onClick={() => setAssigning(true)}><UserPlus /> Assign team</Button> : null}
          <JobStatusActions job={job} can={{ work: can.work, write: can.write }} />
          {canNotes ? <Button asChild size="sm" variant="secondary"><Link href="?tab=notes" scroll={false}><MessageSquarePlus /> Add note</Link></Button> : null}
          {canNotes ? <Button asChild size="sm" variant="secondary"><Link href="?tab=photos" scroll={false}><Camera /> Upload photo</Link></Button> : null}
          {can.createTask ? <Button asChild size="sm" variant="secondary"><Link href={`/app/work/tasks?new=1&customer=${job.customer_id}`}><ListPlus /> Create task</Link></Button> : null}
          {editable ? <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil /> Edit</Button> : null}
          {job.status === "completed" && detail.invoice && can.readInvoices ? (
            <Button asChild size="sm"><Link href={`/app/money/invoices/${detail.invoice.id}`}><Receipt /> View invoice</Link></Button>
          ) : null}
          {job.status === "completed" && !detail.invoice && can.invoiceWrite ? (
            <ConfirmationDialog
              title="Create an invoice for this job?"
              description={detail.quote
                ? `A draft invoice is created from ${detail.quote.quote_number}'s lines. You can check it before issuing.`
                : "A draft invoice is created with this job as its first line (no price yet). You can edit it before issuing."}
              confirmLabel="Create invoice"
              tone="primary"
              onConfirm={async () => {
                // On success the action redirects to the invoice; we only get a result back on failure.
                const r = await createInvoiceFromJobAction(job.id);
                if (r && !r.ok) toast.error(r.error);
                return false;
              }}
              trigger={(o) => <Button size="sm" onClick={o}><Receipt /> Create invoice</Button>}
            />
          ) : null}
        </div>
      </header>

      <TabsNav tabs={tabs} active={tab} label="Job sections" />

      {tab === "overview" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section aria-label="Job details" className="rounded-lg border border-border bg-surface p-4 lg:col-span-2">
            <h2 className="mb-2 text-sm font-semibold">Scope</h2>
            <p className={cn("whitespace-pre-wrap text-sm", !job.description && "text-muted-foreground")}>{job.description || "No description."}</p>
            {job.internal_notes ? (
              <>
                <h2 className="mb-1 mt-4 text-sm font-semibold">Internal notes</h2>
                <p className="whitespace-pre-wrap text-sm">{job.internal_notes}</p>
              </>
            ) : null}
            {job.completion_notes ? (
              <>
                <h2 className="mb-1 mt-4 text-sm font-semibold">Completion notes</h2>
                <p className="whitespace-pre-wrap text-sm">{job.completion_notes}</p>
              </>
            ) : null}
            {job.status === "cancelled" ? (
              <p className="mt-4 text-sm text-muted-foreground">Cancelled{job.cancelled_at ? ` ${formatDateTime(job.cancelled_at, timeZone)}` : ""}{job.cancel_reason ? ` — ${job.cancel_reason}` : ""}</p>
            ) : null}
          </section>
          <section aria-label="Customer and site" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Customer</p>
              <p className="font-medium">{detail.customer?.display_name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Contact</p>
              <p>{detail.contact?.name || "—"}</p>
              {call ? <Button asChild size="sm" variant="secondary" className="mt-1.5"><a href={call}><Phone /> Call</a></Button> : null}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Site</p>
              {detail.site ? (
                <>
                  {detail.site.label ? <p className="font-medium">{detail.site.label}</p> : null}
                  <p className="flex items-start gap-1"><MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />{detail.site.address}</p>
                  {detail.site.notes ? <p className="text-xs text-muted-foreground">Access: {detail.site.notes}</p> : null}
                  {nav ? <Button asChild size="sm" variant="secondary" className="mt-1.5"><a href={nav} target="_blank" rel="noopener noreferrer"><Navigation /> Navigate</a></Button> : null}
                </>
              ) : <p className="text-muted-foreground">No site on this job</p>}
            </div>
            {detail.quote ? (
              <div>
                <p className="text-xs text-muted-foreground">From quote</p>
                {can.readQuotes ? <Link href={`/app/sales/quotes/${detail.quote.id}`} className="hover:underline">{detail.quote.quote_number}</Link> : <p>{detail.quote.quote_number}</p>}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === "schedule" ? (
        <section aria-label="Schedule" className="rounded-lg border border-border bg-surface p-4">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Scheduled</dt><dd>{when}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Started</dt><dd>{job.actual_start ? formatDateTime(job.actual_start, timeZone) : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Finished</dt><dd>{job.actual_end ? formatDateTime(job.actual_end, timeZone) : "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Timezone</dt><dd>{timeZone.replace(/_/g, " ")}</dd></div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {editable ? <Button size="sm" onClick={() => setScheduling(true)}><CalendarClock /> {job.scheduled_start ? "Reschedule" : "Schedule"}</Button> : null}
            {job.scheduled_start ? (
              <Button asChild size="sm" variant="secondary">
                <Link href={`/app/work/calendar?view=day&date=${zonedDateKey(job.scheduled_start, timeZone)}`}>Open in calendar</Link>
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "team" ? (
        <section aria-label="Team">
          {can.write && job.status !== "cancelled" ? <div className="mb-2 flex justify-end"><Button size="sm" onClick={() => setAssigning(true)}><UserPlus /> Assign team</Button></div> : null}
          {detail.assignments.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface"><EmptyState compact title="Nobody is assigned yet" description="Assigned people see the job on their phone." /></div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {detail.assignments.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="flex-1 font-medium">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{ASSIGNMENT_ROLE_LABELS[a.role as AssignmentRole] ?? a.role}</span>
                  {can.write && !closed ? (
                    <ConfirmationDialog
                      title={`Remove ${a.name} from this job?`}
                      description="They will no longer see this job."
                      confirmLabel="Remove"
                      onConfirm={async () => {
                        const r = await unassignMemberAction(job.id, a.userId);
                        if (r.ok) toast.success("Removed from job"); else toast.error(r.error);
                        return r.ok;
                      }}
                      trigger={(o) => <Button variant="ghost" size="icon" aria-label={`Remove ${a.name}`} onClick={o}><UserMinus /></Button>}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "notes" ? (
        <section aria-label="Notes" className="rounded-lg border border-border bg-surface p-4">
          <JobNotes jobId={job.id} notes={detail.notes} canAdd={canNotes} timeZone={timeZone} />
        </section>
      ) : null}

      {tab === "photos" ? (
        <section aria-label="Photos" className="rounded-lg border border-border bg-surface p-4">
          <JobPhotos photos={detail.photos} urls={photoUrls} organisationId={organisationId} jobId={job.id} canAdd={canNotes} timeZone={timeZone} />
        </section>
      ) : null}

      {tab === "expenses" ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={Wallet} title="Job costs come in a later phase" description="You'll be able to capture materials, receipts and labour against this job." />
        </div>
      ) : null}

      {tab === "documents" ? (
        <section aria-label="Documents" className="rounded-lg border border-border bg-surface">
          {(detail.quote && can.readQuotes) || (detail.invoice && can.readInvoices) ? (
            <ul className="divide-y divide-border">
              {detail.quote && can.readQuotes ? (
                <li className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1">Quote {detail.quote.quote_number}</span>
                  <Button asChild size="sm" variant="secondary"><a href={`/api/documents/quotes/${detail.quote.id}/pdf`} target="_blank" rel="noopener noreferrer">Quote PDF</a></Button>
                </li>
              ) : null}
              {detail.invoice && can.readInvoices ? (
                <li className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <Receipt className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1">Invoice {detail.invoice.invoice_number ?? "(draft)"}</span>
                  <EntityStatus entity="invoice" status={detail.invoice.status} />
                  <Button asChild size="sm" variant="secondary"><Link href={`/app/money/invoices/${detail.invoice.id}`}>Open invoice</Link></Button>
                </li>
              ) : null}
            </ul>
          ) : (
            <EmptyState compact icon={FileText} title="No documents for this job" description={job.quote_id ? undefined : "Jobs created from a quote link to the quote and invoice here."} />
          )}
        </section>
      ) : null}

      {tab === "activity" ? (
        <section aria-label="Activity" className="rounded-lg border border-border bg-surface p-4">
          {can.readActivity ? <ActivityFeed items={activity} /> : <p className="text-sm text-muted-foreground">Activity history isn&apos;t available for your role.</p>}
        </section>
      ) : null}

      {scheduling ? <ScheduleDialog open onOpenChange={setScheduling} job={job} timeZone={timeZone} /> : null}
      {assigning ? <AssignDialog open onOpenChange={setAssigning} jobId={job.id} members={members} current={detail.assignments} timeZone={timeZone} /> : null}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="Edit job" className="max-w-xl">
          <EditJobForm job={job} canPickParties={can.readCustomers} onDone={() => setEditing(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
