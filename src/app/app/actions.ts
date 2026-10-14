"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ACTIVE_ORG_COOKIE, getMemberships } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { getServiceContext } from "@/lib/service-context";
import { markAllNotificationsRead } from "@/domain/notifications/service";
import { handleCommand, type CommandResponse } from "@/lib/ai/command-service";
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

export async function askAssistantAction(text: string): Promise<CommandResponse> {
  await getServiceContext(); // ensures an authenticated member; future: passed to the AI executor
  return handleCommand(text.slice(0, 4000));
}
