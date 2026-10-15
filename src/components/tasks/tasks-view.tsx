"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Archive, CheckCircle2, Circle, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, ListTodo } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge, type BadgeTone } from "@/components/common/status-badge";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { PermissionSet } from "@/lib/permissions";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskPriority, type TaskStatus } from "@/domain/tasks/schema";
import type { TaskWithAssignee } from "@/domain/tasks/service";
import type { ActionResult } from "@/lib/errors";
import { archiveTaskAction, completeTaskAction, deleteTaskAction, reopenTaskAction } from "@/app/app/work/tasks/actions";
import { TaskForm, type Assignee } from "./task-form";

const STATUS_TABS = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
] as const;

const priorityTone: Record<TaskPriority, BadgeTone> = { low: "neutral", normal: "neutral", high: "warning", urgent: "danger" };
const statusTone: Record<TaskStatus, BadgeTone> = { open: "info", in_progress: "info", completed: "success", archived: "neutral" };

export function TasksView(props: {
  tasks: TaskWithAssignee[];
  total: number;
  page: number;
  pageSize: number;
  filters: { status: string; scope: string };
  assignees: Assignee[];
  currentUserId: string;
  timeZone: string;
  permissions: string[];
  openCreate: boolean;
  customers?: { id: string; display_name: string }[];
  presetCustomerId?: string;
}) {
  const { tasks, total, page, pageSize, filters, assignees, currentUserId, timeZone } = props;
  const perms = new PermissionSet(props.permissions);
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(props.openCreate);
  const [editing, setEditing] = useState<TaskWithAssignee | null>(null);
  const [deleting, setDeleting] = useState<TaskWithAssignee | null>(null);
  const [pending, start] = useTransition();

  const canEdit = (t: TaskWithAssignee) =>
    perms.can("tasks.update_all") || (perms.can("tasks.update_assigned") && (t.assigned_to === currentUserId || t.created_by === currentUserId));

  const href = (patch: Record<string, string | number>) => {
    const q = new URLSearchParams({ status: filters.status, scope: filters.scope, page: String(page), ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])) });
    return `${pathname}?${q.toString()}`;
  };

  const run = (fn: () => Promise<ActionResult<{ id: string }>>, success: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(success);
      else toast.error(r.error);
    });

  const closeCreate = () => {
    setCreating(false);
    if (props.openCreate) router.replace(href({}));
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={cn(pending && "opacity-70 transition-opacity")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav aria-label="Task status" className="flex rounded-md border border-border bg-surface p-0.5">
          {STATUS_TABS.map((t) => (
            <Link
              key={t.value}
              href={href({ status: t.value, page: 1 })}
              aria-current={filters.status === t.value ? "page" : undefined}
              className={cn("rounded px-3 py-1 text-sm text-muted-foreground", filters.status === t.value && "bg-surface-raised font-medium text-foreground")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Task scope" className="flex rounded-md border border-border bg-surface p-0.5">
          {(["all", "mine"] as const).map((s) => (
            <Link
              key={s}
              href={href({ scope: s, page: 1 })}
              aria-current={filters.scope === s ? "page" : undefined}
              className={cn("rounded px-3 py-1 text-sm text-muted-foreground", filters.scope === s && "bg-surface-raised font-medium text-foreground")}
            >
              {s === "all" ? "All visible" : "Mine"}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        {perms.can("tasks.create") ? (
          <Button size="sm" onClick={() => setCreating(true)}><Plus /> New task</Button>
        ) : null}
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={ListTodo}
            title={filters.status === "active" ? "No open tasks" : `No ${filters.status} tasks`}
            description={filters.status === "active" ? "Add reminders for follow-ups, site visits and admin. They'll show on Today when they're due." : undefined}
            action={perms.can("tasks.create") && filters.status === "active" ? <Button size="sm" onClick={() => setCreating(true)}><Plus /> New task</Button> : undefined}
          />
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {tasks.map((t) => {
            const done = t.status === "completed";
            const editable = canEdit(t);
            const overdue = !done && t.due_at && new Date(t.due_at) < new Date();
            const assigneeName = t.assignee ? t.assignee.display_name || t.assignee.first_name || "Member" : null;
            return (
              <li key={t.id} className="flex items-start gap-3 px-3 py-2.5">
                <button
                  type="button"
                  disabled={!editable || pending || t.status === "archived"}
                  onClick={() => run(() => (done ? reopenTaskAction(t.id) : completeTaskAction(t.id)), done ? "Task reopened" : "Task completed")}
                  className="mt-0.5 text-muted-foreground hover:text-success disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={done ? `Reopen “${t.title}”` : `Mark “${t.title}” complete`}
                >
                  {done ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}>{t.title}</p>
                  {t.description ? <p className="line-clamp-1 text-sm text-muted-foreground">{t.description}</p> : null}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {t.due_at ? (
                      <span className={cn(overdue && "font-medium text-danger")}>
                        {overdue ? "Overdue · " : "Due "}
                        <time dateTime={t.due_at}>{formatDateTime(t.due_at, timeZone)}</time>
                      </span>
                    ) : null}
                    <span>{assigneeName ? `Assigned to ${assigneeName}` : "Unassigned"}</span>
                    {t.related_entity_type === "customer" && t.related_entity_id ? (
                      <Link href={`/app/sales/customers/${t.related_entity_id}`} className="text-primary hover:underline">
                        {props.customers?.find((c) => c.id === t.related_entity_id)?.display_name ?? "Customer"}
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {t.priority !== "normal" ? <StatusBadge tone={priorityTone[t.priority as TaskPriority]}>{TASK_PRIORITY_LABELS[t.priority as TaskPriority]}</StatusBadge> : null}
                  <StatusBadge tone={statusTone[t.status as TaskStatus]} className="hidden sm:inline-flex">{TASK_STATUS_LABELS[t.status as TaskStatus]}</StatusBadge>
                  {editable || perms.can("tasks.delete") ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger className="rounded p-1 text-muted-foreground hover:bg-surface-raised" aria-label={`Actions for “${t.title}”`}>
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {editable ? <DropdownMenuItem onSelect={() => setEditing(t)}><Pencil /> Edit</DropdownMenuItem> : null}
                        {editable && t.status !== "archived" ? (
                          <DropdownMenuItem onSelect={() => run(() => archiveTaskAction(t.id), "Task archived")}><Archive /> Archive</DropdownMenuItem>
                        ) : null}
                        {editable && t.status === "archived" ? (
                          <DropdownMenuItem onSelect={() => run(() => reopenTaskAction(t.id), "Task restored")}><RotateCcw /> Restore</DropdownMenuItem>
                        ) : null}
                        {perms.can("tasks.delete") ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-danger [&_svg]:text-danger" onSelect={() => setDeleting(t)}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {pages} · {total} tasks</span>
          <div className="flex gap-2">
            {page > 1 ? <Button asChild variant="secondary" size="sm"><Link href={href({ page: page - 1 })}>Previous</Link></Button> : null}
            {page < pages ? <Button asChild variant="secondary" size="sm"><Link href={href({ page: page + 1 })}>Next</Link></Button> : null}
          </div>
        </nav>
      ) : null}

      <Dialog open={creating} onOpenChange={(o) => (o ? setCreating(true) : closeCreate())}>
        <DialogContent title="New task">
          <TaskForm assignees={assignees} canAssign={perms.can("tasks.assign")} currentUserId={currentUserId} customers={props.customers} presetCustomerId={props.presetCustomerId} onDone={closeCreate} />
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this task?"
        description={`“${deleting?.title ?? ""}” will be permanently deleted. The deletion is recorded in the activity history.`}
        confirmLabel="Delete task"
        onConfirm={async () => {
          if (!deleting) return;
          const r = await deleteTaskAction(deleting.id);
          if (r.ok) toast.success("Task deleted");
          else toast.error(r.error);
          return r.ok;
        }}
      />
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title="Edit task">
          {editing ? <TaskForm task={editing} assignees={assignees} canAssign={perms.can("tasks.assign")} currentUserId={currentUserId} customers={props.customers} onDone={() => setEditing(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
