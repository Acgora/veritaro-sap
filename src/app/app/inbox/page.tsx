import type { Metadata } from "next";
import { z } from "zod";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { getConversation, listConversations } from "@/domain/inbox/service";
import { listConversationsSchema } from "@/domain/inbox/schema";
import { listLeadOptions } from "@/domain/leads/service";
import { listCustomerOptions } from "@/domain/customers/service";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/empty-state";
import { ModuleGate } from "@/components/common/module-gate";
import { InboxView } from "@/components/inbox/inbox-view";

export const metadata: Metadata = { title: "Inbox" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function InboxPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <ModuleGate permission="inbox.read">
      <PageHeader title="Inbox" description="Every conversation with leads and customers. WhatsApp and email aren't connected yet — log calls and messages here." className="hidden md:flex" />
      <InboxContent sp={sp} />
    </ModuleGate>
  );
}

async function InboxContent({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const parsed = listConversationsSchema.safeParse({ filter: str(sp.filter), q: str(sp.q), page: str(sp.page) });
  const f = parsed.success ? parsed.data : listConversationsSchema.parse({});
  const rawC = str(sp.c);
  const selectedId = rawC && z.uuid().safeParse(rawC).success ? rawC : null;

  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const canWrite = app.permissions.can("inbox.write");
  const [list, selected, leads, customers] = await Promise.all([
    listConversations(ctx, f),
    selectedId ? getConversation(ctx, selectedId) : Promise.resolve(null),
    canWrite && app.permissions.can("leads.read") ? listLeadOptions(ctx) : Promise.resolve(null),
    canWrite && app.permissions.can("customers.read") ? listCustomerOptions(ctx) : Promise.resolve(null),
  ]);
  if (!list.ok) return <ErrorState message={list.error} />;

  return (
    <InboxView
      conversations={list.data.conversations}
      total={list.data.total}
      page={list.data.page}
      pageSize={list.data.pageSize}
      filter={f.filter}
      q={f.q ?? ""}
      selectedId={selectedId}
      selected={selected?.ok ? selected.data : null}
      selectedError={selected && !selected.ok ? selected.error : null}
      timeZone={app.organisation.timezone}
      canWrite={canWrite}
      aiEnabled={app.permissions.can("ai.use")}
      leadOptions={leads?.ok ? leads.data : []}
      customerOptions={customers?.ok ? customers.data : []}
    />
  );
}
