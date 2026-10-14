import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { Tables } from "@/types/database.types";

export async function listNotifications(
  ctx: ServiceContext,
  limit = 10,
): Promise<ActionResult<{ items: Tables<"notifications">[]; unread: number }>> {
  const [list, unread] = await Promise.all([
    ctx.supabase
      .from("notifications")
      .select("*")
      .eq("organisation_id", ctx.organisationId)
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    ctx.supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", ctx.organisationId)
      .eq("user_id", ctx.userId)
      .is("read_at", null),
  ]);
  const error = list.error ?? unread.error;
  if (error) {
    logServerError("notifications.list", error);
    return fail(toUserMessage(error, "We couldn't load notifications."));
  }
  return ok({ items: list.data ?? [], unread: unread.count ?? 0 });
}

export async function markAllNotificationsRead(ctx: ServiceContext): Promise<ActionResult<{ count: number }>> {
  const { data, error } = await ctx.supabase.rpc("mark_notifications_read", { p_organisation_id: ctx.organisationId });
  if (error) {
    logServerError("notifications.markRead", error);
    return fail(toUserMessage(error, "We couldn't update notifications."));
  }
  return ok({ count: data ?? 0 });
}
