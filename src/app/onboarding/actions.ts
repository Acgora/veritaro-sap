"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, ACTIVE_ORG_COOKIE } from "@/lib/context";
import { createOrganisation } from "@/domain/organisations/service";
import type { ActionResult } from "@/lib/errors";

export async function createOrganisationAction(_: ActionResult<null> | null, formData: FormData): Promise<ActionResult<null>> {
  const { supabase } = await requireUser();
  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const result = await createOrganisation(supabase, {
    name: str("name") ?? "",
    country: str("country") ?? "",
    currency: str("currency") ?? "",
    timezone: str("timezone") ?? "",
    legalName: str("legalName"),
    registrationNumber: str("registrationNumber"),
    taxNumber: str("taxNumber"),
    vatNumber: str("vatNumber"),
  });
  if (!result.ok) return result;

  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, result.data.organisationId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/app/today");
}
