import type { Metadata } from "next";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { listAssignableMembers, listCalendarJobs, listUnscheduledJobs } from "@/domain/jobs/service";
import { listCustomerOptions } from "@/domain/customers/service";
import { dayBoundsForDate, isDateString, monthGrid, rangeBounds, zonedDateKey } from "@/domain/jobs/calendar";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/empty-state";
import { JobsGate } from "@/components/jobs/jobs-gate";
import { CalendarView } from "@/components/jobs/calendar-view";

export const metadata: Metadata = { title: "Calendar" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function CalendarPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const tz = app.organisation.timezone;
  const today = zonedDateKey(new Date(), tz);
  const view = str(sp.view) === "day" ? "day" : "month";
  const date = isDateString(str(sp.date)) ? str(sp.date)! : today;
  const canWrite = ctx.permissions.can("jobs.write");

  let bounds: { start: string; end: string };
  if (view === "day") {
    bounds = dayBoundsForDate(date, tz);
  } else {
    const [y, m] = date.split("-").map(Number) as [number, number];
    const weeks = monthGrid(y, m);
    bounds = rangeBounds(weeks[0]![0]!.date, weeks[weeks.length - 1]![6]!.date, tz);
  }

  const [jobs, unscheduled, customers, members] = await Promise.all([
    listCalendarJobs(ctx, bounds.start, bounds.end),
    canWrite ? listUnscheduledJobs(ctx) : Promise.resolve(null),
    canWrite && ctx.permissions.can("customers.read") ? listCustomerOptions(ctx) : Promise.resolve(null),
    canWrite ? listAssignableMembers(ctx) : Promise.resolve(null),
  ]);

  return (
    <JobsGate>
      <PageHeader title="Calendar" description={`Scheduled jobs in ${tz.replace(/_/g, " ")} time.`} />
      {!jobs.ok ? (
        <ErrorState message={jobs.error} />
      ) : (
        <CalendarView
          key={`${view}-${date}`}
          view={view}
          date={date}
          today={today}
          jobs={jobs.data}
          unscheduled={unscheduled?.ok ? unscheduled.data : []}
          timeZone={tz}
          canWrite={canWrite}
          customers={customers?.ok ? customers.data : []}
          members={members?.ok ? members.data : []}
        />
      )}
    </JobsGate>
  );
}
