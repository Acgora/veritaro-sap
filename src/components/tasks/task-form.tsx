"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type TaskPriority } from "@/domain/tasks/schema";
import type { TaskWithAssignee } from "@/domain/tasks/service";
import type { ActionResult } from "@/lib/errors";
import { createTaskAction, updateTaskAction } from "@/app/app/work/tasks/actions";

export interface Assignee {
  userId: string;
  displayName: string;
}

/** ISO → value for <input type="datetime-local"> in the browser's local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TaskForm({
  task,
  assignees,
  canAssign,
  currentUserId,
  customers = [],
  presetCustomerId,
  onDone,
}: {
  task?: TaskWithAssignee;
  assignees: Assignee[];
  canAssign: boolean;
  currentUserId: string;
  customers?: { id: string; display_name: string }[];
  presetCustomerId?: string;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (fd: FormData) => {
    const dueLocal = String(fd.get("dueAt") ?? "");
    const input = {
      title: String(fd.get("title") ?? ""),
      description: String(fd.get("description") ?? ""),
      priority: String(fd.get("priority") ?? "normal") as TaskPriority,
      dueAt: dueLocal ? new Date(dueLocal).toISOString() : "",
      assignedTo: String(fd.get("assignedTo") ?? ""),
      ...(customers.length > 0 ? { customerId: String(fd.get("customerId") ?? "") } : {}),
    };
    start(async () => {
      const r: ActionResult<{ id: string }> = task ? await updateTaskAction(task.id, input) : await createTaskAction(input);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.error);
        return;
      }
      toast.success(task ? "Task updated" : "Task created");
      onDone();
    });
  };

  const defaultAssignee = task ? (task.assigned_to ?? "") : currentUserId;

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }} className="flex flex-col gap-4" noValidate>
      <FormField id="title" label="Title" required error={errors.title?.[0]}>
        {(p) => <Input {...p} name="title" defaultValue={task?.title} maxLength={200} autoFocus />}
      </FormField>
      <FormField id="description" label="Details" error={errors.description?.[0]}>
        {(p) => <Textarea {...p} name="description" defaultValue={task?.description ?? ""} maxLength={5000} />}
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="priority" label="Priority" required error={errors.priority?.[0]}>
          {(p) => (
            <Select {...p} name="priority" defaultValue={task?.priority ?? "normal"}>
              {TASK_PRIORITIES.map((v) => <option key={v} value={v}>{TASK_PRIORITY_LABELS[v]}</option>)}
            </Select>
          )}
        </FormField>
        <FormField id="dueAt" label="Due" error={errors.dueAt?.[0]}>
          {(p) => <Input {...p} name="dueAt" type="datetime-local" defaultValue={toLocalInput(task?.due_at ?? null)} />}
        </FormField>
      </div>
      <FormField id="assignedTo" label="Assigned to" error={errors.assignedTo?.[0]} hint={canAssign ? undefined : "You can assign tasks to yourself."}>
        {(p) => (
          <Select {...p} name="assignedTo" defaultValue={defaultAssignee}>
            <option value="">Unassigned</option>
            {assignees.map((a) => <option key={a.userId} value={a.userId}>{a.displayName}</option>)}
          </Select>
        )}
      </FormField>
      {customers.length > 0 ? (
        <FormField id="customerId" label="Customer" error={errors.customerId?.[0]}>
          {(p) => (
            <Select {...p} name="customerId" defaultValue={task?.related_entity_type === "customer" ? (task.related_entity_id ?? "") : (presetCustomerId ?? "")}>
              <option value="">Not linked</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </Select>
          )}
        </FormField>
      ) : null}
      {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : task ? "Save changes" : "Create task"}</Button>
      </div>
    </form>
  );
}
