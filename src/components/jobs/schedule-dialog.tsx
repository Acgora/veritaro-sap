"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/common/form-field";
import type { ScheduleConflict } from "@/domain/jobs/service";
import { isDateString, isTimeString, utcToZonedInput, zonedToUtcIso } from "@/domain/jobs/calendar";
import { scheduleJobAction } from "@/app/app/work/jobs/actions";
import { ConflictList } from "./conflict-list";

export interface ScheduleValue {
  date: string;
  start: string;
  end: string;
}

/** Initial form values from stored UTC timestamps (org timezone) or a preset date. */
export function scheduleDefaults(start: string | null, end: string | null, timeZone: string, presetDate?: string): ScheduleValue {
  if (start) {
    const s = utcToZonedInput(start, timeZone);
    const e = end ? utcToZonedInput(end, timeZone) : null;
    return { date: s.date, start: s.time, end: e && e.date === s.date ? e.time : "" };
  }
  return { date: presetDate ?? "", start: "08:00", end: "10:00" };
}

/** Converts the form to UTC ISO (org timezone). Returns an error message for invalid input. */
export function scheduleToIso(v: ScheduleValue, timeZone: string): { start: string | null; end: string | null; error?: string } {
  if (!v.date && !v.start) return { start: null, end: null };
  if (!isDateString(v.date)) return { start: null, end: null, error: "Choose a date" };
  if (!isTimeString(v.start)) return { start: null, end: null, error: "Choose a start time" };
  const start = zonedToUtcIso(v.date, v.start, timeZone);
  if (!v.end) return { start, end: null };
  if (!isTimeString(v.end)) return { start, end: null, error: "Choose a valid end time" };
  const end = zonedToUtcIso(v.date, v.end, timeZone);
  if (end <= start) return { start, end, error: "The end must be after the start" };
  return { start, end };
}

/** Date + start/end time inputs. Times are in the organisation timezone. */
export function ScheduleFields({ value, onChange, idPrefix, error, timeZone }: {
  value: ScheduleValue; onChange: (v: ScheduleValue) => void; idPrefix: string; error?: string; timeZone: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Schedule</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField id={`${idPrefix}-date`} label="Date" error={error}>
          {(p) => <Input {...p} type="date" className="h-10" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />}
        </FormField>
        <FormField id={`${idPrefix}-start`} label="Start">
          {(p) => <Input {...p} type="time" step={900} className="h-10" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} />}
        </FormField>
        <FormField id={`${idPrefix}-end`} label="End" hint="Defaults to 2 hours">
          {(p) => <Input {...p} type="time" step={900} className="h-10" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} />}
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">Times are in {timeZone.replace(/_/g, " ")}.</p>
    </fieldset>
  );
}

/** Schedule / reschedule a job with deterministic conflict warnings (user may proceed). */
export function ScheduleDialog({ open, onOpenChange, job, timeZone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: { id: string; job_number: string; title: string; status: string; scheduled_start: string | null; scheduled_end: string | null };
  timeZone: string;
}) {
  const [value, setValue] = useState(() => scheduleDefaults(job.scheduled_start, job.scheduled_end, timeZone));
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const submit = (force: boolean, clear = false) => {
    const iso = clear ? { start: null, end: null } : scheduleToIso(value, timeZone);
    if ("error" in iso && iso.error) { setError(iso.error); return; }
    if (!clear && !iso.start) { setError("Choose a date"); return; }
    setError(undefined);
    start(async () => {
      const r = await scheduleJobAction(job.id, { scheduledStart: iso.start, scheduledEnd: iso.end, force });
      if (!r.ok) {
        setError(r.fieldErrors?.scheduledEnd?.[0] ?? r.fieldErrors?.scheduledStart?.[0]);
        toast.error(r.error);
        return;
      }
      if (!r.data.scheduled) { setConflicts(r.data.conflicts); return; }
      toast.success(clear ? "Schedule cleared" : r.data.conflicts.length ? "Scheduled — with a clash" : "Job scheduled");
      setConflicts([]);
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent title={job.scheduled_start ? "Reschedule job" : "Schedule job"} description={`${job.job_number} · ${job.title}`}>
        <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
          <ScheduleFields idPrefix="sched" value={value} onChange={(v) => { setValue(v); setConflicts([]); }} error={error} timeZone={timeZone} />
          <ConflictList conflicts={conflicts} timeZone={timeZone} />
          <div className="flex flex-wrap justify-end gap-2">
            {job.scheduled_start && job.status !== "in_progress" ? (
              <Button variant="ghost" disabled={pending} onClick={() => submit(false, true)}>Clear schedule</Button>
            ) : null}
            <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
            {conflicts.length ? (
              <Button variant="primary" disabled={pending} onClick={() => submit(true)}>{pending ? "Saving…" : "Schedule anyway"}</Button>
            ) : (
              <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Save schedule"}</Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
