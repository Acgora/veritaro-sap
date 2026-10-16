"use client";
import Link from "next/link";
import { AlarmClock, UserRound } from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { LEAD_SOURCE_LABELS, type LeadSource } from "@/domain/leads/schema";
import { followUpState, leadDisplayName, leadSubName } from "@/domain/leads/rules";
import type { LeadCard as LeadCardData } from "@/domain/leads/service";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface CardEnv { timeZone: string; currency: string; nowIso: string; dayEndIso: string }

export function FollowUpLabel({ at, env, className }: { at: string | null; env: CardEnv; className?: string }) {
  const state = followUpState(at, new Date(env.nowIso), env.dayEndIso);
  if (!at || !state) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", state === "overdue" ? "font-medium text-danger" : state === "today" ? "text-warning" : "text-muted-foreground", className)}>
      <AlarmClock className="size-3.5" aria-hidden />
      {state === "overdue" ? "Overdue · " : state === "today" ? "Today · " : "Follow up "}
      <time dateTime={at}>{formatDateTime(at, env.timeZone)}</time>
    </span>
  );
}

export function LeadCardBody({ lead, env }: { lead: LeadCardData; env: CardEnv }) {
  const sub = leadSubName(lead);
  return (
    <div className="min-w-0">
      <Link href={`/app/sales/leads/${lead.id}`} className="block truncate text-sm font-medium hover:underline">
        {leadDisplayName(lead)}
      </Link>
      {sub ? <p className="truncate text-xs text-muted-foreground">{sub}</p> : null}
      {lead.service_summary ? <p className="mt-1 line-clamp-2 text-xs text-foreground/80">{lead.service_summary}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {lead.estimated_value !== null ? (
          <span className="text-xs font-medium tabular-nums">{formatMoney(lead.estimated_value.toFixed(2), env.currency)}</span>
        ) : null}
        <FollowUpLabel at={lead.next_follow_up_at} env={env} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge>{LEAD_SOURCE_LABELS[lead.source as LeadSource] ?? lead.source}</StatusBadge>
        <span className="inline-flex items-center gap-1">
          <UserRound className="size-3.5" aria-hidden />
          {lead.assigneeName ?? "Unassigned"}
        </span>
      </div>
    </div>
  );
}
