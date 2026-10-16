import type { Metadata } from "next";
import { z } from "zod";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { getCustomer, listCustomerTasks } from "@/domain/customers/service";
import { getCustomerBalance, listCustomerInvoices, listCustomerJobs, listCustomerQuotes } from "@/domain/customers/lifecycle";
import { listActivityForEntity } from "@/domain/activity/service";
import { localDateInZone } from "@/domain/today/format";
import { ErrorState } from "@/components/common/empty-state";
import { CustomerDetailView } from "@/components/customers/customer-detail";

export const metadata: Metadata = { title: "Customer" };

const BASE_TABS = ["overview", "contacts", "sites", "tasks", "activity"] as const;

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { tab: rawTab } = await searchParams;

  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const p = app.permissions;
  const can = {
    update: p.can("customers.update"),
    archive: p.can("customers.archive"),
    createTask: p.can("tasks.create"),
    readActivity: p.can("activity.read"),
    readQuotes: p.can("quotes.read"),
    writeQuotes: p.can("quotes.write"),
    readJobs: p.can("jobs.read_all"),
    writeJobs: p.can("jobs.write"),
    readInvoices: p.can("invoices.read"),
    writeInvoices: p.can("invoices.write"),
  };
  const allowedTabs: string[] = [
    ...BASE_TABS,
    ...(can.readQuotes ? ["quotes"] : []),
    ...(can.readJobs ? ["jobs"] : []),
    ...(can.readInvoices ? ["invoices"] : []),
  ];
  const tab = allowedTabs.includes(rawTab ?? "") ? (rawTab as string) : "overview";
  const today = localDateInZone(new Date(), app.organisation.timezone);

  const [detail, tasks, activity, quotes, jobs, invoices, balance] = await Promise.all([
    getCustomer(ctx, id),
    tab === "tasks" ? listCustomerTasks(ctx, id) : Promise.resolve(null),
    tab === "activity" ? listActivityForEntity(ctx, "customer", id) : Promise.resolve(null),
    tab === "quotes" ? listCustomerQuotes(ctx, id, today) : Promise.resolve(null),
    tab === "jobs" ? listCustomerJobs(ctx, id) : Promise.resolve(null),
    tab === "invoices" ? listCustomerInvoices(ctx, id, today) : Promise.resolve(null),
    (tab === "overview" || tab === "invoices") && can.readInvoices ? getCustomerBalance(ctx, id) : Promise.resolve(null),
  ]);
  if (!detail.ok) return <ErrorState message={detail.error} />;
  const lifecycleError = [quotes, jobs, invoices].find((r) => r && !r.ok);

  return (
    <CustomerDetailView
      detail={detail.data}
      tasks={tasks?.ok ? tasks.data : []}
      activity={activity?.ok ? activity.data : []}
      lifecycle={{
        quotes: quotes?.ok ? quotes.data : [],
        jobs: jobs?.ok ? jobs.data : [],
        invoices: invoices?.ok ? invoices.data : [],
        balance: balance?.ok ? balance.data : null,
        error: lifecycleError && !lifecycleError.ok ? lifecycleError.error : null,
      }}
      tab={tab}
      timeZone={app.organisation.timezone}
      currency={app.organisation.currency}
      can={can}
    />
  );
}
