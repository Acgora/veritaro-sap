import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Server-side Supabase client bound to the signed-in user's session.
 * Uses the publishable key: every query is subject to RLS as the user.
 * There is intentionally NO service-role client in Phase 001.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // Session refresh is handled by middleware, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Same user-bound, RLS-enforced client, but every request carries x-veritaro-actor: ai so
 * the database records AI-originated changes with actor_type = 'ai' (still tied to the user).
 */
export async function createAIClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    global: { headers: { "x-veritaro-actor": "ai" } },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => {
        /* AI calls never refresh the session; middleware does. */
      },
    },
  });
}

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
