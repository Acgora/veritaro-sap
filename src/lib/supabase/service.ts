import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * SERVICE-ROLE CLIENT — bypasses RLS. Server-only.
 *
 * Permitted uses (keep this list short; review any new import of this module):
 *   1. AI metering RPCs (ai_begin_request / ai_record_usage / ai_finish_request)
 *   2. Reading AI model routes (platform config)
 * Never use it to read or write tenant business data — that always goes through the
 * user's RLS-bound client so tenancy and roles are enforced by the database.
 *
 * Returns null when SUPABASE_SECRET_KEY is not configured; callers must degrade gracefully.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) return null;
  return createSupabaseClient<Database>(publicEnv.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type ServiceSupabase = NonNullable<ReturnType<typeof createServiceClient>>;
