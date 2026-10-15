import type { Metadata } from "next";
import { z } from "zod";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { getCustomer, listCustomerTasks } from "@/domain/customers/service";
import { listActivityForEntity } from "@/domain/activity/service";
import { ErrorState } from "@/components/common/empty-state";
import { CustomerDetailView } from "@/components/customers/customer-detail";

export const metadata: Metadata = { title: "Customer" };

const TABS = ["overview", "contacts", "sites", "tasks", "activity"] as const;

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { tab: rawTab } = await searchParams;
  const tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as string) : "overview";

  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const [detail, tasks, activity] = await Promise.all([
    getCustomer(ctx, id),
    tab === "tasks" ? listCustomerTasks(ctx, id) : Promise.resolve(null),
    tab === "activity" ? listActivityForEntity(ctx, "customer", id) : Promise.resolve(null),
  ]);
  if (!detail.ok) return <ErrorState message={detail.error} />;

  return (
    <CustomerDetailView
      detail={detail.data}
      tasks={tasks?.ok ? tasks.data : []}
      activity={activity?.ok ? activity.data : []}
      tab={tab}
      timeZone={app.organisation.timezone}
      can={{
        update: app.permissions.can("customers.update"),
        archive: app.permissions.can("customers.archive"),
        createTask: app.permissions.can("tasks.create"),
        readActivity: app.permissions.can("activity.read"),
      }}
    />
  );
}
