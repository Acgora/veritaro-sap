import { z } from "zod";
import { fail, ok, toUserMessage, logServerError, type ActionResult } from "@/lib/errors";
import { ROLES, isRole, type Role } from "@/lib/permissions";
import type { ServiceContext } from "@/domain/context";

export interface MemberRow {
  id: string;
  userId: string;
  role: Role;
  status: string;
  createdAt: string;
  displayName: string;
  phone: string | null;
}

export async function listMembers(ctx: ServiceContext): Promise<ActionResult<MemberRow[]>> {
  const { data, error } = await ctx.supabase
    .from("organisation_members")
    .select("id, user_id, role, status, created_at, profile:profiles!organisation_members_user_id_fkey(display_name, first_name, last_name, phone)")
    .eq("organisation_id", ctx.organisationId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    logServerError("members.list", error);
    return fail(toUserMessage(error, "We couldn't load members."));
  }
  return ok(
    (data ?? []).filter((m) => isRole(m.role)).map((m) => ({
      id: m.id,
      userId: m.user_id,
      role: m.role as Role,
      status: m.status,
      createdAt: m.created_at,
      displayName:
        m.profile?.display_name || [m.profile?.first_name, m.profile?.last_name].filter(Boolean).join(" ") || "Unnamed member",
      phone: m.profile?.phone ?? null,
    })),
  );
}

const roleSchema = z.enum(ROLES);

export async function changeMemberRole(ctx: ServiceContext, memberId: string, role: string): Promise<ActionResult<{ id: string }>> {
  if (!ctx.permissions.can("members.manage")) return fail("You don't have permission to manage members.");
  const parsed = roleSchema.safeParse(role);
  if (!parsed.success) return fail("Choose a valid role.");
  if (parsed.data === "owner" && !ctx.permissions.can("organisation.transfer_ownership")) {
    return fail("Only an owner can grant the owner role.");
  }
  const { data, error } = await ctx.supabase
    .from("organisation_members")
    .update({ role: parsed.data })
    .eq("id", memberId)
    .eq("organisation_id", ctx.organisationId)
    .select("id")
    .maybeSingle();
  if (error) {
    logServerError("members.changeRole", error);
    return fail(toUserMessage(error, "We couldn't change the role."));
  }
  if (!data) return fail("We couldn't find that member.");
  return ok({ id: data.id });
}
