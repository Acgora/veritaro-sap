import type { Metadata } from "next";
import { getServiceContext } from "@/lib/service-context";
import { requireAppContext } from "@/lib/context";
import { listPayments } from "@/domain/payments/service";
import { listPaymentsSchema } from "@/domain/payments/schema";
import { todayInZone } from "@/domain/commercial/dates";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/empty-state";
import { ModuleGate } from "@/components/common/module-gate";
import { Pagination } from "@/components/commercial/list-controls";
import { PaymentsList } from "@/components/payments/payments-list";

export const metadata: Metadata = { title: "Payments" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const PATH = "/app/money/payments";

export default async function PaymentsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const parsed = listPaymentsSchema.safeParse({ page: str(sp.page), customerId: str(sp.customer) });
  const filters = parsed.success ? parsed.data : listPaymentsSchema.parse({});
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const result = await listPayments(ctx, filters);
  return (
    <ModuleGate permission="payments.read">
      <PageHeader title="Payments" description="Money received against your invoices, newest first." />
      {!result.ok ? <ErrorState message={result.error} /> : (
        <>
          <PaymentsList payments={result.data.payments} canRecord={ctx.permissions.can("payments.record")}
            openRecord={sp.new === "1"} today={todayInZone(app.organisation.timezone)} />
          <Pagination pathname={PATH} base={{ customer: filters.customerId }} page={result.data.page} total={result.data.total} pageSize={result.data.pageSize} noun="payments" />
        </>
      )}
    </ModuleGate>
  );
}
