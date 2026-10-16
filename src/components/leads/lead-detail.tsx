"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlarmClock, Archive, CheckCircle2, ExternalLink, FileText, Mail, MessageCircle, Pencil, Phone, Plus, RotateCcw, UserPlus, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { EntityStatus } from "@/components/common/entity-status";
import { StatusBadge } from "@/components/common/status-badge";
import { TabsNav } from "@/components/common/tabs-nav";
import { ActivityFeed } from "@/components/today/activity-feed";
import { MessageTimeline } from "@/components/inbox/message-timeline";
import { LogCommunicationForm } from "@/components/inbox/log-communication-form";
import { LEAD_SOURCE_LABELS, type LeadSource } from "@/domain/leads/schema";
import { leadDisplayName, leadSubName, whatsappLink } from "@/domain/leads/rules";
import type { LeadDetail } from "@/domain/leads/service";
import type { MessageItem } from "@/domain/inbox/service";
import type { ActivityItem } from "@/domain/activity/service";
import { effectiveQuoteStatus } from "@/lib/status";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { archiveLeadAction, restoreLeadAction } from "@/app/app/sales/leads/actions";
import { LeadForm } from "./lead-form";
import { ConvertLeadDialog } from "./convert-lead-dialog";
import { FollowUpDialog } from "./follow-up-dialog";
import { LeadTaskForm } from "./lead-task-form";
import { FollowUpLabel, type CardEnv } from "./lead-card";
import { MoveToMenu, useLeadMove } from "./lead-move";
import type { Assignee } from "./datetime";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "communication", label: "Communication" },
  { key: "tasks", label: "Tasks" },
  { key: "quotes", label: "Quotes" },
  { key: "activity", label: "Activity" },
] as const;

export interface LeadDetailCan {
  write: boolean;
  createCustomer: boolean;
  readCustomers: boolean;
  createQuote: boolean;
  readQuotes: boolean;
  createTask: boolean;
  readInbox: boolean;
  writeInbox: boolean;
  readActivity: boolean;
}

export function LeadDetailView({ detail, tab, env, messages, activity, assignees, currentUserId, can }: {
  detail: LeadDetail;
  tab: string;
  env: CardEnv;
  messages: (MessageItem & { conversationSubject: string | null })[];
  activity: ActivityItem[];
  assignees: Assignee[];
  currentUserId: string;
  can: LeadDetailCan;
}) {
  const l = detail.lead;
  const name = leadDisplayName(l);
  const sub = leadSubName(l);
  const archived = !!l.archived_at;
  const closed = l.status === "won" || l.status === "lost";
  const editable = can.write && !archived;
  const wa = whatsappLink(l.phone);
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [pending, start] = useTransition();
  const { requestMove, dialogs, pending: moving } = useLeadMove();
  const target = { id: l.id, name };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: env.timeZone }).format(new Date(env.nowIso));
  const quoteHref = `/app/sales/quotes/new?lead=${l.id}${l.customer_id ? `&customer=${l.customer_id}` : ""}`;

  return (
    <div>
      <header className="mb-4 flex flex-col gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground"><Link href="/app/sales/leads" className="hover:underline">Leads</Link></p>
          <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {sub ? <span>{sub}</span> : null}
            <EntityStatus entity="lead" status={l.status} />
            <StatusBadge>{LEAD_SOURCE_LABELS[l.source as LeadSource] ?? l.source}</StatusBadge>
            {archived ? <StatusBadge>Archived</StatusBadge> : null}
            <FollowUpLabel at={l.next_follow_up_at} env={env} />
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {l.phone ? <Button asChild variant="secondary" size="sm"><a href={`tel:${l.phone}`}><Phone /> Call</a></Button> : null}
          {wa ? <Button asChild variant="secondary" size="sm"><a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle /> WhatsApp</a></Button> : null}
          {l.email ? <Button asChild variant="secondary" size="sm"><a href={`mailto:${l.email}`}><Mail /> Email</a></Button> : null}

          {detail.customer ? (
            can.readCustomers ? (
              <Button asChild variant="secondary" size="sm"><Link href={`/app/sales/customers/${detail.customer.id}`}><ExternalLink /> Open customer</Link></Button>
            ) : null
          ) : editable && (can.createCustomer || can.readCustomers) ? (
            <Button variant="secondary" size="sm" onClick={() => setConverting(true)}><UserPlus /> Create customer</Button>
          ) : null}
          {can.createQuote && !archived && l.status !== "lost" ? (
            <Button asChild size="sm"><Link href={quoteHref}><FileText /> Create quote</Link></Button>
          ) : null}
          {can.createTask && !archived ? <Button variant="secondary" size="sm" onClick={() => setAddingTask(true)}><Plus /> Create task</Button> : null}
          {editable ? <Button variant="secondary" size="sm" onClick={() => setScheduling(true)}><AlarmClock /> {l.next_follow_up_at ? "Change follow-up" : "Schedule follow-up"}</Button> : null}
          {editable && l.status !== "won" ? (
            <Button variant="secondary" size="sm" disabled={moving} onClick={() => requestMove(target, "won")}><CheckCircle2 /> Mark won</Button>
          ) : null}
          {editable && l.status !== "lost" ? (
            <Button variant="secondary" size="sm" disabled={moving} onClick={() => requestMove(target, "lost")}><XCircle /> Mark lost</Button>
          ) : null}
          {editable ? <MoveToMenu target={target} current={l.status} onMove={requestMove} disabled={moving} /> : null}
          {editable ? <Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Pencil /> Edit</Button> : null}
          {can.write && !archived ? (
            <ConfirmationDialog
              title="Archive this lead?"
              description={`${name} will be hidden from the pipeline. Its history is kept and you can restore it.`}
              confirmLabel="Archive"
              onConfirm={async () => {
                const r = await archiveLeadAction(l.id);
                if (r.ok) toast.success("Lead archived");
                else toast.error(r.error);
                return r.ok;
              }}
              trigger={(open) => <Button variant="ghost" size="sm" onClick={open}><Archive /> Archive</Button>}
            />
          ) : null}
          {can.write && archived ? (
            <Button variant="secondary" size="sm" disabled={pending}
              onClick={() => start(async () => { const r = await restoreLeadAction(l.id); if (r.ok) toast.success("Lead restored"); else toast.error(r.error); })}>
              <RotateCcw /> Restore
            </Button>
          ) : null}
        </div>
      </header>

      <TabsNav label="Lead sections" active={tab} tabs={TABS.map((t) => ({
        ...t,
        count: t.key === "tasks" ? detail.tasks.length : t.key === "quotes" && can.readQuotes ? detail.quotes.length : null,
      }))} />

      {tab === "overview" ? (
        <div className="flex flex-col gap-4">
          {l.status === "lost" && l.lost_reason ? (
            <div className="rounded-md border border-border bg-muted p-3 text-sm"><span className="font-medium">Lost: </span>{l.lost_reason}</div>
          ) : null}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2">
            {([
              ["Person", l.person_name], ["Company", l.company_name], ["Phone", l.phone], ["Email", l.email],
              ["Site address", l.site_address_text], ["Requested date", l.requested_date],
              ["Estimated value", l.estimated_value !== null ? formatMoney(l.estimated_value.toFixed(2), env.currency) : null],
              ["Assigned to", detail.assigneeName ?? (l.assigned_to ? "A team member" : "Unassigned")],
              ["Customer", detail.customer ? (detail.customer.displayName ?? "Linked") : "Not yet a customer"],
              ["Next follow-up", l.next_follow_up_at ? formatDateTime(l.next_follow_up_at, env.timeZone) : null],
              ["Last activity", formatDateTime(l.last_activity_at, env.timeZone)],
              ["Added", formatDateTime(l.created_at, env.timeZone)],
            ] as const).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className={cn(!v && "text-muted-foreground")}>{v || "—"}</dd>
              </div>
            ))}
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">What they need</dt>
              <dd className="whitespace-pre-wrap">{l.service_summary || <span className="text-muted-foreground">—</span>}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-wrap">{l.notes || <span className="text-muted-foreground">—</span>}</dd>
            </div>
          </dl>
          {closed ? null : !detail.customer && !archived && can.write ? (
            <p className="text-xs text-muted-foreground">Next step: create the customer, then a quote. Everything you entered here carries forward.</p>
          ) : null}
        </div>
      ) : null}

      {tab === "communication" ? (
        <div className="flex flex-col gap-4">
          {!can.readInbox ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">Communication history isn&apos;t available for your role.</p>
          ) : (
            <>
              {can.writeInbox && !archived ? (
                <section aria-labelledby="log-heading" className="rounded-lg border border-border bg-surface p-3">
                  <h2 id="log-heading" className="text-sm font-semibold">Log a call, note or message</h2>
                  <p className="mb-3 text-xs text-muted-foreground">WhatsApp and email aren&apos;t connected yet. Record what was said so the whole team can see it.</p>
                  <LogCommunicationForm idPrefix="lead-log" link={{ leadId: l.id, customerId: l.customer_id }} />
                </section>
              ) : null}
              <section aria-label="Communication history" className="rounded-lg border border-border bg-surface p-3">
                <MessageTimeline messages={messages} timeZone={env.timeZone} emptyTitle="No communication logged yet" />
                {detail.conversations.length > 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Open in Inbox: {detail.conversations.map((c, i) => (
                      <span key={c.id}>{i > 0 ? ", " : ""}<Link href={`/app/inbox?c=${c.id}`} className="text-primary hover:underline">{c.subject || `Conversation ${i + 1}`}</Link></span>
                    ))}
                  </p>
                ) : null}
              </section>
            </>
          )}
        </div>
      ) : null}

      {tab === "tasks" ? (
        <section aria-label="Tasks">
          {can.createTask && !archived ? <div className="mb-2 flex justify-end"><Button size="sm" onClick={() => setAddingTask(true)}><Plus /> New task</Button></div> : null}
          {detail.tasks.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface"><EmptyState compact title="No tasks for this lead" description="Add a reminder — e.g. a site visit or a call back." /></div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {detail.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <Link href="/app/work/tasks" className="min-w-0 flex-1 truncate hover:underline">{t.title}</Link>
                  {t.due_at ? <span className="text-xs text-muted-foreground">{formatDateTime(t.due_at, env.timeZone)}</span> : null}
                  <EntityStatus entity="task" status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "quotes" ? (
        <section aria-label="Quotes">
          {!can.readQuotes ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">Quotes aren&apos;t available for your role.</p>
          ) : (
            <>
              {can.createQuote && !archived ? <div className="mb-2 flex justify-end"><Button asChild size="sm"><Link href={quoteHref}><Plus /> New quote</Link></Button></div> : null}
              {detail.quotes.length === 0 ? (
                <div className="rounded-lg border border-border bg-surface"><EmptyState compact title="No quotes for this lead yet" /></div>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                  {detail.quotes.map((q) => (
                    <li key={q.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <Link href={`/app/sales/quotes/${q.id}`} className="font-medium hover:underline">{q.quote_number}</Link>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{q.title}</span>
                      <span className="tabular-nums">{formatMoney(q.total.toFixed(2), env.currency)}</span>
                      <EntityStatus entity="quote" status={effectiveQuoteStatus(q.status, q.expiry_date, today)} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      ) : null}

      {tab === "activity" ? (
        <section aria-label="Activity" className="rounded-lg border border-border bg-surface p-4">
          {can.readActivity ? <ActivityFeed items={activity} /> : <p className="text-sm text-muted-foreground">Activity history isn&apos;t available for your role.</p>}
        </section>
      ) : null}

      {dialogs}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="Edit lead" className="max-w-xl">
          <LeadForm lead={l} assignees={assignees} currentUserId={currentUserId} onDone={() => setEditing(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={addingTask} onOpenChange={setAddingTask}>
        <DialogContent title="New task for this lead">
          <LeadTaskForm leadId={l.id} leadName={name} assignees={assignees} currentUserId={currentUserId} onDone={() => setAddingTask(false)} />
        </DialogContent>
      </Dialog>
      {editable ? <FollowUpDialog leadId={l.id} current={l.next_follow_up_at} open={scheduling} onOpenChange={setScheduling} /> : null}
      {!detail.customer && editable ? <ConvertLeadDialog lead={l} open={converting} onOpenChange={setConverting} canCreate={can.createCustomer} /> : null}
    </div>
  );
}
