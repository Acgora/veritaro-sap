import type { Metadata } from "next";
import { z } from "zod";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { dayBoundsInZone } from "@/lib/dates";
import { getLead } from "@/domain/leads/service";
import { listMessagesForLead } from "@/domain/inbox/service";
import { listActivityForEntity } from "@/domain/activity/service";
import { listMembers } from "@/domain/members/service";
import { ErrorState } from "@/components/common/empty-state";
import { ModuleGate } from "@/components/common/module-gate";
import { LeadDetailView } from "@/components/leads/lead-detail";

export const metadata: Metadata = { title: "Lead" };

const TABS = ["overview", "communication", "tasks", "quotes", "activity"] as const;

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { tab: rawTab } = await searchParams;
  const tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as string) : "overview";
  return (
    <ModuleGate permission="leads.read">
      <LeadContent id={id} tab={tab} />
    </ModuleGate>
  );
}

async function LeadContent({ id, tab }: { id: string; tab: string }) {
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const p = app.permissions;
  const [detail, messages, activity, members] = await Promise.all([
    getLead(ctx, id),
    tab === "communication" ? listMessagesForLead(ctx, id) : Promise.resolve(null),
    tab === "activity" ? listActivityForEntity(ctx, "lead", id) : Promise.resolve(null),
    p.can("members.read") ? listMembers(ctx) : Promise.resolve(null),
  ]);
  if (!detail.ok) return <ErrorState message={detail.error} />;

  const now = new Date();
  const self = { userId: app.userId, displayName: `${app.profile.display_name || app.profile.first_name || "Me"} (me)` };
  const assignees = members?.ok
    ? members.data.filter((m) => m.status === "active").map((m) => (m.userId === app.userId ? self : { userId: m.userId, displayName: m.displayName }))
    : [self];

  return (
    <LeadDetailView
      detail={detail.data}
      tab={tab}
      env={{ timeZone: app.organisation.timezone, currency: app.organisation.currency, nowIso: now.toISOString(), dayEndIso: dayBoundsInZone(now, app.organisation.timezone).end }}
      messages={messages?.ok ? messages.data : []}
      activity={activity?.ok ? activity.data : []}
      assignees={p.can("tasks.assign") || p.can("leads.write") ? assignees : [self]}
      currentUserId={app.userId}
      can={{
        write: p.can("leads.write"),
        createCustomer: p.can("customers.create"),
        readCustomers: p.can("customers.read"),
        createQuote: p.can("quotes.write"),
        readQuotes: p.can("quotes.read"),
        createTask: p.can("tasks.create"),
        readInbox: p.can("inbox.read"),
        writeInbox: p.can("inbox.write"),
        readActivity: p.can("activity.read"),
      }}
    />
  );
}
