"use server";
import { revalidatePath } from "next/cache";
import { getServiceContext } from "@/lib/service-context";
import { archiveTask, completeTask, createTask, deleteTask, reopenTask, updateTask } from "@/domain/tasks/service";
import type { CreateTaskInput, UpdateTaskInput } from "@/domain/tasks/schema";

/** Thin adapters: build context → call domain service → revalidate. No business logic here. */
function refresh() {
  revalidatePath("/app/work/tasks");
  revalidatePath("/app/today");
}

export async function createTaskAction(input: CreateTaskInput) {
  const r = await createTask(await getServiceContext(), input);
  if (r.ok) refresh();
  return r;
}

export async function updateTaskAction(id: string, input: UpdateTaskInput) {
  const r = await updateTask(await getServiceContext(), id, input);
  if (r.ok) refresh();
  return r;
}

export async function completeTaskAction(id: string) {
  const r = await completeTask(await getServiceContext(), id);
  if (r.ok) refresh();
  return r;
}

export async function reopenTaskAction(id: string) {
  const r = await reopenTask(await getServiceContext(), id);
  if (r.ok) refresh();
  return r;
}

export async function archiveTaskAction(id: string) {
  const r = await archiveTask(await getServiceContext(), id);
  if (r.ok) refresh();
  return r;
}

export async function deleteTaskAction(id: string) {
  const r = await deleteTask(await getServiceContext(), id);
  if (r.ok) refresh();
  return r;
}
