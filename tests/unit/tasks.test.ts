import { describe, expect, it, vi } from "vitest";
import { createTaskSchema, updateTaskSchema } from "@/domain/tasks/schema";
import { createTask, deleteTask, updateTask } from "@/domain/tasks/service";
import { PermissionSet } from "@/lib/permissions";
import type { ServiceContext } from "@/domain/context";

/** Chainable fake of the supabase query builder; resolves to `result`. */
function fakeSupabase(result: { data: unknown; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["from", "insert", "update", "delete", "select", "eq", "in", "or", "order", "range", "lt", "gte", "limit"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  return { client: builder as unknown as ServiceContext["supabase"], calls };
}

const ctxWith = (perms: string[], supa = fakeSupabase({ data: { id: "t1" }, error: null })) => ({
  ctx: { supabase: supa.client, organisationId: "org-1", userId: "me", permissions: new PermissionSet(perms), actor: "user" } as ServiceContext,
  supa,
});

describe("task validation", () => {
  it("requires a title", () => {
    expect(createTaskSchema.safeParse({ title: "  " }).success).toBe(false);
  });
  it("normalises empty optional fields to null and defaults priority", () => {
    const r = createTaskSchema.parse({ title: "Call ABC", description: "", dueAt: "", assignedTo: "" });
    expect(r).toMatchObject({ title: "Call ABC", description: null, dueAt: null, assignedTo: null, priority: "normal" });
  });
  it("rejects invalid priority, status and uuid", () => {
    expect(createTaskSchema.safeParse({ title: "x", priority: "critical" }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ status: "deleted" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "x", assignedTo: "not-a-uuid" }).success).toBe(false);
  });
});

describe("task service", () => {
  it("refuses creation without tasks.create and never touches the DB", async () => {
    const { ctx, supa } = ctxWith([]);
    const r = await createTask(ctx, { title: "x" });
    expect(r.ok).toBe(false);
    expect(supa.calls).toHaveLength(0);
  });

  it("refuses assigning to others without tasks.assign", async () => {
    const { ctx, supa } = ctxWith(["tasks.create"]);
    const r = await createTask(ctx, { title: "x", assignedTo: "6f1c2c1e-5b8e-4f43-9d7a-2f3e1c0b9a11" });
    expect(r.ok).toBe(false);
    expect(supa.calls).toHaveLength(0);
  });

  it("creates within the active organisation only (no client-supplied org)", async () => {
    const { ctx, supa } = ctxWith(["tasks.create"]);
    const r = await createTask(ctx, { title: "Quote follow-up", priority: "high" });
    expect(r).toEqual({ ok: true, data: { id: "t1" } });
    const insert = supa.calls.find((c) => c.method === "insert")!;
    expect(insert.args[0]).toMatchObject({ organisation_id: "org-1", title: "Quote follow-up", priority: "high" });
    expect(insert.args[0]).not.toHaveProperty("created_by"); // set by DB trigger
  });

  it("maps database errors to friendly messages (never raw)", async () => {
    const supa = fakeSupabase({ data: null, error: { code: "42501", message: 'new row violates row-level security policy for table "tasks"' } });
    const { ctx } = ctxWith(["tasks.create"], supa);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await createTask(ctx, { title: "x" });
    spy.mockRestore();
    expect(r).toEqual({ ok: false, error: "You don't have permission to do that." });
  });

  it("update scopes by organisation and reports missing rows (RLS-filtered)", async () => {
    const supa = fakeSupabase({ data: null, error: null });
    const { ctx } = ctxWith(["tasks.update_assigned"], supa);
    const r = await updateTask(ctx, "t9", { status: "completed" });
    expect(r.ok).toBe(false);
    expect(supa.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["id", "t9"], ["organisation_id", "org-1"]]);
    const update = supa.calls.find((c) => c.method === "update")!;
    expect(update.args[0]).toEqual({ status: "completed" }); // only provided fields are patched
  });

  it("delete requires tasks.delete", async () => {
    const { ctx, supa } = ctxWith(["tasks.update_all"]);
    expect((await deleteTask(ctx, "t1")).ok).toBe(false);
    expect(supa.calls).toHaveLength(0);
  });
});
