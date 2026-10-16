import type { Metadata } from "next";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { dayBoundsInZone } from "@/lib/dates";
import { listLeads, listLeadsForPipeline } from "@/domain/leads/service";
import { listLeadsSchema } from "@/domain/leads/schema";
import { listMembers } from "@/domain/members/service";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/empty-state";
import { ModuleGate } from "@/components/common/module-gate";
import { LeadsView, type LeadsFilters } from "@/components/leads/leads-view";

export const metadata: Metadata = { title: "Leads" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const view = str(sp.view) === "list" ? "list" : "board";
  const parsed = listLeadsSchema.safeParse({
    q: str(sp.q), status: str(sp.status), assigned: str(sp.assigned), source: str(sp.source),
    followUp: str(sp.followUp), archived: str(sp.archived), page: str(sp.page),
  });
  const f = parsed.success ? parsed.data : listLeadsSchema.parse({});

  return (
    <ModuleGate permission="leads.read">
      <PageHeader title="Leads" description="Enquiries on their way to becoming work. Follow up, quote, win." />
      <LeadsContent view={view} f={f} openCreate={str(sp.new) === "1"} />
    </ModuleGate>
  );
}

async function LeadsContent({ view, f, openCreate }: { view: "board" | "list"; f: ReturnType<typeof listLeadsSchema.parse>; openCreate: boolean }) {
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const now = new Date();
  const env = {
    timeZone: app.organisation.timezone,
    currency: app.organisation.currency,
    nowIso: now.toISOString(),
    dayEndIso: dayBoundsInZone(now, app.organisation.timezone).end,
  };
  const [data, members] = await Promise.all([
    view === "board" ? listLeadsForPipeline(ctx, { q: f.q, assigned: f.assigned, source: f.source }, now) : listLeads(ctx, f),
    ctx.permissions.can("members.read") ? listMembers(ctx) : Promise.resolve(null),
  ]);
  const self = { userId: app.userId, displayName: `${app.profile.display_name || app.profile.first_name || "Me"} (me)` };
  const assignees = members?.ok
    ? members.data.filter((m) => m.status === "active").map((m) => (m.userId === app.userId ? self : { userId: m.userId, displayName: m.displayName }))
    : [self];

  if (!data.ok) return <ErrorState message={data.error} />;

  const filters: LeadsFilters = {
    view, q: f.q ?? "", assigned: f.assigned, source: f.source, status: f.status, followUp: f.followUp, archived: f.archived, page: f.page,
  };
  const canWrite = app.permissions.can("leads.write");
  const common = { filters, env, assignees, currentUserId: app.userId, canWrite, openCreate: openCreate && canWrite };
  const key = JSON.stringify(filters);

  return "columns" in data.data ? (
    <LeadsView key={key} {...common} mode="board" cards={Object.values(data.data.columns).flat()} truncated={data.data.truncated} closedWindowDays={data.data.closedWindowDays} />
  ) : (
    <LeadsView key={key} {...common} mode="list" leads={data.data.leads} total={data.data.total} pageSize={data.data.pageSize} />
  );
}
