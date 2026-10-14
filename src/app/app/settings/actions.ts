"use server";
import { revalidatePath } from "next/cache";
import { getServiceContext } from "@/lib/service-context";
import { requireUser } from "@/lib/context";
import { updateOrganisation } from "@/domain/organisations/service";
import { updateMyProfile, type ProfileInput } from "@/domain/profiles/service";
import { changeMemberRole } from "@/domain/members/service";
import type { OrganisationUpdateInput } from "@/domain/organisations/schema";

export async function updateOrganisationAction(input: OrganisationUpdateInput) {
  const r = await updateOrganisation(await getServiceContext(), input);
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

export async function updateProfileAction(input: ProfileInput) {
  const { supabase, user } = await requireUser();
  const r = await updateMyProfile(supabase, user.id, input);
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

export async function changeMemberRoleAction(memberId: string, role: string) {
  const r = await changeMemberRole(await getServiceContext(), memberId, role);
  if (r.ok) revalidatePath("/app/settings/members");
  return r;
}
