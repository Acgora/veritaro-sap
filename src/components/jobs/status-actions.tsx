"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, Play, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { cn } from "@/lib/utils";
import type { JobAction } from "@/domain/jobs/schema";
import { setJobStatusAction } from "@/app/app/work/jobs/actions";

/**
 * Confirmation with an optional notes box (ConfirmationDialog has no body slot).
 * Same look and alertdialog semantics as ConfirmationDialog.
 */
export function NotesConfirmDialog({ open, onOpenChange, title, description, notesLabel, placeholder, maxLength, confirmLabel, tone, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; notesLabel: string; placeholder?: string;
  maxLength: number; confirmLabel: string; tone: "primary" | "danger"; onConfirm: (notes: string) => Promise<boolean>;
}) {
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent title={title} description={description} role="alertdialog">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="status-notes" className="text-sm font-medium">{notesLabel} <span className="font-normal text-muted-foreground">(optional)</span></label>
            <Textarea id="status-notes" value={notes} maxLength={maxLength} placeholder={placeholder} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant={tone} disabled={pending} onClick={() => start(async () => { if (await onConfirm(notes)) { setNotes(""); onOpenChange(false); } })}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface StatusCapabilities { work: boolean; write: boolean }

/**
 * Lifecycle buttons for a job. Only actions valid for the current status and the user's
 * permissions are shown; the DB (set_job_status) is still the authority.
 */
export function JobStatusActions({ job, can, size = "sm", big = false }: {
  job: { id: string; job_number: string; status: string };
  can: StatusCapabilities;
  size?: ButtonProps["size"];
  /** Full-width thumb-friendly buttons (field view). */
  big?: boolean;
}) {
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pending, start] = useTransition();
  const act = async (action: JobAction, notes?: string, msg?: string) => {
    const r = await setJobStatusAction(job.id, action, notes || null);
    if (!r.ok) { toast.error(r.error); return false; }
    toast.success(msg ?? "Job updated");
    return true;
  };
  const open = job.status === "unscheduled" || job.status === "scheduled";
  const canAct = can.work || can.write;
  const cls = big ? "h-14 w-full text-base" : undefined;

  return (
    <div className={cn("flex flex-wrap gap-2", big && "flex-col")}>
      {canAct && open ? (
        <ConfirmationDialog
          title="Start this job?"
          description={`${job.job_number} will show as In progress and the start time is recorded.`}
          confirmLabel="Start job"
          tone="primary"
          onConfirm={() => act("start", undefined, "Job started")}
          trigger={(o) => <Button size={size} className={cls} disabled={pending} onClick={o}><Play /> Start job</Button>}
        />
      ) : null}
      {canAct && (open || job.status === "in_progress") ? (
        <Button size={size} className={cls} variant={job.status === "in_progress" ? "primary" : "secondary"} onClick={() => setCompleting(true)}>
          <CheckCircle2 /> Complete job
        </Button>
      ) : null}
      {can.write && job.status === "completed" ? (
        <Button size={size} className={cls} variant="secondary" disabled={pending}
          onClick={() => start(async () => { await act("reopen", undefined, "Job reopened"); })}>
          <RotateCcw /> Reopen
        </Button>
      ) : null}
      {can.write && job.status !== "completed" && job.status !== "cancelled" ? (
        <Button size={size} className={cls} variant="ghost" onClick={() => setCancelling(true)}><XCircle /> Cancel job</Button>
      ) : null}

      <NotesConfirmDialog
        open={completing} onOpenChange={setCompleting}
        title="Complete this job?"
        description={`Mark ${job.job_number} as completed. The finish time is recorded and the job is locked for editing.`}
        notesLabel="Completion notes" placeholder="What was done, anything the customer should know" maxLength={5000}
        confirmLabel="Complete job" tone="primary"
        onConfirm={(n) => act("complete", n, "Job completed")}
      />
      <NotesConfirmDialog
        open={cancelling} onOpenChange={setCancelling}
        title="Cancel this job?"
        description={`${job.job_number} will be cancelled and removed from the calendar. Its history is kept.`}
        notesLabel="Reason" placeholder="e.g. Customer postponed indefinitely" maxLength={500}
        confirmLabel="Cancel job" tone="danger"
        onConfirm={(n) => act("cancel", n, "Job cancelled")}
      />
    </div>
  );
}
