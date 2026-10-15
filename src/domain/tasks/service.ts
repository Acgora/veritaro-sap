import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { Tables } from "@/types/database.types";
import {
  createTaskSchema,
  listTasksSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type ListTasksInput,
  type UpdateTaskInput,
} from "./schema";

/**
 * Task business logic — the single implementation used by UI forms, quick
 * actions and AI tools. Permission checks here are for early, friendly errors;
 * RLS + DB guard triggers remain the security boundary.
 * Activity logging happens in the database (tasks_audit trigger), so it can
 * never be skipped by a caller.
 */

export const TASK_SELECT =
  "id, organisation_id, title, description, status, priority, due_at, assigned_to, created_by, completed_at, created_at, updated_at, related_entity_type, related_entity_id, assignee:profiles!tasks_assigned_to_fkey(id, display_name, first_name, last_name)" as const;

export type TaskWithAssignee = Tables<"tasks"> & {
  assignee: Pick<Tables<"profiles">, "id" | "display_name" | "first_name" | "last_name"> | null;
};

export async function listTasks(
  ctx: ServiceContext,
  input: ListTasksInput = {},
): Promise<ActionResult<{ tasks: TaskWithAssignee[]; total: number; page: number; pageSize: number }>> {
  const parsed = listTasksSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid filter");
  const { status, scope, page, pageSize } = parsed.data;

  let query = ctx.supabase
    .from("tasks")
    .select(TASK_SELECT, { count: "exact" })
    .eq("organisation_id", ctx.organisationId);

  query = status === "active" ? query.in("status", ["open", "in_progress"]) : query.eq("status", status);
  if (scope === "mine") query = query.or(`assigned_to.eq.${ctx.userId},created_by.eq.${ctx.userId}`);

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) {
    logServerError("tasks.list", error);
    return fail(toUserMessage(error, "We couldn't load tasks."));
  }
  return ok({ tasks: (data ?? []) as unknown as TaskWithAssignee[], total: count ?? 0, page, pageSize });
}

export async function createTask(ctx: ServiceContext, input: CreateTaskInput): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("tasks.create")) return fail("You don't have permission to create tasks.");

  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;

  if (v.assignedTo && v.assignedTo !== ctx.userId && !ctx.permissions.can("tasks.assign")) {
    return fail("You can only assign tasks to yourself.");
  }

  const { data, error } = await ctx.supabase
    .from("tasks")
    .insert({
      organisation_id: ctx.organisationId,
      title: v.title,
      description: v.description,
      priority: v.priority,
      due_at: v.dueAt,
      assigned_to: v.assignedTo,
      related_entity_type: v.customerId ? "customer" : null,
      related_entity_id: v.customerId,
    })
    .select("id")
    .single();

  if (error) {
    logServerError("tasks.create", error);
    return fail(toUserMessage(error, "We couldn't create the task."));
  }
  return ok({ id: data.id });
}

export async function updateTask(
  ctx: ServiceContext,
  taskId: string,
  input: UpdateTaskInput,
): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.canAny("tasks.update_all", "tasks.update_assigned")) {
    return fail("You don't have permission to edit tasks.");
  }
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) return fail("Please check the highlighted fields.", parsed.error.flatten().fieldErrors);
  const v = parsed.data;

  const patch: Partial<Tables<"tasks">> = {};
  if (v.title !== undefined) patch.title = v.title;
  if (input.description !== undefined) patch.description = v.description ?? null;
  if (v.priority !== undefined && input.priority !== undefined) patch.priority = v.priority;
  if (input.dueAt !== undefined) patch.due_at = v.dueAt ?? null;
  if (input.assignedTo !== undefined) patch.assigned_to = v.assignedTo ?? null;
  if (v.status !== undefined) patch.status = v.status;
  if (input.customerId !== undefined) {
    patch.related_entity_type = v.customerId ? "customer" : null;
    patch.related_entity_id = v.customerId ?? null;
  }

  if (Object.keys(patch).length === 0) return ok({ id: taskId });

  const { data, error } = await ctx.supabase
    .from("tasks")
    .update(patch)
    .eq("id", taskId)
    .eq("organisation_id", ctx.organisationId)
    .select("id")
    .maybeSingle();

  if (error) {
    logServerError("tasks.update", error);
    return fail(toUserMessage(error, "We couldn't update the task."));
  }
  if (!data) return fail("We couldn't find that task, or you don't have access to it.");
  return ok({ id: data.id });
}

export const completeTask = (ctx: ServiceContext, id: string) => updateTask(ctx, id, { status: "completed" });
export const reopenTask = (ctx: ServiceContext, id: string) => updateTask(ctx, id, { status: "open" });
export const archiveTask = (ctx: ServiceContext, id: string) => updateTask(ctx, id, { status: "archived" });

export async function deleteTask(ctx: ServiceContext, taskId: string): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("tasks.delete")) return fail("You don't have permission to delete tasks. Archive it instead.");
  const { data, error } = await ctx.supabase
    .from("tasks")
    .delete()
    .eq("id", taskId)
    .eq("organisation_id", ctx.organisationId)
    .select("id")
    .maybeSingle();
  if (error) {
    logServerError("tasks.delete", error);
    return fail(toUserMessage(error, "We couldn't delete the task."));
  }
  if (!data) return fail("We couldn't find that task, or you don't have access to it.");
  return ok({ id: data.id });
}

/** Lightweight counts for Today — uses head:true counts, never fetches rows. */
export async function getTaskCounts(ctx: ServiceContext, dayStartIso: string, dayEndIso: string) {
  const base = () =>
    ctx.supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", ctx.organisationId)
      .in("status", ["open", "in_progress"]);

  const [overdue, dueToday] = await Promise.all([
    base().lt("due_at", dayStartIso),
    base().gte("due_at", dayStartIso).lt("due_at", dayEndIso),
  ]);
  const error = overdue.error ?? dueToday.error;
  if (error) {
    logServerError("tasks.counts", error);
    return fail(toUserMessage(error, "We couldn't load task counts."));
  }
  return ok({ overdue: overdue.count ?? 0, dueToday: dueToday.count ?? 0 });
}

export async function listTasksDueBetween(ctx: ServiceContext, startIso: string, endIso: string, limit = 10) {
  const { data, error } = await ctx.supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("organisation_id", ctx.organisationId)
    .in("status", ["open", "in_progress"])
    .gte("due_at", startIso)
    .lt("due_at", endIso)
    .order("due_at", { ascending: true })
    .limit(limit);
  if (error) {
    logServerError("tasks.dueBetween", error);
    return fail(toUserMessage(error, "We couldn't load today's tasks."));
  }
  return ok((data ?? []) as unknown as TaskWithAssignee[]);
}
