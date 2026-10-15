import type { Metadata } from "next";
import { getServiceContext } from "@/lib/service-context";
import { listCustomers } from "@/domain/customers/service";
import { listCustomersSchema } from "@/domain/customers/schema";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/empty-state";
import { ModuleGate } from "@/components/common/module-gate";
import { CustomersList } from "@/components/customers/customers-list";

export const metadata: Metadata = { title: "Customers" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function CustomersPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const parsed = listCustomersSchema.safeParse({ q: str(sp.q), status: str(sp.status), type: str(sp.type), page: str(sp.page) });
  const filters = parsed.success ? parsed.data : listCustomersSchema.parse({});
  const ctx = await getServiceContext();
  const result = await listCustomers(ctx, filters);

  return (
    <ModuleGate permission="customers.read">
      <PageHeader title="Customers" description="Everyone you work for — businesses and households." />
      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : (
        <CustomersList
          key={`${filters.q}-${filters.status}-${filters.type}-${filters.page}`}
          customers={result.data.customers}
          total={result.data.total}
          page={result.data.page}
          pageSize={result.data.pageSize}
          filters={{ q: filters.q ?? "", status: filters.status, type: filters.type }}
          canCreate={ctx.permissions.can("customers.create")}
          openCreate={sp.new === "1"}
        />
      )}
    </ModuleGate>
  );
}
