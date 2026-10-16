"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type TaskPriority } from "@/domain/tasks/schema";
import { createLeadTaskAction } from "@/app/app/sales/leads/actions";
import { fromLocalInput, type Assignee } from "./datetime";

/**
 * Task linked to this lead. (The shared TaskForm only links customers, so this is a small
 * lead-specific form over the same task fields.)
 */
export function LeadTaskForm({ leadId, leadName, assignees, currentUserId, onDone }: {
  leadId: string;
  leadName: string;
  assignees: Assignee[];
  currentUserId: string;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const input = {
        title: String(fd.get("title") ?? ""),
        description: String(fd.get("description") ?? ""),
        priority: String(fd.get("priority") ?? "normal") as TaskPriority,
        dueAt: fromLocalInput(String(fd.get("dueAt") ?? "")),
        assignedTo: String(fd.get("assignedTo") ?? ""),
      };
      start(async () => {
        const r = await createLeadTaskAction(leadId, input);
        if (!r.ok) { setErrors(r.fieldErrors ?? {}); setFormError(r.error); return; }
        toast.success("Task created");
        onDone();
      });
    }}>
      <FormField id="lt-title" label="Title" required error={errors.title?.[0]}>
        {(p) => <Input {...p} name="title" className="h-10" maxLength={200} autoFocus defaultValue={`Follow up ${leadName}`} />}
      </FormField>
      <FormField id="lt-description" label="Details" error={errors.description?.[0]}>
        {(p) => <Textarea {...p} name="description" maxLength={5000} />}
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="lt-priority" label="Priority" required>
          {(p) => (
            <Select {...p} name="priority" className="h-10" defaultValue="normal">
              {TASK_PRIORITIES.map((v) => <option key={v} value={v}>{TASK_PRIORITY_LABELS[v]}</option>)}
            </Select>
          )}
        </FormField>
        <FormField id="lt-due" label="Due" error={errors.dueAt?.[0]}>
          {(p) => <Input {...p} name="dueAt" type="datetime-local" className="h-10" />}
        </FormField>
      </div>
      <FormField id="lt-assignee" label="Assigned to" error={errors.assignedTo?.[0]}>
        {(p) => (
          <Select {...p} name="assignedTo" className="h-10" defaultValue={currentUserId}>
            <option value="">Unassigned</option>
            {assignees.map((a) => <option key={a.userId} value={a.userId}>{a.displayName}</option>)}
          </Select>
        )}
      </FormField>
      {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="lg" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : "Create task"}</Button>
      </div>
    </form>
  );
}
