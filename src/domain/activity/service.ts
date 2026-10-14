import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { Json } from "@/types/database.types";

export interface ActivityItem {
  id: string;
  action: string;
  actorType: string;
  actorName: string | null;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, Json | undefined>;
  createdAt: string;
}

export async function listRecentActivity(ctx: ServiceContext, limit = 15): Promise<ActionResult<ActivityItem[]>> {
  if (!ctx.permissions.can("activity.read")) return ok([]);
  const { data, error } = await ctx.supabase
    .from("activity_log")
    .select("id, action, actor_type, actor_user_id, entity_type, entity_id, metadata, created_at, actor:profiles!activity_log_actor_user_id_fkey(display_name, first_name)")
    .eq("organisation_id", ctx.organisationId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 50));
  if (error) {
    logServerError("activity.list", error);
    return fail(toUserMessage(error, "We couldn't load recent activity."));
  }
  return ok(
    (data ?? []).map((a) => ({
      id: a.id,
      action: a.action,
      actorType: a.actor_type,
      actorName: a.actor?.display_name || a.actor?.first_name || null,
      actorUserId: a.actor_user_id,
      entityType: a.entity_type,
      entityId: a.entity_id,
      metadata: (a.metadata && typeof a.metadata === "object" && !Array.isArray(a.metadata) ? a.metadata : {}) as Record<string, Json | undefined>,
      createdAt: a.created_at,
    })),
  );
}
