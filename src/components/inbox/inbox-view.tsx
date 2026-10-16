"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Inbox, Mail, MessageCircle, PhoneCall, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { CHANNEL_LABELS, INBOX_FILTERS, INBOX_FILTER_LABELS, type Channel, type InboxFilter } from "@/domain/inbox/schema";
import type { ConversationDetail, ConversationListItem } from "@/domain/inbox/service";
import { formatRelative } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ConversationPane } from "./conversation-pane";
import { LogCommunicationForm } from "./log-communication-form";

const NOT_CONNECTED: Partial<Record<InboxFilter, { title: string; icon: typeof Mail }>> = {
  whatsapp: { title: "WhatsApp isn't connected yet", icon: MessageCircle },
  email: { title: "Email isn't connected yet", icon: Mail },
};

export function InboxView(props: {
  conversations: ConversationListItem[];
  total: number;
  page: number;
  pageSize: number;
  filter: InboxFilter;
  q: string;
  selectedId: string | null;
  selected: ConversationDetail | null;
  selectedError: string | null;
  timeZone: string;
  canWrite: boolean;
  aiEnabled: boolean;
  leadOptions: { id: string; name: string; customerId: string | null }[];
  customerOptions: { id: string; display_name: string }[];
}) {
  const { conversations, filter, q, selectedId, selected } = props;
  const pathname = usePathname();
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));

  const href = (patch: { filter?: InboxFilter; q?: string; page?: number; c?: string | null }) => {
    const sp = new URLSearchParams();
    const f = patch.filter ?? filter;
    if (f !== "all") sp.set("filter", f);
    const qq = patch.q ?? q;
    if (qq) sp.set("q", qq);
    const p = patch.page ?? (patch.filter ? 1 : props.page);
    if (p > 1) sp.set("page", String(p));
    const c = patch.c === undefined ? selectedId : patch.c;
    if (c) sp.set("c", c);
    const s = sp.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  const nc = NOT_CONNECTED[filter];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(18rem,22rem)_1fr]">
      {/* List pane — hidden on mobile while a conversation is open */}
      <div className={cn("min-w-0", selectedId && "hidden md:block")}>
        <div className="mb-3 flex items-center gap-2">
          <form role="search" action={pathname} className="relative flex-1">
            {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <label htmlFor="inbox-search" className="sr-only">Search conversations</label>
            <Input id="inbox-search" name="q" defaultValue={q} placeholder="Search" className="pl-8" />
          </form>
          {props.canWrite ? (
            <Button size="sm" className="h-9" onClick={() => setStarting(true)}><PhoneCall /> Log a call</Button>
          ) : null}
        </div>
        <nav aria-label="Inbox filters" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          {INBOX_FILTERS.map((f) => (
            <Link key={f} href={href({ filter: f, c: null })} aria-current={filter === f ? "page" : undefined}
              className={cn("inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-sm", filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface")}>
              {INBOX_FILTER_LABELS[f]}
            </Link>
          ))}
        </nav>

        {conversations.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface">
            {nc ? (
              <EmptyState icon={nc.icon} title={nc.title}
                description={`${filter === "whatsapp" ? "WhatsApp" : "Email"} isn't connected yet. Messages will appear here once it's connected. Until then, log calls and messages manually.`} />
            ) : (
              <EmptyState icon={Inbox}
                title={q ? "No conversations match" : filter === "unread" ? "You're all caught up" : filter === "attention" ? "Nothing needs attention" : filter === "leads" ? "No lead conversations yet" : "No conversations yet"}
                description={q || filter !== "all" ? undefined : "WhatsApp and email aren't connected yet. Log calls, meetings and messages here so everyone can see what was said."}
                action={props.canWrite && filter === "all" && !q ? <Button size="sm" onClick={() => setStarting(true)}><PhoneCall /> Log a call</Button> : undefined} />
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link href={href({ c: c.id })} aria-current={selectedId === c.id ? "true" : undefined}
                  className={cn("flex flex-col gap-0.5 px-3 py-2.5 hover:bg-surface-raised", selectedId === c.id && "bg-surface-raised")}>
                  <span className="flex items-center gap-2">
                    {c.unread ? <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
                    <span className={cn("min-w-0 flex-1 truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.title}</span>
                    {c.lastMessageAt ? (
                      <time dateTime={c.lastMessageAt} className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>{formatRelative(c.lastMessageAt)}</time>
                    ) : null}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{c.lastMessagePreview ?? c.subject ?? "No messages yet"}</span>
                  <span className="flex flex-wrap gap-1.5 pt-0.5">
                    <StatusBadge>{CHANNEL_LABELS[c.primaryChannel as Channel] ?? c.primaryChannel}</StatusBadge>
                    {c.needsAttention ? <StatusBadge tone="warning">Needs attention</StatusBadge> : null}
                    {c.leadId ? <StatusBadge tone="info">Lead</StatusBadge> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {pages > 1 ? (
          <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {props.page} of {pages}</span>
            <div className="flex gap-2">
              {props.page > 1 ? <Button asChild variant="secondary" size="sm"><Link href={href({ page: props.page - 1 })}>Previous</Link></Button> : null}
              {props.page < pages ? <Button asChild variant="secondary" size="sm"><Link href={href({ page: props.page + 1 })}>Next</Link></Button> : null}
            </div>
          </nav>
        ) : null}
      </div>

      {/* Conversation pane — full screen on mobile when open */}
      <div className={cn("min-w-0", !selectedId && "hidden md:block")}>
        {selected ? (
          <ConversationPane key={selected.conversation.id} detail={selected} timeZone={props.timeZone} canWrite={props.canWrite}
            aiEnabled={props.aiEnabled} backHref={href({ c: null })} />
        ) : selectedId && props.selectedError ? (
          <div className="flex flex-col gap-2">
            <Link href={href({ c: null })} className="text-sm text-muted-foreground hover:underline md:hidden">← All conversations</Link>
            <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm">{props.selectedError}</div>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState icon={Inbox} title="Choose a conversation" description="Pick one on the left to see its history, draft a reply or log a call." />
          </div>
        )}
      </div>

      <Dialog open={starting} onOpenChange={setStarting}>
        <DialogContent title="Log a call or message" description="Records what happened. Nothing is sent." className="max-w-xl">
          <StartConversation
            leadOptions={props.leadOptions}
            customerOptions={props.customerOptions}
            onCancel={() => setStarting(false)}
            onDone={(id) => { setStarting(false); router.push(href({ c: id, filter: "all", q: "" })); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StartConversation({ leadOptions, customerOptions, onDone, onCancel }: {
  leadOptions: { id: string; name: string; customerId: string | null }[];
  customerOptions: { id: string; display_name: string }[];
  onDone: (conversationId: string) => void;
  onCancel: () => void;
}) {
  const [linkKind, setLinkKind] = useState<"none" | "lead" | "customer">(leadOptions.length > 0 ? "lead" : customerOptions.length > 0 ? "customer" : "none");
  const [leadId, setLeadId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const lead = leadOptions.find((l) => l.id === leadId);
  const link = linkKind === "lead" && leadId
    ? { leadId, customerId: lead?.customerId ?? null }
    : linkKind === "customer" && customerId ? { customerId } : {};

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="start-link-kind" className="text-sm font-medium">About <span className="font-normal text-muted-foreground">(optional)</span></label>
          <Select id="start-link-kind" className="h-10" value={linkKind} onChange={(e) => setLinkKind(e.target.value as typeof linkKind)}>
            {leadOptions.length > 0 ? <option value="lead">A lead</option> : null}
            {customerOptions.length > 0 ? <option value="customer">A customer</option> : null}
            <option value="none">Not linked</option>
          </Select>
        </div>
        {linkKind === "lead" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="start-lead" className="text-sm font-medium">Lead</label>
            <Select id="start-lead" className="h-10" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Choose a lead…</option>
              {leadOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </div>
        ) : linkKind === "customer" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="start-customer" className="text-sm font-medium">Customer</label>
            <Select id="start-customer" className="h-10" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Choose a customer…</option>
              {customerOptions.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </Select>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">If there&apos;s already an open conversation for this lead or customer, it's added there.</p>
      <LogCommunicationForm idPrefix="start" withSubject link={link} onCancel={onCancel} onDone={(r) => onDone(r.conversationId)} />
    </div>
  );
}
