import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Banknote, Clock, FileText, Receipt, Wallet } from "lucide-react";
import { getServiceContext } from "@/lib/service-context";
import { requireAppContext } from "@/lib/context";
import { getMoneyOverview } from "@/domain/payments/service";
import { formatDocDate } from "@/domain/commercial/dates";
import { PageHeader, Section } from "@/components/common/page-header";
import { ErrorState, EmptyState } from "@/components/common/empty-state";
import { ModuleGate } from "@/components/common/module-gate";
import { MoneyDisplay } from "@/components/common/money-display";
import { Button } from "@/components/ui/button";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/status";

export const metadata: Metadata = { title: "Money" };

function Stat({ icon: Icon, label, children, href, tone }: { icon: typeof Wallet; label: string; children: React.ReactNode; href: string; tone?: "danger" }) {
  return (
    <Link href={href} className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 hover:bg-surface-raised">
      <span className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" aria-hidden />{label}</span>
      <span className={tone === "danger" ? "text-xl font-semibold text-danger" : "text-xl font-semibold"}>{children}</span>
    </Link>
  );
}

export default async function MoneyPage() {
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const canInvoices = app.permissions.can("invoices.read");
  const r = canInvoices ? await getMoneyOverview(ctx) : null;
  const cur = app.organisation.currency;

  return (
    <ModuleGate permission="money.access">
      <PageHeader title="Money" description="What you're owed, what's late, and what's come in."
        actions={
          <>
            {app.permissions.can("invoices.write") ? <Button asChild size="lg"><Link href="/app/money/invoices?new=1"><Receipt /> New invoice</Link></Button> : null}
            {app.permissions.can("payments.record") ? <Button asChild size="lg" variant="secondary"><Link href="/app/money/payments?new=1"><Banknote /> Record payment</Link></Button> : null}
          </>
        } />
      {!canInvoices ? (
        <div className="rounded-lg border border-border bg-surface"><EmptyState title="You don't have access to invoices" description="Ask an owner or admin if you need it." /></div>
      ) : !r || !r.ok ? (
        <ErrorState message={r && !r.ok ? r.error : "We couldn't load the money overview."} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat icon={Wallet} label="Outstanding" href="/app/money/invoices?status=unpaid"><MoneyDisplay amount={r.data.outstanding} currency={cur} /></Stat>
            <Stat icon={AlertTriangle} label={`Overdue · ${r.data.overdueCount}`} href="/app/money/invoices?status=overdue" tone={r.data.overdueCount > 0 ? "danger" : undefined}>
              <MoneyDisplay amount={r.data.overdueAmount} currency={cur} />
            </Stat>
            <Stat icon={Clock} label="Due soon" href="/app/money/invoices?status=unpaid">{r.data.dueSoonCount} {r.data.dueSoonCount === 1 ? "invoice" : "invoices"}</Stat>
            <Stat icon={FileText} label="Drafts" href="/app/money/invoices?status=draft">{r.data.draftCount} to issue</Stat>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Overdue" action={<Link href="/app/money/invoices?status=overdue" className="text-sm text-primary hover:underline">All overdue</Link>}>
              {r.data.overdueInvoices.length === 0 ? <p className="text-sm text-muted-foreground">Nothing overdue.</p> : (
                <ul className="divide-y divide-border">
                  {r.data.overdueInvoices.map((i) => (
                    <li key={i.id}>
                      <Link href={`/app/money/invoices/${i.id}`} className="flex items-center gap-3 py-2 text-sm hover:underline">
                        <span className="min-w-0 flex-1 truncate">{i.invoice_number} · {i.customer_name}<span className="block text-xs text-danger">{i.days_overdue} days overdue · due {formatDocDate(i.due_date)}</span></span>
                        <MoneyDisplay amount={i.amount_due} currency={cur} className="font-medium" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Recent payments" action={<Link href="/app/money/payments" className="text-sm text-primary hover:underline">All payments</Link>}>
              {r.data.recentPayments.length === 0 ? <p className="text-sm text-muted-foreground">No payments recorded yet.</p> : (
                <ul className="divide-y divide-border">
                  {r.data.recentPayments.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{p.customer_name}<span className="block text-xs text-muted-foreground">{formatDocDate(p.payment_date)} · {PAYMENT_METHOD_LABELS[p.payment_method as PaymentMethod] ?? p.payment_method}{p.invoice_number ? ` · ${p.invoice_number}` : ""}</span></span>
                      <MoneyDisplay amount={p.amount} currency={p.currency} className="font-medium" />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          <nav aria-label="Money sections" className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href="/app/money/invoices">Invoices <ArrowRight /></Link></Button>
            <Button asChild variant="outline"><Link href="/app/money/payments">Payments <ArrowRight /></Link></Button>
            <Button asChild variant="outline"><Link href="/app/settings/financial">Quote &amp; invoice settings <ArrowRight /></Link></Button>
          </nav>
        </div>
      )}
    </ModuleGate>
  );
}
