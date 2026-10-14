import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissionSet } from "@/lib/permissions";
import type { Database } from "@/types/database.types";

/**
 * Everything a domain service needs. Built once per request by the caller
 * (server action, AI tool executor, future API route). Services NEVER read
 * cookies/headers themselves — this keeps UI, quick actions and AI on the
 * same code path.
 */
export interface ServiceContext {
  supabase: SupabaseClient<Database>;
  organisationId: string;
  userId: string;
  permissions: PermissionSet;
  /** Who initiated the action — recorded in activity_log in later phases. */
  actor: "user" | "ai" | "system" | "integration";
}
