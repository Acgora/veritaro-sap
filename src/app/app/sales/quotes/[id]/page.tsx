import type { Metadata } from "next";
import { z } from "zod";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { getQuote } from "@/domain/quotes/service";
import { listCustomerOptions } from "@/domain/customers/service";
import { listActivityForEntity } from "@/domain/activity/service";
import { ErrorState } from "@/components/common/empty-state";
import { ModuleGate } from "@/components/common/module-gate";
import { QuoteBuilder } from "@/components/quotes/quote-builder";
import { QuoteView } from "@/components/quotes/quote-view";

export const metadata: Metadata = { title: "Quote" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const detail = await getQuote(ctx, id);
  if (!detail.ok) return <ModuleGate permission="quotes.read"><ErrorState message={detail.error} /></ModuleGate>;
  const d = detail.data;
  const can = {
    write: app.permissions.can("quotes.write"),
    issue: app.permissions.can("quotes.issue"),
    jobsWrite: app.permissions.can("jobs.write"),
    invoicesWrite: app.permissions.can("invoices.write"),
  };

  if (d.quote.status === "draft" && can.write) {
    const customers = await listCustomerOptions(ctx, 500);
    return (
      <ModuleGate permission="quotes.read">
        <QuoteBuilder detail={d} customers={customers.ok ? customers.data : []} can={can} />
      </ModuleGate>
    );
  }
  const activity = await listActivityForEntity(ctx, "quote", id, 20);
  return (
    <ModuleGate permission="quotes.read">
      <QuoteView detail={d} can={can} activity={activity.ok ? activity.data : []} timeZone={app.organisation.timezone} />
    </ModuleGate>
  );
}
