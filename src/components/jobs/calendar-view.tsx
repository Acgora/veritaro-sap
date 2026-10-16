"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/empty-state";
import { EntityStatus } from "@/components/common/entity-status";
import { cn } from "@/lib/utils";
import type { JobListItem } from "@/domain/jobs/service";
import {
  addDays, addMonths, findOverlaps, formatDateKey, formatTime, formatTimeRange, groupByDate, monthGrid, type MonthGridDay,
} from "@/domain/jobs/calendar";
import { NewJobForm } from "./job-form";
import { ScheduleDialog } from "./schedule-dialog";
import { AssignDialog, type MemberOption } from "./assign-dialog";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

const chipTone: Record<string, string> = {
  unscheduled: "border-warning/40 bg-warning-soft",
  scheduled: "border-primary/30 bg-info-soft",
  in_progress: "border-primary/50 bg-info-soft font-medium",
  completed: "border-success/30 bg-success-soft",
  invoiced: "border-success/30 bg-success-soft",
};

export function CalendarView(props: {
  view: "month" | "day";
  date: string;
  today: string;
  jobs: JobListItem[];
  unscheduled: JobListItem[];
  timeZone: string;
  canWrite: boolean;
  customers: { id: string; display_name: string }[];
  members: MemberOption[];
}) {
  const { view, date, today, jobs, timeZone, canWrite } = props;
  const [createOn, setCreateOn] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<JobListItem | null>(null);
  const [assigning, setAssigning] = useState<JobListItem | null>(null);
  const byDate = useMemo(() => groupByDate(jobs, timeZone), [jobs, timeZone]);
  const [y, m] = date.split("-").map(Number) as [number, number];

  const prev = view === "month" ? addMonths(date, -1) : addDays(date, -1);
  const next = view === "month" ? addMonths(date, 1) : addDays(date, 1);
  const link = (v: string, d: string) => `/app/work/calendar?view=${v}&date=${d}`;
  const title = view === "month"
    ? formatDateKey(`${y}-${String(m).padStart(2, "0")}-01`, { month: "long", year: "numeric" })
    : formatDateKey(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const actions = { canWrite, onReschedule: setRescheduling, onAssign: setAssigning };

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button asChild variant="secondary" size="icon" aria-label={view === "month" ? "Previous month" : "Previous day"}><Link href={link(view, prev)}><ChevronLeft /></Link></Button>
            <Button asChild variant="secondary" size="sm" className="h-9"><Link href={link(view, today)}>Today</Link></Button>
            <Button asChild variant="secondary" size="icon" aria-label={view === "month" ? "Next month" : "Next day"}><Link href={link(view, next)}><ChevronRight /></Link></Button>
          </div>
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="flex-1" />
          <nav aria-label="Calendar view" className="flex rounded-md border border-border p-0.5">
            {(["month", "day"] as const).map((v) => (
              <Link key={v} href={link(v, date)} aria-current={view === v ? "page" : undefined}
                className={cn("rounded px-3 py-1.5 text-sm text-muted-foreground", view === v && "bg-surface-raised font-medium text-foreground")}>
                {v === "month" ? "Month" : "Day"}
              </Link>
            ))}
          </nav>
          {canWrite ? <Button size="sm" className="h-9" onClick={() => setCreateOn(view === "day" ? date : today)}><Plus /> New job</Button> : null}
        </div>

        {view === "month" ? (
          <>
            <MonthGrid weeks={monthGrid(y, m)} byDate={byDate} today={today} timeZone={timeZone} canWrite={canWrite} onCreate={setCreateOn} />
            {/* Small screens: agenda list for the month instead of the grid. */}
            <MonthAgenda month={date.slice(0, 7)} byDate={byDate} today={today} timeZone={timeZone} />
          </>
        ) : (
          <DayAgenda jobs={byDate.get(date) ?? []} timeZone={timeZone} {...actions} onCreate={canWrite ? () => setCreateOn(date) : undefined} />
        )}
      </div>

      {canWrite ? (
        <aside aria-labelledby="unscheduled-h" className="rounded-lg border border-border bg-surface lg:w-72 lg:shrink-0 lg:self-start">
          <h2 id="unscheduled-h" className="border-b border-border px-3 py-2.5 text-sm font-semibold">Unscheduled ({props.unscheduled.length})</h2>
          {props.unscheduled.length === 0 ? (
            <EmptyState compact title="Everything is scheduled" />
          ) : (
            <ul className="max-h-[60dvh] divide-y divide-border overflow-y-auto">
              {props.unscheduled.map((j) => (
                <li key={j.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/app/work/jobs/${j.id}`} className="block truncate font-medium hover:underline">{j.title}</Link>
                    <p className="truncate text-xs text-muted-foreground">{[j.job_number, j.customer_name].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setRescheduling(j)}>Schedule</Button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      ) : null}

      {canWrite ? (
        <Dialog open={!!createOn} onOpenChange={(o) => !o && setCreateOn(null)}>
          {createOn ? (
            <DialogContent title="New job" description={formatDateKey(createOn)} className="max-w-xl">
              <NewJobForm customers={props.customers} members={props.members} timeZone={timeZone} presetDate={createOn} onDone={() => setCreateOn(null)} />
            </DialogContent>
          ) : null}
        </Dialog>
      ) : null}
      {rescheduling ? (
        <ScheduleDialog key={rescheduling.id} open onOpenChange={(o) => !o && setRescheduling(null)}
          job={{ ...rescheduling, status: rescheduling.status }} timeZone={timeZone} />
      ) : null}
      {assigning ? (
        <AssignDialog key={assigning.id} open onOpenChange={(o) => !o && setAssigning(null)} jobId={assigning.id}
          members={props.members} current={assigning.assignees} timeZone={timeZone} />
      ) : null}
    </div>
  );
}

function MonthGrid({ weeks, byDate, today, timeZone, canWrite, onCreate }: {
  weeks: MonthGridDay[][]; byDate: Map<string, JobListItem[]>; today: string; timeZone: string; canWrite: boolean; onCreate: (d: string) => void;
}) {
  return (
    <div className="hidden overflow-hidden rounded-lg border border-border bg-surface md:block">
      <div className="grid grid-cols-7 border-b border-border text-xs font-medium text-muted-foreground">
        {WEEKDAY_LABELS.map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
      </div>
      {weeks.map((week) => (
        <div key={week[0]!.date} className="grid grid-cols-7 border-b border-border last:border-b-0">
          {week.map((day) => {
            const items = byDate.get(day.date) ?? [];
            const extra = items.length - MAX_CHIPS;
            return (
              <div key={day.date} className={cn("group min-h-28 border-r border-border p-1 last:border-r-0", !day.inMonth && "bg-muted/40")}>
                <div className="mb-1 flex items-center justify-between">
                  <Link href={`/app/work/calendar?view=day&date=${day.date}`}
                    className={cn("inline-flex size-6 items-center justify-center rounded-full text-xs hover:bg-surface-raised",
                      !day.inMonth && "text-muted-foreground", day.date === today && "bg-primary font-semibold text-primary-foreground hover:bg-primary")}
                    aria-label={`${formatDateKey(day.date)}${items.length ? `, ${items.length} jobs` : ""}`}>
                    {Number(day.date.slice(8))}
                  </Link>
                  {canWrite ? (
                    <button type="button" onClick={() => onCreate(day.date)} aria-label={`New job on ${formatDateKey(day.date)}`}
                      className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-surface-raised focus:opacity-100 group-hover:opacity-100">
                      <Plus className="size-3.5" />
                    </button>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {items.slice(0, MAX_CHIPS).map((j) => (
                    <li key={j.id}>
                      <Link href={`/app/work/jobs/${j.id}`} title={`${j.job_number} · ${j.title}${j.customer_name ? ` · ${j.customer_name}` : ""}`}
                        className={cn("block truncate rounded border px-1 py-0.5 text-[11px] leading-tight hover:underline", chipTone[j.displayStatus] ?? "border-border bg-surface-raised")}>
                        <span className="text-muted-foreground">{formatTime(j.scheduled_start!, timeZone)}</span> {j.title}
                      </Link>
                    </li>
                  ))}
                </ul>
                {extra > 0 ? (
                  <Link href={`/app/work/calendar?view=day&date=${day.date}`} className="mt-0.5 block px-1 text-[11px] text-primary hover:underline">+{extra} more</Link>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MonthAgenda({ month, byDate, today, timeZone }: { month: string; byDate: Map<string, JobListItem[]>; today: string; timeZone: string }) {
  const days = [...byDate.keys()].filter((d) => d.startsWith(month)).sort();
  return (
    <div className="md:hidden">
      {days.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface"><EmptyState compact icon={CalendarDays} title="No jobs scheduled this month" /></div>
      ) : (
        <ol className="flex flex-col gap-3">
          {days.map((d) => (
            <li key={d} className="rounded-lg border border-border bg-surface">
              <Link href={`/app/work/calendar?view=day&date=${d}`} className={cn("block border-b border-border px-3 py-2 text-sm font-semibold", d === today && "text-primary")}>
                {formatDateKey(d, { weekday: "short", day: "numeric", month: "short" })}{d === today ? " · Today" : ""}
              </Link>
              <ul className="divide-y divide-border">
                {(byDate.get(d) ?? []).map((j) => (
                  <li key={j.id}>
                    <Link href={`/app/work/jobs/${j.id}`} className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">
                      <span className="w-24 shrink-0 text-xs text-muted-foreground">{formatTimeRange(j.scheduled_start!, j.scheduled_end, timeZone)}</span>
                      <span className="min-w-0 flex-1 truncate">{j.title}</span>
                      <EntityStatus entity="job" status={j.displayStatus} />
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DayAgenda({ jobs, timeZone, canWrite, onReschedule, onAssign, onCreate }: {
  jobs: JobListItem[]; timeZone: string; canWrite: boolean;
  onReschedule: (j: JobListItem) => void; onAssign: (j: JobListItem) => void; onCreate?: () => void;
}) {
  const overlaps = useMemo(
    () => findOverlaps(jobs.map((j) => ({ id: j.id, scheduled_start: j.scheduled_start, scheduled_end: j.scheduled_end, status: j.status, assigneeIds: j.assignees.map((a) => a.userId) }))),
    [jobs],
  );
  const byId = new Map(jobs.map((j) => [j.id, j]));
  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState compact icon={CalendarDays} title="Nothing scheduled this day"
          action={onCreate ? <Button size="sm" onClick={onCreate}><Plus /> New job on this day</Button> : undefined} />
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {jobs.map((j) => {
        const clash = overlaps.get(j.id);
        return (
          <li key={j.id} className={cn("rounded-lg border bg-surface p-3", clash ? "border-warning" : "border-border")}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="w-28 shrink-0 text-sm font-medium tabular-nums">{formatTimeRange(j.scheduled_start!, j.scheduled_end, timeZone)}</div>
              <div className="min-w-0 flex-1">
                <Link href={`/app/work/jobs/${j.id}`} className="text-sm font-medium hover:underline">
                  <span className="text-muted-foreground">{j.job_number}</span> · {j.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {[j.customer_name, j.site_address].filter(Boolean).join(" · ")}
                </p>
                <p className="text-xs">{j.assignees.length ? j.assignees.map((a) => a.name).join(", ") : <span className="text-warning">Nobody assigned</span>}</p>
                {clash ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle className="size-3.5" aria-hidden />
                    Overlaps with {clash.map((id) => byId.get(id)?.job_number ?? "another job").join(", ")} for the same person
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <EntityStatus entity="job" status={j.displayStatus} />
                {canWrite && j.status !== "completed" ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => onReschedule(j)}><CalendarClock /> Reschedule</Button>
                    <Button size="sm" variant="secondary" onClick={() => onAssign(j)}><UserPlus /> Assign</Button>
                  </>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
