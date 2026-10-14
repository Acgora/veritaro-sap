import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PermissionSet, isRole, type Role } from "@/lib/permissions";
import type { Tables } from "@/types/database.types";

export const ACTIVE_ORG_COOKIE = "veritaro_active_org";

export interface Membership {
  organisationId: string;
  organisationName: string;
  role: Role;
}

export interface AppContext {
  userId: string;
  email: string | null;
  profile: Tables<"profiles">;
  memberships: Membership[];
  organisation: Tables<"organisations">;
  role: Role;
  permissions: PermissionSet;
}

/** Authenticated user + profile, or redirect to login. Cached per request. */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  if (!profile) redirect("/login?error=profile");

  return { supabase, user: data.user, profile };
});

export const getMemberships = cache(async (): Promise<Membership[]> => {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("organisation_members")
    .select("organisation_id, role, organisations(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((m) => isRole(m.role))
    .map((m) => ({
      organisationId: m.organisation_id,
      organisationName: m.organisations?.name ?? "Organisation",
      role: m.role as Role,
    }));
});

/**
 * Full app context for /app routes. The active organisation is chosen from a cookie
 * but ALWAYS validated against the user's real memberships (cookie is a preference,
 * never an authorisation). No membership → onboarding.
 */
export const requireAppContext = cache(async (): Promise<AppContext> => {
  const { supabase, user, profile } = await requireUser();
  const memberships = await getMemberships();
  if (memberships.length === 0) redirect("/onboarding");

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.organisationId === preferred) ?? memberships[0]!;

  const [{ data: organisation, error: orgError }, { data: perms, error: permError }] = await Promise.all([
    supabase.from("organisations").select("*").eq("id", active.organisationId).single(),
    supabase.rpc("get_my_permissions", { p_organisation_id: active.organisationId }),
  ]);
  if (orgError || !organisation) throw orgError ?? new Error("Organisation not found");
  if (permError) throw permError;

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    memberships,
    organisation,
    role: active.role,
    permissions: new PermissionSet(perms ?? []),
  };
});
