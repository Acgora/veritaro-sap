"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Columns3, List, Plus, Search, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/empty-state";
import { EntityStatus } from "@/components/common/entity-status";
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, LEAD_STATUS, LEAD_STATUSES, type LeadSource, type LeadStatus } from "@/domain/leads/schema";
import { groupLeadsByStatus, leadDisplayName, leadSubName } from "@/domain/leads/rules";
import type { LeadCard, LeadListItem } from "@/domain/leads/service";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { LeadForm } from "./lead-form";
import { FollowUpLabel, LeadCardBody, type CardEnv } from "./lead-card";
import { MoveToMenu, useLeadMove } from "./lead-move";
import type { Assignee } from "./datetime";

export interface LeadsFilters {
  view: "board" | "list";
  q: string;
  assigned: string;
  source: string;
  status: string;
  followUp: boolean;
  archived: boolean;
  page: number;
}

type Common = {
  filters: LeadsFilters;
  env: CardEnv;
  assignees: Assignee[];
  currentUserId: string;
  canWrite: boolean;
  openCreate: boolean;
};

export function LeadsView(
  props: Common & (
    | { mode: "board"; cards: LeadCard[]; truncated: boolean; closedWindowDays: number }
    | { mode: "list"; leads: LeadListItem[]; total: number; pageSize: number }
  ),
) {
  const { filters, canWrite } = props;
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(props.openCreate);

  const href = (patch: Partial<Record<keyof LeadsFilters, string | number | boolean>>) => {
    const merged = { ...filters, ...patch };
    const q = new URLSearchParams();
    if (merged.view === "list") q.set("view", "list");
    if (merged.q) q.set("q", String(merged.q));
    if (merged.assigned && merged.assigned !== "all") q.set("assigned", String(merged.assigned));
    if (merged.source && merged.source !== "all") q.set("source", String(merged.source));
    if (merged.view === "list") {
      if (merged.status && merged.status !== "all") q.set("status", String(merged.status));
      if (merged.followUp) q.set("followUp", "1");
      if (merged.archived) q.set("archived", "1");
      if (Number(merged.page) > 1) q.set("page", String(merged.page));
    }
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  const closeCreate = () => {
    setCreating(false);
    if (props.openCreate) router.replace(href({}));
  };

  const empty = props.mode === "board" ? props.cards.length === 0 : props.leads.length === 0;
  const filtered = !!(filters.q || filters.assigned !== "all" || filters.source !== "all" || (props.mode === "list" && (filters.status !== "all" || filters.followUp || filters.archived)));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="View" className="inline-flex rounded-md border border-border bg-surface p-0.5">
          <Link href={href({ view: "board", page: 1 })} aria-current={filters.view === "board" ? "page" : undefined}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-sm", filters.view === "board" ? "bg-surface-raised font-medium" : "text-muted-foreground")}>
            <Columns3 className="size-4" aria-hidden /> Pipeline
          </Link>
          <Link href={href({ view: "list", page: 1 })} aria-current={filters.view === "list" ? "page" : undefined}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-sm", filters.view === "list" ? "bg-surface-raised font-medium" : "text-muted-foreground")}>
            <List className="size-4" aria-hidden /> List
          </Link>
        </div>
        <div className="flex-1" />
        {canWrite ? <Button onClick={() => setCreating(true)} className="h-10 sm:h-9"><Plus /> New lead</Button> : null}
      </div>

      <form role="search" action={pathname} className="mb-4 flex flex-wrap items-center gap-2">
        {filters.view === "list" ? <input type="hidden" name="view" value="list" /> : null}
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <label htmlFor="lead-search" className="sr-only">Search leads</label>
          <Input id="lead-search" name="q" defaultValue={filters.q} placeholder="Search name, email or phone" className="pl-8" />
        </div>
        <label htmlFor="lead-assigned" className="sr-only">Assigned to</label>
        <Select id="lead-assigned" name="assigned" defaultValue={filters.assigned} className="w-40">
          <option value="all">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {props.assignees.filter((a) => a.userId !== props.currentUserId).map((a) => <option key={a.userId} value={a.userId}>{a.displayName}</option>)}
        </Select>
        <label htmlFor="lead-source" className="sr-only">Source</label>
        <Select id="lead-source" name="source" defaultValue={filters.source} className="w-36">
          <option value="all">All sources</option>
          {LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>)}
        </Select>
        {filters.view === "list" ? (
          <>
            <label htmlFor="lead-status" className="sr-only">Status</label>
            <Select id="lead-status" name="status" defaultValue={filters.status} className="w-36">
              <option value="all">All statuses</option>
              <option value="active">Open (not won/lost)</option>
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS[s].label}</option>)}
            </Select>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="followUp" value="1" defaultChecked={filters.followUp} /> Needs follow-up
            </label>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="archived" value="1" defaultChecked={filters.archived} /> Archived
            </label>
          </>
        ) : null}
        <Button type="submit" variant="secondary" size="sm">Apply</Button>
        {filtered ? <Button asChild variant="ghost" size="sm"><Link href={href({ q: "", assigned: "all", source: "all", status: "all", followUp: false, archived: false, page: 1 })}>Clear</Link></Button> : null}
      </form>

      {empty ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={Target}
            title={filtered ? "No leads match these filters" : "No leads yet"}
            description={filtered ? undefined : "Add enquiries as they come in — from a call, WhatsApp, email or a referral. Or ask the assistant: “New lead: Thandi, office clean, 082 555 1234”."}
            action={canWrite && !filtered ? <Button onClick={() => setCreating(true)}><Plus /> New lead</Button> : undefined}
          />
        </div>
      ) : props.mode === "board" ? (
        <Board cards={props.cards} env={props.env} canWrite={canWrite} truncated={props.truncated} closedWindowDays={props.closedWindowDays} />
      ) : (
        <LeadList leads={props.leads} env={props.env} total={props.total} page={filters.page} pageSize={props.pageSize} href={href} />
      )}

      <Dialog open={creating} onOpenChange={(o) => (o ? setCreating(true) : closeCreate())}>
        <DialogContent title="New lead" className="max-w-xl">
          <LeadForm assignees={props.assignees} currentUserId={props.currentUserId} onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Board (desktop) + chip list (mobile)
// -----------------------------------------------------------------------------

function Board({ cards, env, canWrite, truncated, closedWindowDays }: { cards: LeadCard[]; env: CardEnv; canWrite: boolean; truncated: boolean; closedWindowDays: number }) {
  // Optimistic stage overrides until the server data refreshes.
  const [overrides, setOverrides] = useState<Record<string, LeadStatus>>({});
  const { requestMove, dialogs, pending } = useLeadMove((id, status) => setOverrides((o) => ({ ...o, [id]: status })));
  const [dragOver, setDragOver] = useState<LeadStatus | null>(null);
  const [chip, setChip] = useState<LeadStatus | "open">("open");

  const effective = useMemo(() => cards.map((c) => (overrides[c.id] ? { ...c, status: overrides[c.id]! } : c)), [cards, overrides]);
  const columns = useMemo(() => groupLeadsByStatus(effective), [effective]);
  const target = (c: LeadCard) => ({ id: c.id, name: leadDisplayName(c) });

  const onDrop = (status: LeadStatus, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/x-lead-id");
    const card = effective.find((c) => c.id === id);
    if (card && card.status !== status) requestMove(target(card), status);
  };

  const mobileItems = chip === "open" ? effective.filter((c) => c.status !== "won" && c.status !== "lost") : columns[chip];

  return (
    <>
      {truncated ? <p className="mb-2 text-xs text-muted-foreground">Showing the first 500 leads. Use search or filters to narrow down.</p> : null}

      {/* Mobile: status chips + list */}
      <div className="md:hidden">
        <div role="group" aria-label="Filter by stage" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {(["open", ...LEAD_STATUSES] as const).map((s) => {
            const count = s === "open" ? effective.filter((c) => c.status !== "won" && c.status !== "lost").length : columns[s].length;
            return (
              <button key={s} type="button" onClick={() => setChip(s)} aria-pressed={chip === s}
                className={cn("h-9 shrink-0 rounded-full border px-3 text-sm", chip === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface")}>
                {s === "open" ? "Open" : LEAD_STATUS[s].label} <span className="opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        {mobileItems.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface"><EmptyState compact title="Nothing in this stage" /></div>
        ) : (
          <ul className="flex flex-col gap-2">
            {mobileItems.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <EntityStatus entity="lead" status={c.status} />
                  {canWrite ? <MoveToMenu target={target(c)} current={c.status} onMove={requestMove} disabled={pending} /> : null}
                </div>
                <LeadCardBody lead={c} env={env} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Desktop: columns. Drag & drop is an enhancement; the "Move to…" menu is the accessible path. */}
      <div className="hidden gap-3 overflow-x-auto pb-3 md:flex" aria-label="Lead pipeline">
        {LEAD_STATUSES.map((status) => {
          const items = columns[status];
          return (
            <section
              key={status}
              aria-labelledby={`col-${status}`}
              className={cn("flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/40", dragOver === status && "border-primary bg-info-soft")}
              onDragOver={canWrite ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(status); } : undefined}
              onDragLeave={canWrite ? () => setDragOver((d) => (d === status ? null : d)) : undefined}
              onDrop={canWrite ? (e) => onDrop(status, e) : undefined}
            >
              <header className="flex items-center justify-between px-3 py-2">
                <h2 id={`col-${status}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {LEAD_STATUS[status].label} <span className="font-normal">({items.length})</span>
                </h2>
                {status === "won" || status === "lost" ? <span className="text-[11px] text-muted-foreground">Last {closedWindowDays} days</span> : null}
              </header>
              <ul className="flex min-h-24 flex-col gap-2 px-2 pb-2">
                {items.map((c) => (
                  <li
                    key={c.id}
                    draggable={canWrite}
                    onDragStart={(e) => { e.dataTransfer.setData("text/x-lead-id", c.id); e.dataTransfer.effectAllowed = "move"; }}
                    className={cn("rounded-md border border-border bg-surface p-3 shadow-xs", canWrite && "cursor-grab active:cursor-grabbing")}
                  >
                    <LeadCardBody lead={c} env={env} />
                    {canWrite ? <div className="mt-1 flex justify-end"><MoveToMenu target={target(c)} current={c.status} onMove={requestMove} disabled={pending} /></div> : null}
                  </li>
                ))}
                {items.length === 0 ? <li className="px-1 py-3 text-center text-xs text-muted-foreground">No leads</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
      {dialogs}
    </>
  );
}

// -----------------------------------------------------------------------------
// List view
// -----------------------------------------------------------------------------

function LeadList({ leads, env, total, page, pageSize, href }: {
  leads: LeadListItem[];
  env: CardEnv;
  total: number;
  page: number;
  pageSize: number;
  href: (patch: Partial<Record<keyof LeadsFilters, string | number | boolean>>) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {leads.map((l) => {
          const sub = leadSubName(l);
          return (
            <li key={l.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <Link href={`/app/sales/leads/${l.id}`} className="text-sm font-medium hover:underline">{leadDisplayName(l)}</Link>
                <p className="truncate text-xs text-muted-foreground">
                  {[sub, l.service_summary, l.phone, l.email].filter(Boolean).join(" · ") || "No details yet"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:justify-end">
                <FollowUpLabel at={l.next_follow_up_at} env={env} />
                {l.estimated_value !== null ? <span className="font-medium tabular-nums text-foreground">{formatMoney(l.estimated_value.toFixed(2), env.currency)}</span> : null}
                <span>{LEAD_SOURCE_LABELS[l.source as LeadSource] ?? l.source}</span>
                <span>{l.assigneeName ?? "Unassigned"}</span>
                {l.archived_at ? <span>Archived</span> : null}
                <EntityStatus entity="lead" status={l.status} />
              </div>
            </li>
          );
        })}
      </ul>
      {pages > 1 ? (
        <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {pages} · {total} leads</span>
          <div className="flex gap-2">
            {page > 1 ? <Button asChild variant="secondary" size="sm"><Link href={href({ page: page - 1 })}>Previous</Link></Button> : null}
            {page < pages ? <Button asChild variant="secondary" size="sm"><Link href={href({ page: page + 1 })}>Next</Link></Button> : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
