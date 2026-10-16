"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Banknote, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { MoneyDisplay } from "@/components/common/money-display";
import { RecordPaymentDialog } from "@/components/payments/record-payment-dialog";
import type { PaymentListItem } from "@/domain/payments/service";
import { formatDocDate } from "@/domain/commercial/dates";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/status";

export function PaymentsList({ payments, canRecord, openRecord, today }: {
  payments: PaymentListItem[]; canRecord: boolean; openRecord: boolean; today: string;
}) {
  const [open, setOpen] = useState(openRecord && canRecord);
  const router = useRouter();
  const pathname = usePathname();
  const change = (o: boolean) => {
    setOpen(o);
    if (!o && openRecord) router.replace(pathname);
  };
  return (
    <div>
      {canRecord ? <div className="mb-3 flex justify-end"><Button size="lg" onClick={() => setOpen(true)}><Plus /> Record payment</Button></div> : null}
      {payments.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={Banknote} title="No payments recorded yet" description="When a customer pays, record it against their invoice so you always know what's still owed." />
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.customer_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatDocDate(p.payment_date)} · {PAYMENT_METHOD_LABELS[p.payment_method as PaymentMethod] ?? p.payment_method}
                  {p.invoice_number ? <> · <Link href={`/app/money/invoices/${p.invoice_id}`} className="text-primary hover:underline">{p.invoice_number}</Link></> : null}
                  {p.reference ? ` · ref ${p.reference}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <MoneyDisplay amount={p.amount} currency={p.currency} className={p.voided_at ? "text-sm line-through text-muted-foreground" : "text-sm font-medium"} />
                {p.voided_at ? <StatusBadge>Reversed</StatusBadge> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <RecordPaymentDialog open={open} onOpenChange={change} today={today} />
    </div>
  );
}
