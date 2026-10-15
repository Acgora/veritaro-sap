import { z } from "zod";
import { completeTask, createTask, listTasks } from "@/domain/tasks/service";
import { TASK_PRIORITIES } from "@/domain/tasks/schema";
import { ok } from "@/lib/errors";
import type { AIToolDefinition } from "../types";

const createTaskInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional().describe("ISO 8601 with timezone offset"),
  customerId: z.uuid().optional().describe("Link to a customer id from search_customers"),
});

export const createTaskTool: AIToolDefinition<typeof createTaskInput, { id: string }> = {
  name: "create_task",
  description: "Create a task/reminder for the current user, optionally linked to a customer.",
  actionClass: "draft",
  requiredPermissions: ["tasks.create"],
  inputSchema: createTaskInput,
  execute: (ctx, input) => createTask(ctx, { ...input, assignedTo: ctx.userId }),
  summarise: (i) => `Create task “${i.title}”${i.dueAt ? ` due ${i.dueAt}` : ""}`,
  card: (i, out) => ({ label: `Task: ${i.title}`, href: "/app/work/tasks", undo: { kind: "task", id: out.id } }),
};

const listOpenInput = z.object({ scope: z.enum(["all", "mine"]).optional() });

export const listOpenTasksTool: AIToolDefinition<typeof listOpenInput> = {
  name: "list_open_tasks",
  description: "List up to 20 open and in-progress tasks the user can see (title, priority, due date, linked customer id).",
  actionClass: "read",
  requiredPermissions: [],
  requiredAnyOf: ["tasks.read_all", "tasks.read_assigned"],
  inputSchema: listOpenInput,
  execute: async (ctx, input) => {
    const r = await listTasks(ctx, { status: "active", scope: input.scope ?? "all", pageSize: 20 });
    if (!r.ok) return r;
    return ok({
      total: r.data.total,
      tasks: r.data.tasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, dueAt: t.due_at,
        customerId: t.related_entity_type === "customer" ? t.related_entity_id : null })),
    });
  },
  summarise: () => "List open tasks",
};

const completeInput = z.object({ taskId: z.uuid() });

export const completeTaskTool: AIToolDefinition<typeof completeInput> = {
  name: "complete_task",
  description: "Mark a task as completed (it can be reopened).",
  actionClass: "draft",
  requiredPermissions: [],
  requiredAnyOf: ["tasks.update_all", "tasks.update_assigned"],
  inputSchema: completeInput,
  execute: (ctx, i) => completeTask(ctx, i.taskId),
  summarise: () => "Complete a task",
  card: () => ({ label: "Open tasks", href: "/app/work/tasks?status=completed" }),
};
