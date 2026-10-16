import { fail, logServerError, ok, toUserMessage, type ActionResult } from "@/lib/errors";
import type { ServiceContext } from "@/domain/context";
import type { StatusEntity } from "@/lib/status";

export const SEARCH_ENTITY_TYPES = ["customer", "contact", "lead", "quote", "job", "invoice"] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

/** Group headings, in display order. */
export const SEARCH_GROUP_LABELS: Record<SearchEntityType, string> = {
  customer: "Customers",
  contact: "Contacts",
  lead: "Leads",
  quote: "Quotes",
  job: "Jobs",
  invoice: "Invoices",
};

export interface SearchResult {
  /** Unique within one result set (contacts share their customer's id). */
  key: string;
  entityType: SearchEntityType;
  id: string;
  title: string;
  subtitle: string | null;
  /** Raw DB status (the RPC doesn't derive expired/overdue). */
  status: string | null;
  /** Which status vocabulary to render with EntityStatus; null = no lifecycle badge. */
  statusEntity: StatusEntity | null;
  href: string;
  rank: number;
}

export function isSearchEntityType(t: string): t is SearchEntityType {
  return (SEARCH_ENTITY_TYPES as readonly string[]).includes(t);
}

/** Where a search hit opens. NOTE: global_search returns the CUSTOMER id for 'contact' rows. Pure — unit-tested. */
export function searchHref(entityType: SearchEntityType, id: string): string {
  switch (entityType) {
    case "customer":
      return `/app/sales/customers/${id}`;
    case "contact":
      return `/app/sales/customers/${id}?tab=contacts`;
    case "lead":
      return `/app/sales/leads/${id}`;
    case "quote":
      return `/app/sales/quotes/${id}`;
    case "job":
      return `/app/work/jobs/${id}`;
    case "invoice":
      return `/app/money/invoices/${id}`;
  }
}

export function searchStatusEntity(entityType: SearchEntityType): StatusEntity | null {
  return entityType === "lead" || entityType === "quote" || entityType === "job" || entityType === "invoice" ? entityType : null;
}

interface RawRow { entity_type: string; id: string; title: string | null; subtitle: string | null; status: string | null; rank: number | null }

/** Map RPC rows → typed results (unknown types dropped). Pure — unit-tested. */
export function mapSearchRows(rows: RawRow[]): SearchResult[] {
  const out: SearchResult[] = [];
  rows.forEach((r, i) => {
    if (!isSearchEntityType(r.entity_type)) return;
    out.push({
      key: `${r.entity_type}:${r.id}:${i}`,
      entityType: r.entity_type,
      id: r.id,
      title: r.title?.trim() || "Untitled",
      subtitle: r.subtitle?.trim() || null,
      status: r.status ?? null,
      statusEntity: searchStatusEntity(r.entity_type),
      href: searchHref(r.entity_type, r.id),
      rank: typeof r.rank === "number" ? r.rank : 0,
    });
  });
  return out;
}

/** Group results by type in SEARCH_ENTITY_TYPES order, each group by rank desc. Pure. */
export function groupSearchResults(results: SearchResult[]): { type: SearchEntityType; label: string; items: SearchResult[] }[] {
  return SEARCH_ENTITY_TYPES.map((type) => ({
    type,
    label: SEARCH_GROUP_LABELS[type],
    items: results.filter((r) => r.entityType === type).sort((a, b) => b.rank - a.rank),
  })).filter((g) => g.items.length > 0);
}

/**
 * Global search across customers, contacts, leads, quotes, jobs, invoices.
 * The RPC is SECURITY INVOKER: RLS decides what each role sees — just render what comes back.
 */
export async function globalSearch(ctx: ServiceContext, q: string, limit = 6): Promise<ActionResult<SearchResult[]>> {
  const query = String(q ?? "").trim().slice(0, 100);
  if (query.length < 2) return ok([]);
  const { data, error } = await ctx.supabase.rpc("global_search", {
    p_organisation_id: ctx.organisationId,
    p_query: query,
    p_limit: Math.min(Math.max(Math.trunc(limit) || 6, 1), 20),
  });
  if (error) {
    logServerError("search.global", error);
    return fail(toUserMessage(error, "Search isn't available right now."));
  }
  return ok(mapSearchRows(data ?? []));
}
