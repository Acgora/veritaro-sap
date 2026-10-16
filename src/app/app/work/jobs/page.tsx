import type { Metadata } from "next";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { listAssignableMembers, listJobs } from "@/domain/jobs/service";
import { JOB_LIST_STATUSES, listJobsSchema } from "@/domain/jobs/schema";
import { dayBoundsForDate, isDateString } from "@/domain/jobs/calendar";
import { listCustomerOptions } from "@/domain/customers/service";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/empty-state";
import { JobsGate } from "@/components/jobs/jobs-gate";
import { JobsList } from "@/components/jobs/jobs-list";

export const metadata: Metadata = { title: "Jobs" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function JobsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const tz = app.organisation.timezone;
  const readAll = ctx.permissions.can("jobs.read_all");
  const canCreate = ctx.permissions.can("jobs.write") && ctx.permissions.can("customers.read");

  const rawStatus = str(sp.status);
  const status = (JOB_LIST_STATUSES as readonly string[]).includes(rawStatus ?? "") ? rawStatus! : "open";
  const date = isDateString(str(sp.date)) ? str(sp.date)! : "";
  const mine = readAll && str(sp.mine) === "1";
  const bounds = date ? dayBoundsForDate(date, tz) : null;
  const parsed = listJobsSchema.safeParse({
    status, q: str(sp.q), page: str(sp.page), assignee: mine ? "me" : undefined, from: bounds?.start, to: bounds?.end,
    customerId: str(sp.customer),
  });
  const filters = parsed.success ? parsed.data : listJobsSchema.parse({ status: "open" });
  const openCreate = str(sp.new) === "1" && canCreate;

  const [result, customers, members] = await Promise.all([
    listJobs(ctx, filters),
    canCreate ? listCustomerOptions(ctx) : Promise.resolve(null),
    canCreate ? listAssignableMembers(ctx) : Promise.resolve(null),
  ]);

  return (
    <JobsGate>
      <PageHeader
        title={readAll ? "Jobs" : "My jobs"}
        description={readAll ? "Schedule, assign and complete the work you've won." : "The jobs you've been assigned."}
      />
      {!result.ok ? (
        <ErrorState message={result.error} />
      ) : (
        <JobsList
          key={`${filters.status}-${filters.q}-${filters.page}-${date}-${mine}`}
          jobs={result.data.jobs}
          total={result.data.total}
          page={result.data.page}
          pageSize={result.data.pageSize}
          filters={{ status: filters.status, mine, date, q: filters.q ?? "" }}
          readAll={readAll}
          canCreate={canCreate}
          canPhoto={ctx.permissions.canAny("jobs.work", "jobs.write")}
          customers={customers?.ok ? customers.data : []}
          members={members?.ok ? members.data : []}
          timeZone={tz}
          organisationId={app.organisation.id}
          openCreate={openCreate}
          openPhoto={str(sp.photo) === "1"}
          presetDate={isDateString(str(sp.on)) ? str(sp.on) : undefined}
          presetCustomerId={str(sp.customer)}
        />
      )}
    </JobsGate>
  );
}
