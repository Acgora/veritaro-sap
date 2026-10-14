import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ACTION_CLASSES, ACTION_CLASS_POLICY, type AIToolDefinition } from "@/lib/ai/types";
import { AI_TOOLS, PLANNED_AI_TOOLS } from "@/lib/ai/registry";
import { PermissionSet } from "@/lib/permissions";
import type { ServiceContext } from "@/domain/context";
import { handleCommand, isAssistantConfigured } from "@/lib/ai/command-service";

const sendSpy = vi.fn(async () => ({ ok: true as const, data: { sent: true } }));
const fakeConsequential: AIToolDefinition = {
  name: "send_test_message",
  description: "test",
  actionClass: "consequential",
  requiredPermissions: ["tasks.create"],
  inputSchema: z.object({ to: z.string(), body: z.string() }),
  execute: sendSpy,
  summarise: (i) => `Send to ${(i as { to: string }).to}`,
};

vi.mock("@/lib/ai/registry", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/registry")>();
  return {
    ...actual,
    findTool: (name: string) => (name === "send_test_message" ? fakeConsequential : actual.findTool(name)),
  };
});

const { executeTool, fingerprint } = await import("@/lib/ai/executor");

function ctx(perms: string[]): ServiceContext {
  return { supabase: {} as ServiceContext["supabase"], organisationId: "org", userId: "user-1", permissions: new PermissionSet(perms), actor: "user" };
}

describe("AI action safety model", () => {
  it("only consequential actions require confirmation", () => {
    expect(ACTION_CLASSES).toEqual(["read", "draft", "consequential"]);
    expect(ACTION_CLASS_POLICY.read.requiresConfirmation).toBe(false);
    expect(ACTION_CLASS_POLICY.draft.requiresConfirmation).toBe(false);
    expect(ACTION_CLASS_POLICY.consequential.requiresConfirmation).toBe(true);
  });

  it("every registered and planned tool declares a valid class and unique name", () => {
    const names = [...AI_TOOLS, ...PLANNED_AI_TOOLS].map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of [...AI_TOOLS, ...PLANNED_AI_TOOLS]) expect(ACTION_CLASSES).toContain(t.actionClass);
  });

  it("send_* tools are classified consequential", () => {
    for (const t of PLANNED_AI_TOOLS.filter((t) => t.name.startsWith("send_"))) expect(t.actionClass).toBe("consequential");
  });

  it("refuses consequential execution without confirmation", async () => {
    const out = await executeTool(ctx(["tasks.create"]), "send_test_message", { to: "ABC", body: "hi" });
    expect(out.status).toBe("needs_confirmation");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("refuses confirmation for different input or a different user", async () => {
    const fp = fingerprint("send_test_message", { to: "ABC", body: "hi" });
    const changed = await executeTool(ctx(["tasks.create"]), "send_test_message", { to: "XYZ", body: "hi" }, { toolName: "send_test_message", inputFingerprint: fp, confirmedByUserId: "user-1" });
    expect(changed.status).toBe("needs_confirmation");
    const otherUser = await executeTool(ctx(["tasks.create"]), "send_test_message", { to: "ABC", body: "hi" }, { toolName: "send_test_message", inputFingerprint: fp, confirmedByUserId: "user-2" });
    expect(otherUser.status).toBe("needs_confirmation");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("executes consequential action with matching confirmation, as actor=ai", async () => {
    const fp = fingerprint("send_test_message", { body: "hi", to: "ABC" }); // key order independent
    const out = await executeTool(ctx(["tasks.create"]), "send_test_message", { to: "ABC", body: "hi" }, { toolName: "send_test_message", inputFingerprint: fp, confirmedByUserId: "user-1" });
    expect(out.status).toBe("executed");
    expect(sendSpy).toHaveBeenCalledOnce();
    expect((sendSpy.mock.calls[0] as unknown as [ServiceContext])[0].actor).toBe("ai");
  });

  it("denies when permissions are missing (before confirmation)", async () => {
    const out = await executeTool(ctx([]), "send_test_message", { to: "ABC", body: "hi" });
    expect(out.status).toBe("denied");
  });

  it("rejects invalid input, unknown and planned tools", async () => {
    expect((await executeTool(ctx(["tasks.create"]), "send_test_message", { to: 1 })).status).toBe("invalid_input");
    expect((await executeTool(ctx([]), "launch_rockets", {})).status).toBe("unknown_tool");
    expect((await executeTool(ctx([]), "send_whatsapp", {})).status).toBe("not_implemented");
  });

  it("assistant does not fabricate answers when no model is connected", async () => {
    expect(isAssistantConfigured()).toBe(false);
    const r = await handleCommand("How much does ABC owe?");
    expect(r.status).toBe("unavailable");
  });
});
