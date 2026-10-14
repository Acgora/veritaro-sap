import { z } from "zod";
import { createTask, listTasks } from "@/domain/tasks/service";
import { TASK_PRIORITIES } from "@/domain/tasks/schema";
import type { AIToolDefinition } from "../types";

const createTaskInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
});

export const createTaskTool: AIToolDefinition<typeof createTaskInput, { id: string }> = {
  name: "create_task",
  description: "Create a task/reminder for the current user in the active organisation.",
  actionClass: "draft",
  requiredPermissions: ["tasks.create"],
  inputSchema: createTaskInput,
  execute: (ctx, input) => createTask(ctx, { ...input, assignedTo: ctx.userId }),
  summarise: (i) => `Create task “${i.title}”${i.dueAt ? ` due ${i.dueAt}` : ""}`,
};

const listOpenInput = z.object({ scope: z.enum(["all", "mine"]).optional() });

export const listOpenTasksTool: AIToolDefinition<typeof listOpenInput> = {
  name: "list_open_tasks",
  description: "List open and in-progress tasks the user can see.",
  actionClass: "read",
  requiredPermissions: [],
  inputSchema: listOpenInput,
  execute: (ctx, input) => listTasks(ctx, { status: "active", scope: input.scope ?? "all", pageSize: 20 }),
  summarise: () => "List open tasks",
};
