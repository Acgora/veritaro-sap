"use server";
import { revalidatePath } from "next/cache";
import { getServiceContext } from "@/lib/service-context";
import { updateFinancialSettings } from "@/domain/financial-settings/service";
import type { UpdateFinancialSettingsInput } from "@/domain/financial-settings/schema";

export async function updateFinancialSettingsAction(input: UpdateFinancialSettingsInput) {
  const r = await updateFinancialSettings(await getServiceContext(), input);
  if (r.ok) {
    revalidatePath("/app/settings/financial");
    revalidatePath("/app/today");
  }
  return r;
}
