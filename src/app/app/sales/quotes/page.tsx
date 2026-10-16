import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature, Plus } from "lucide-react";
import { getServiceContext } from "@/lib/service-context";
import { listQuotes } from "@/domain/quotes/service";
import { listQuotesSchema, QUOTE_FILTERS, QUOTE_FILTER_LABELS } from "@/domain/quotes/schema";
import { formatDocDate } from "@/domain/commercial/dates";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/empty-state";
import { ModuleGate } from "@/components/common/module-gate";
import { EntityStatus } from "@/components/common/entity-status";
import { MoneyDisplay } from "@/components/common/money-display";
import { Button } from "@/components/ui/button";
import { Pagination, SearchBox, StatusChips } from "@/components/commercial/list-controls";

export const metadata: Metadata = { title: "Quotes" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const PATH = "/app/sales/quotes";

export default async function QuotesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const parsed = listQuotesSchema.safeParse({ status: str(sp.status), q: str(sp.q), page: str(sp.page), customerId: str(sp.customer) });
  const filters = parsed.success ? parsed.data : listQuotesSchema.parse({});
  const ctx = await getServiceContext();
  const result = await listQuotes(ctx, filters);
  const canWrite = ctx.permissions.can("quotes.write");
  const base = { status: filters.status === "all" ? undefined : filters.status, q: filters.q, customer: filters.customerId };

  return (
    <ModuleGate permission="quotes.read">
      <PageHeader title="Quotes" description="Prices you've offered customers — drafts, sent, accepted and expired."
        actions={canWrite ? <Button asChild size="lg"><Link href={`${PATH}/new`}><Plus /> New quote</Link></Button> : undefined} />
      <StatusChips pathname={PATH} filters={QUOTE_FILTERS} labels={QUOTE_FILTER_LABELS} current={filters.status} base={base} />
      <SearchBox pathname={PATH} q={filters.q ?? ""} status={filters.status} placeholder="Search number, title or customer" label="Search quotes" />
      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : result.data.quotes.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={FileSignature}
            title={filters.q ? "No quotes match your search" : filters.status === "all" ? "No quotes yet" : `No ${QUOTE_FILTER_LABELS[filters.status].toLowerCase()} quotes`}
            description={!filters.q && filters.status === "all" ? "Create a quote for a customer. VAT and totals are worked out for you." : undefined}
            action={canWrite && !filters.q && filters.status === "all" ? <Button asChild><Link href={`${PATH}/new`}><Plus /> New quote</Link></Button> : undefined} />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {result.data.quotes.map((q) => (
              <li key={q.id}>
                <Link href={`${PATH}/${q.id}`} className="flex items-center gap-3 px-3 py-3 hover:bg-surface-raised">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      <span className="tabular-nums">{q.quote_number}</span> · {q.customer_name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {q.title ? `${q.title} · ` : ""}{formatDocDate(q.issue_date)}
                      {q.expiry_date && (q.effective_status === "sent" || q.effective_status === "viewed") ? ` · valid until ${formatDocDate(q.expiry_date)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <MoneyDisplay amount={q.total} currency={q.currency} className="text-sm font-medium" />
                    <EntityStatus entity="quote" status={q.effective_status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination pathname={PATH} base={base} page={result.data.page} total={result.data.total} pageSize={result.data.pageSize} noun="quotes" />
        </>
      )}
    </ModuleGate>
  );
}
