"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/common/form-field";
import { scheduleFollowUpAction } from "@/app/app/sales/leads/actions";
import { fromLocalInput, toLocalInput, tomorrowAtNine } from "./datetime";

function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

export function FollowUpDialog({ leadId, current, open, onOpenChange }: {
  leadId: string;
  current: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(() => toLocalInput(current) || tomorrowAtNine());
  const [error, setError] = useState<string | null>(null);

  const save = (at: string | null) =>
    start(async () => {
      if (at === "") { setError("Choose a date and time"); return; }
      const r = await scheduleFollowUpAction(leadId, at);
      if (!r.ok) { setError(r.error); return; }
      toast.success(at ? "Follow-up scheduled" : "Follow-up cleared");
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pending) { if (o) { setValue(toLocalInput(current) || tomorrowAtNine()); setError(null); } onOpenChange(o); } }}>
      <DialogContent title="Schedule follow-up" description="You'll see it on Today and on the lead card when it's due.">
        <form noValidate className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save(fromLocalInput(value)); }}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick picks">
            <Button size="sm" variant="secondary" onClick={() => setValue(inDays(1))}>Tomorrow 09:00</Button>
            <Button size="sm" variant="secondary" onClick={() => setValue(inDays(3))}>In 3 days</Button>
            <Button size="sm" variant="secondary" onClick={() => setValue(inDays(7))}>Next week</Button>
          </div>
          <FormField id="followUpAt" label="Follow up on" required error={error ?? undefined}>
            {(p) => <Input {...p} type="datetime-local" className="h-10" value={value} onChange={(e) => setValue(e.target.value)} />}
          </FormField>
          <div className="flex flex-wrap justify-end gap-2">
            {current ? <Button variant="ghost" size="lg" disabled={pending} onClick={() => save(null)}>Clear follow-up</Button> : null}
            <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : "Schedule"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
