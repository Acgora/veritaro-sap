import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { requireAppContext } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { isGatewayConfigured } from "@/lib/ai/gateway/gateway";
import { logServerError, toUserMessage } from "@/lib/errors";
import { ErrorState, EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";

export const metadata: Metadata = { title: "AI usage" };

interface Summary {
  month: string;
  request_count: number;
  cost_usd: string;
  soft_budget_usd: string;
  hard_budget_usd: string;
  monthly_request_limit: number;
  user_rate_limit: number;
  user_rate_window_seconds: number;
  soft_flagged: boolean;
  hard_blocked: boolean;
  ai_enabled: boolean;
  plan_key: string;
}

/** Display-only formatting of DB-computed decimal strings (no arithmetic on money). */
function usd(v: string) {
  const [w = "0", f = ""] = v.split(".");
  return `US$${w}.${(f + "0000").slice(0, 4)}`;
}

export default async function AIUsagePage() {
  const app = await requireAppContext();
  if (!app.permissions.can("ai.usage_read")) {
    return <p className="text-sm text-muted-foreground">Only owners, admins and accountants can view AI usage.</p>;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_usage_summary", { p_organisation_id: app.organisation.id });
  if (error) {
    logServerError("ai.usageSummary", error);
    return <ErrorState message={toUserMessage(error, "We couldn't load AI usage.")} />;
  }
  const s = data as unknown as Summary;
  const configured = isGatewayConfigured();
  const status = !configured
    ? { tone: "neutral" as const, label: "Not connected" }
    : !s.ai_enabled
      ? { tone: "neutral" as const, label: "Turned off" }
      : s.hard_blocked
        ? { tone: "danger" as const, label: "Paused — ceiling reached" }
        : s.soft_flagged
          ? { tone: "warning" as const, label: "Above soft budget" }
          : { tone: "success" as const, label: "Active" };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">AI assistant this month</h2>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      {!configured ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState compact title="The assistant isn't connected yet" description="Your administrator needs to add the AI provider key in the hosting settings. The rest of the app works normally." />
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Spent so far</dt><dd className="text-lg font-semibold tabular-nums">{usd(s.cost_usd)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Soft budget</dt><dd className="tabular-nums">{usd(s.soft_budget_usd)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Hard ceiling</dt><dd className="tabular-nums">{usd(s.hard_budget_usd)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Requests</dt><dd className="tabular-nums">{s.request_count} of {s.monthly_request_limit}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Per-person limit</dt><dd className="tabular-nums">{s.user_rate_limit} per {Math.round(s.user_rate_window_seconds / 60)} min</dd></div>
        <div><dt className="text-xs text-muted-foreground">Plan</dt><dd>{s.plan_key}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Costs are calculated from the provider&apos;s published token prices, in US dollars. Passing the soft budget alerts owners; reaching the hard
        ceiling pauses the assistant until next month. Limits are set by Veritaro and can be changed per plan.
      </p>
    </div>
  );
}
