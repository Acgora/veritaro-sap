import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { getServiceContext } from "@/lib/service-context";
import { listInvoices } from "@/domain/invoices/service";
import { listCustomerOptions } from "@/domain/customers/service";
import { INVOICE_FILTERS, INVOICE_FILTER_LABELS, listInvoicesSchema } from "@/domain/invoices/schema";
import { formatDocDate } from "@/domain/commercial/dates";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/empty-state";
import { ModuleGate } from "@/components/common/module-gate";
import { EntityStatus } from "@/components/common/entity-status";
import { MoneyDisplay } from "@/components/common/money-display";
import { Pagination, SearchBox, StatusChips } from "@/components/commercial/list-controls";
import { NewInvoiceButton } from "@/components/invoices/new-invoice-dialog";

export const metadata: Metadata = { title: "Invoices" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const PATH = "/app/money/invoices";

export default async function InvoicesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const parsed = listInvoicesSchema.safeParse({ status: str(sp.status), q: str(sp.q), page: str(sp.page), customerId: str(sp.customer) });
  const filters = parsed.success ? parsed.data : listInvoicesSchema.parse({});
  const ctx = await getServiceContext();
  const canWrite = ctx.permissions.can("invoices.write");
  const [result, customers] = await Promise.all([
    listInvoices(ctx, filters),
    canWrite ? listCustomerOptions(ctx, 500) : Promise.resolve(null),
  ]);
  const base = { status: filters.status === "all" ? undefined : filters.status, q: filters.q, customer: filters.customerId };

  return (
    <ModuleGate permission="invoices.read">
      <PageHeader title="Invoices" description="What you've billed, what's been paid and what's still owed."
        actions={canWrite ? <NewInvoiceButton customers={customers?.ok ? customers.data : []} initiallyOpen={sp.new === "1"} /> : undefined} />
      <StatusChips pathname={PATH} filters={INVOICE_FILTERS} labels={INVOICE_FILTER_LABELS} current={filters.status} base={base} />
      <SearchBox pathname={PATH} q={filters.q ?? ""} status={filters.status} placeholder="Search number, title or customer" label="Search invoices" />
      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : result.data.invoices.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={Receipt}
            title={filters.q ? "No invoices match your search" : filters.status === "all" ? "No invoices yet" : `No ${INVOICE_FILTER_LABELS[filters.status].toLowerCase()} invoices`}
            description={!filters.q && filters.status === "all" ? "Invoice a completed job or an accepted quote — the lines carry over." : undefined} />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {result.data.invoices.map((i) => (
              <li key={i.id}>
                <Link href={`${PATH}/${i.id}`} className="flex items-center gap-3 px-3 py-3 hover:bg-surface-raised">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      <span className="tabular-nums">{i.invoice_number ?? "Draft"}</span> · {i.customer_name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {i.title ? `${i.title} · ` : ""}{i.status === "draft" ? `created for ${formatDocDate(i.issue_date)}` : `due ${formatDocDate(i.due_date)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <MoneyDisplay amount={i.status === "issued" || i.status === "partially_paid" ? i.amount_due : i.total} currency={i.currency} className="text-sm font-medium" />
                    <EntityStatus entity="invoice" status={i.effective_status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination pathname={PATH} base={base} page={result.data.page} total={result.data.total} pageSize={result.data.pageSize} noun="invoices" />
        </>
      )}
    </ModuleGate>
  );
}
