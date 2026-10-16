"use server";
import { getServiceContext } from "@/lib/service-context";
import { globalSearch, type SearchResult } from "@/domain/search/service";
import type { ActionResult } from "@/lib/errors";

/** Command palette search. Read-only; RLS (invoker RPC) limits results to what the user may see. */
export async function globalSearchAction(q: string): Promise<ActionResult<SearchResult[]>> {
  const ctx = await getServiceContext();
  return globalSearch(ctx, typeof q === "string" ? q : "", 6);
}
