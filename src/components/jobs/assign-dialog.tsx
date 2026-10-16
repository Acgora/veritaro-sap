"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ROLE_LABELS, isRole } from "@/lib/permissions";
import { ASSIGNMENT_ROLE_LABELS, ASSIGNMENT_ROLES, type AssignmentRole } from "@/domain/jobs/schema";
import type { JobAssignee, ScheduleConflict } from "@/domain/jobs/service";
import { assignMembersAction } from "@/app/app/work/jobs/actions";
import { ConflictList } from "./conflict-list";

export interface MemberOption { userId: string; name: string; role: string }

export function MemberChecklist({ members, selected, onToggle, disabledIds = [] }: {
  members: MemberOption[]; selected: string[]; onToggle: (id: string) => void; disabledIds?: string[];
}) {
  if (members.length === 0) return <EmptyState compact title="No team members yet" description="Invite people under Settings → Members." />;
  return (
    <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
      {members.map((m) => {
        const already = disabledIds.includes(m.userId);
        return (
          <li key={m.userId}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" className="size-4" checked={already || selected.includes(m.userId)} disabled={already} onChange={() => onToggle(m.userId)} />
              <span className="flex-1">{m.name}</span>
              <span className="text-xs text-muted-foreground">{already ? "On this job" : isRole(m.role) ? ROLE_LABELS[m.role] : m.role}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** Add people to a job. Clashes with their other jobs are shown as warnings after saving. */
export function AssignDialog({ open, onOpenChange, jobId, members, current, timeZone }: {
  open: boolean; onOpenChange: (o: boolean) => void; jobId: string; members: MemberOption[]; current: JobAssignee[]; timeZone: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [role, setRole] = useState<AssignmentRole>(current.some((a) => a.role === "lead") ? "worker" : "lead");
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [pending, start] = useTransition();

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent title="Assign team" description="Assigned people see this job on their phone and get a notification.">
        <div className="flex flex-col gap-4">
          {conflicts.length ? (
            <>
              <ConflictList conflicts={conflicts} timeZone={timeZone} />
              <p className="text-sm text-muted-foreground">The team was assigned. Reschedule one of the jobs if this clash is a problem.</p>
              <div className="flex justify-end"><Button onClick={() => onOpenChange(false)}>Done</Button></div>
            </>
          ) : (
            <>
              <MemberChecklist members={members} selected={selected} onToggle={toggle} disabledIds={current.map((a) => a.userId)} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="assign-role" className="text-sm font-medium">Role on this job</label>
                <Select id="assign-role" className="h-10" value={role} onChange={(e) => setRole(e.target.value as AssignmentRole)}>
                  {ASSIGNMENT_ROLES.map((r) => <option key={r} value={r}>{ASSIGNMENT_ROLE_LABELS[r]}</option>)}
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button
                  disabled={pending || selected.length === 0}
                  onClick={() => start(async () => {
                    const r = await assignMembersAction(jobId, { userIds: selected, role });
                    if (!r.ok) { toast.error(r.error); return; }
                    toast.success(selected.length === 1 ? "Person assigned" : `${selected.length} people assigned`);
                    setSelected([]);
                    if (r.data.conflicts.length) setConflicts(r.data.conflicts);
                    else onOpenChange(false);
                  })}
                >
                  {pending ? "Assigning…" : "Assign"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
