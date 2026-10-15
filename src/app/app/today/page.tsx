import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { dayBoundsInZone, formatLongDate, greetingFor } from "@/lib/dates";
import { getTaskCounts, listTasksDueBetween } from "@/domain/tasks/service";
import { listRecentActivity } from "@/domain/activity/service";
import { countCustomersCreatedSince } from "@/domain/customers/service";
import { NeedsAttention } from "@/components/today/needs-attention";
import { AIBriefing } from "@/components/today/ai-briefing";
import { TodaySchedule } from "@/components/today/today-schedule";
import { ActivityFeed } from "@/components/today/activity-feed";
import { Section } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Today" };

async function AttentionBlock({ start, end }: { start: string; end: string }) {
  const ctx = await getServiceContext();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const [counts, newCustomers] = await Promise.all([
    getTaskCounts(ctx, start, end),
    ctx.permissions.can("customers.read") ? countCustomersCreatedSince(ctx, weekAgo) : Promise.resolve(null),
  ]);
  if (!counts.ok) return <ErrorState message={counts.error} />;
  return (
    <NeedsAttention
      overdueTasks={counts.data.overdue}
      dueTodayTasks={counts.data.dueToday}
      newCustomers={newCustomers?.ok ? newCustomers.data : null}
    />
  );
}

async function ScheduleBlock({ start, end, timeZone }: { start: string; end: string; timeZone: string }) {
  const ctx = await getServiceContext();
  const tasks = await listTasksDueBetween(ctx, start, end, 10);
  if (!tasks.ok) return <ErrorState message={tasks.error} />;
  return <TodaySchedule tasks={tasks.data} timeZone={timeZone} />;
}

async function ActivityBlock() {
  const ctx = await getServiceContext();
  if (!ctx.permissions.can("activity.read")) {
    return <p className="text-sm text-muted-foreground">Activity history isn&apos;t available for your role.</p>;
  }
  const activity = await listRecentActivity(ctx, 15);
  if (!activity.ok) return <ErrorState message={activity.error} />;
  return <ActivityFeed items={activity.data} />;
}

const lines = (n: number) => (
  <div className="flex flex-col gap-2" aria-busy="true">
    {Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-5" />)}
  </div>
);

export default async function TodayPage() {
  const app = await requireAppContext();
  const now = new Date();
  const tz = app.organisation.timezone;
  const { start, end } = dayBoundsInZone(now, tz);
  const name = app.profile.first_name || app.profile.display_name || "there";

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Good {greetingFor(now, tz)}, {name}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{formatLongDate(now, tz)}</p>
      </header>

      <Suspense fallback={<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[72px]" />)}</div>}>
        <AttentionBlock start={start} end={end} />
      </Suspense>

      <AIBriefing briefing={null} />

      <div className="grid gap-4 lg:grid-cols-5">
        <Section id="schedule" title="Today’s schedule" className="lg:col-span-3">
          <Suspense fallback={lines(3)}>
            <ScheduleBlock start={start} end={end} timeZone={tz} />
          </Suspense>
        </Section>
        <Section id="activity" title="Recent activity" className="lg:col-span-2">
          <Suspense fallback={lines(5)}>
            <ActivityBlock />
          </Suspense>
        </Section>
      </div>
    </div>
  );
}
