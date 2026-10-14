import "server-only";
import { requireAppContext } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import type { ServiceContext } from "@/domain/context";

/** Builds the ServiceContext for the current request (server actions / RSC). */
export async function getServiceContext(actor: ServiceContext["actor"] = "user"): Promise<ServiceContext> {
  const app = await requireAppContext();
  const supabase = await createClient();
  return {
    supabase,
    organisationId: app.organisation.id,
    userId: app.userId,
    permissions: app.permissions,
    actor,
  };
}
