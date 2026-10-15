"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ACTIVE_ORG_COOKIE, getMemberships } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { getServiceContext } from "@/lib/service-context";
import { markAllNotificationsRead } from "@/domain/notifications/service";
import { createAIClient } from "@/lib/supabase/server";
import { requireAppContext } from "@/lib/context";
import {
  cancelAssistantAction, confirmAssistantAction, handleAssistantMessage, type AssistantReply,
} from "@/lib/ai/orchestrator";
import { resolveScreenContext } from "@/lib/ai/context";
import { archiveCustomer } from "@/domain/customers/service";
import { archiveTask } from "@/domain/tasks/service";
import type { ServiceContext } from "@/domain/context";
import { fail, ok, type ActionResult } from "@/lib/errors";

export async function switchOrganisationAction(organisationId: string): Promise<ActionResult<null>> {
  const memberships = await getMemberships();
  // Cookie is a preference only; we still refuse unknown orgs to avoid confusing state.
  if (!memberships.some((m) => m.organisationId === organisationId)) return fail("You're not a member of that organisation.");
  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, organisationId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/app", "layout");
  return ok(null);
}

export async function markAllNotificationsReadAction(): Promise<ActionResult<{ count: number }>> {
  const ctx = await getServiceContext();
  const result = await markAllNotificationsRead(ctx);
  revalidatePath("/app", "layout");
  return result;
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const store = await cookies();
  store.delete(ACTIVE_ORG_COOKIE);
  redirect("/login");
}

async function aiServiceContext(): Promise<{ ctx: ServiceContext; app: Awaited<ReturnType<typeof requireAppContext>> }> {
  const app = await requireAppContext();
  const supabase = await createAIClient();
  return {
    app,
    ctx: { supabase, organisationId: app.organisation.id, userId: app.userId, permissions: app.permissions, actor: "ai" },
  };
}

export async function askAssistantAction(text: string, conversationId?: string, pathname?: string): Promise<AssistantReply> {
  const { ctx, app } = await aiServiceContext();
  const screen = await resolveScreenContext(ctx, pathname);
  const reply = await handleAssistantMessage(
    {
      ctx,
      organisationName: app.organisation.name,
      timezone: app.organisation.timezone,
      currency: app.organisation.currency,
      userFirstName: app.profile.first_name,
      screen,
    },
    String(text ?? "").slice(0, 2000),
    typeof conversationId === "string" ? conversationId : undefined,
  );
  if (reply.cards.length || reply.status === "answer") revalidatePath("/app", "layout");
  return reply;
}

export async function confirmAssistantActionAction(actionId: string): Promise<AssistantReply> {
  const { ctx } = await aiServiceContext();
  const reply = await confirmAssistantAction(ctx, String(actionId));
  revalidatePath("/app", "layout");
  return reply;
}

export async function cancelAssistantActionAction(actionId: string): Promise<AssistantReply> {
  const { ctx } = await aiServiceContext();
  return cancelAssistantAction(ctx, String(actionId));
}

/** Undo an AI-created draft (customer → archive within the DB's 15-minute creator window; task → archive). */
export async function undoAssistantCardAction(kind: "customer" | "task", id: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await getServiceContext();
  const r = kind === "customer" ? await archiveCustomer(ctx, String(id)) : await archiveTask(ctx, String(id));
  revalidatePath("/app", "layout");
  return r;
}
