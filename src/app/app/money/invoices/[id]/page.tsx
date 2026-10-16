import type { Metadata } from "next";
import { z } from "zod";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { getInvoice } from "@/domain/invoices/service";
import { listCustomerOptions } from "@/domain/customers/service";
import { listActivityForEntity } from "@/domain/activity/service";
import { ErrorState } from "@/components/common/empty-state";
import { ModuleGate } from "@/components/common/module-gate";
import { InvoiceBuilder } from "@/components/invoices/invoice-builder";
import { InvoiceView } from "@/components/invoices/invoice-view";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const detail = await getInvoice(ctx, id);
  if (!detail.ok) return <ModuleGate permission="invoices.read"><ErrorState message={detail.error} /></ModuleGate>;
  const d = detail.data;
  const can = {
    write: app.permissions.can("invoices.write"),
    issue: app.permissions.can("invoices.issue"),
    recordPayment: app.permissions.can("payments.record"),
    readPayments: app.permissions.can("payments.read"),
  };

  if (d.invoice.status === "draft" && can.write) {
    const customers = await listCustomerOptions(ctx, 500);
    return (
      <ModuleGate permission="invoices.read">
        <InvoiceBuilder detail={d} customers={customers.ok ? customers.data : []} can={can} />
      </ModuleGate>
    );
  }
  const activity = await listActivityForEntity(ctx, "invoice", id, 20);
  return (
    <ModuleGate permission="invoices.read">
      <InvoiceView detail={d} can={can} activity={activity.ok ? activity.data : []} />
    </ModuleGate>
  );
}
