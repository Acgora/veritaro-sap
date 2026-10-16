import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { dayBoundsInZone, formatLongDate, greetingFor } from "@/lib/dates";
import { isAssistantConfigured } from "@/lib/ai/command-service";
import { listTasksDueBetween } from "@/domain/tasks/service";
import { listRecentActivity } from "@/domain/activity/service";
import {
  actionableItems, buildAttentionItems, buildBriefingSentence, buildKpis, getTodaySummary, listMyJobs,
} from "@/domain/today/service";
import { NeedsAttention } from "@/components/today/needs-attention";
import { AIBriefing } from "@/components/today/ai-briefing";
import { TodaySchedule } from "@/components/today/today-schedule";
import { TodayKpis } from "@/components/today/today-kpis";
import { MyJobsToday } from "@/components/today/my-jobs";
import { ActivityFeed } from "@/components/today/activity-feed";
import { Section } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Today" };

/** Everything driven by today_summary: KPIs, briefing, needs-attention, schedule. One RPC, real data only. */
async function ActionCentre({ start, end }: { start: string; end: string }) {
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const tz = app.organisation.timezone;
  const currency = app.organisation.currency;
  const fieldAgent = !ctx.permissions.can("jobs.read_all") && ctx.permissions.can("jobs.read_assigned");

  const [summary, tasks, myJobs] = await Promise.all([
    getTodaySummary(ctx),
    listTasksDueBetween(ctx, start, end, 10),
    fieldAgent ? listMyJobs(ctx, start, end) : Promise.resolve(null),
  ]);
  if (!summary.ok) return <ErrorState message={summary.error} />;

  const items = buildAttentionItems(summary.data, { currency, jobsScope: fieldAgent ? "assigned" : "all" });
  const actionable = actionableItems(items);
  const kpis = buildKpis(summary.data, { currency });
  const sentence = buildBriefingSentence(items);
  const canAI = ctx.permissions.can("ai.use");

  return (
    <div className="flex flex-col gap-6">
      {fieldAgent ? (
        <Section id="my-jobs" title="Your jobs today">
          {myJobs && !myJobs.ok ? <ErrorState message={myJobs.error} /> : <MyJobsToday jobs={myJobs?.ok ? myJobs.data : []} timeZone={tz} />}
        </Section>
      ) : (
        <TodayKpis kpis={kpis} />
      )}

      <AIBriefing sentence={sentence} ai={{ allowed: canAI, configured: isAssistantConfigured(), hasItems: items.length > 0 }} />

      <section aria-labelledby="attention-heading">
        <h2 id="attention-heading" className="mb-2 text-sm font-semibold">Needs attention</h2>
        <NeedsAttention items={actionable} />
      </section>

      <Section id="schedule" title={fieldAgent ? "Tasks due today" : "Jobs today"}>
        <TodaySchedule
          jobs={summary.data.jobs?.today ?? []}
          tasks={tasks.ok ? tasks.data : []}
          timeZone={tz}
          showJobs={!fieldAgent && !!summary.data.jobs}
        />
      </Section>
    </div>
  );
}

async function ActivityBlock({ currency }: { currency: string }) {
  const ctx = await getServiceContext();
  if (!ctx.permissions.can("activity.read")) {
    return <p className="text-sm text-muted-foreground">Activity history isn&apos;t available for your role.</p>;
  }
  const activity = await listRecentActivity(ctx, 15);
  if (!activity.ok) return <ErrorState message={activity.error} />;
  return <ActivityFeed items={activity.data} currency={currency} />;
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

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Suspense
            fallback={
              <div className="flex flex-col gap-4" aria-busy="true">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[72px]" />)}</div>
                <Skeleton className="h-20" />
                {lines(4)}
              </div>
            }
          >
            <ActionCentre start={start} end={end} />
          </Suspense>
        </div>
        <Section id="activity" title="Recent activity" className="self-start lg:col-span-2">
          <Suspense fallback={lines(5)}>
            <ActivityBlock currency={app.organisation.currency} />
          </Suspense>
        </Section>
      </div>
    </div>
  );
}
