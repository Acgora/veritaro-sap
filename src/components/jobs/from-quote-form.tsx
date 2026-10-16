"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { createJobFromQuoteAction } from "@/app/app/work/jobs/actions";
import { ScheduleFields, scheduleDefaults, scheduleToIso } from "./schedule-dialog";

/** Confirm creating a job from an accepted quote. The RPC is idempotent, so a double submit opens the same job. */
export function FromQuoteForm({ quoteId, defaultTitle, timeZone }: { quoteId: string; defaultTitle: string; timeZone: string }) {
  const [title, setTitle] = useState(defaultTitle);
  const [withSchedule, setWithSchedule] = useState(false);
  const [schedule, setSchedule] = useState(() => scheduleDefaults(null, null, timeZone));
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const iso = withSchedule ? scheduleToIso(schedule, timeZone) : { start: null, end: null };
        if (withSchedule && (iso.error || !iso.start)) { setError(iso.error ?? "Choose a date"); return; }
        setError(undefined);
        start(async () => {
          // Redirects to the job on success.
          const r = await createJobFromQuoteAction({ quoteId, title, scheduledStart: iso.start, scheduledEnd: iso.end });
          if (r && !r.ok) {
            setError(r.fieldErrors?.scheduledEnd?.[0] ?? r.fieldErrors?.scheduledStart?.[0]);
            toast.error(r.error);
          }
        });
      }}
    >
      <FormField id="fq-title" label="Job title" hint="Leave as is to use the quote title">
        {(p) => <Input {...p} className="h-10" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}
      </FormField>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={withSchedule} onChange={(e) => setWithSchedule(e.target.checked)} /> Schedule it now
      </label>
      {withSchedule ? <ScheduleFields idPrefix="fq" value={schedule} onChange={setSchedule} error={error} timeZone={timeZone} /> : null}
      {!withSchedule && error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>{pending ? "Creating job…" : "Create job"}</Button>
      </div>
    </form>
  );
}
