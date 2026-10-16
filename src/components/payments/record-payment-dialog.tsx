"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/common/form-field";
import { recordPaymentAction, listUnpaidInvoicesAction } from "@/app/app/money/payments/actions";
import { newIdempotencyKey, normaliseAmount, recordPaymentSchema } from "@/domain/payments/schema";
import type { UnpaidInvoice } from "@/domain/invoices/service";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/status";
import { formatMoney } from "@/lib/money";
import { formatDocDate } from "@/domain/commercial/dates";

// Display-only cents arithmetic on validated decimal strings (no floats).
const toCents = (s: string) => { const [w = "0", f = ""] = s.split("."); return BigInt(w) * 100n + BigInt((f + "00").slice(0, 2)); };
const fromCents = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;

/**
 * Record a payment. The dialog body mounts fresh on every open, so the idempotency key is
 * created exactly once per opening and reused by every submit/retry from that dialog.
 */
export function RecordPaymentDialog({ open, onOpenChange, invoice, today }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselected invoice; omit to let the user pick an unpaid invoice first. */
  invoice?: UnpaidInvoice | null;
  today: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Record a payment" description="Money you've received against an invoice." className="max-w-lg">
        {open ? <PaymentForm invoice={invoice ?? null} today={today} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({ invoice: preset, today, onDone }: { invoice: UnpaidInvoice | null; today: string; onDone: () => void }) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => newIdempotencyKey());
  const [invoices, setInvoices] = useState<UnpaidInvoice[] | null>(preset ? [preset] : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState(preset?.id ?? "");
  const [amount, setAmount] = useState(preset?.amount_due ?? "");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (preset) return;
    let live = true;
    listUnpaidInvoicesAction().then((r) => {
      if (!live) return;
      if (r.ok) setInvoices(r.data); else setLoadError(r.error);
    });
    return () => { live = false; };
  }, [preset]);

  const inv = invoices?.find((i) => i.id === invoiceId) ?? null;
  const input = { invoiceId, amount, paymentDate: date, method, reference, notes, idempotencyKey };

  const review = () => {
    const parsed = recordPaymentSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors);
      return;
    }
    if (inv && Number(parsed.data.amount) > Number(inv.amount_due)) {
      setErrors({ amount: [`That's more than the ${formatMoney(inv.amount_due, inv.currency)} still due on this invoice`] });
      return;
    }
    setErrors({});
    setConfirming(true);
  };

  const submit = () => start(async () => {
    const r = await recordPaymentAction(input);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      setConfirming(false);
      toast.error(r.error);
      return;
    }
    toast.success(r.data.already ? "That payment was already recorded — nothing was added twice." : "Payment recorded");
    onDone();
    router.refresh();
  });

  if (!invoices && !loadError) return <p className="text-sm text-muted-foreground">Loading unpaid invoices…</p>;
  if (loadError) return <p role="alert" className="text-sm text-danger">{loadError}</p>;
  if (invoices && invoices.length === 0) return <p className="text-sm text-muted-foreground">There are no unpaid invoices. Issue an invoice first, then record payments against it.</p>;

  if (confirming && inv) {
    const amt = normaliseAmount(amount);
    return (
      <div className="flex flex-col gap-4" role="alertdialog" aria-live="polite">
        <p className="text-base">
          Record <strong>{formatMoney(amt, inv.currency)}</strong> received from <strong>{inv.customer_name}</strong> against <strong>{inv.invoice_number}</strong>?
        </p>
        <p className="text-sm text-muted-foreground">
          {PAYMENT_METHOD_LABELS[method]} on {formatDocDate(date)}{reference ? ` · ref ${reference}` : ""}.
          {toCents(amt) < toCents(inv.amount_due) ? ` ${formatMoney(fromCents(toCents(inv.amount_due) - toCents(amt)), inv.currency)} will still be due.` : " The invoice will be fully paid."}
          {" "}A recorded payment can be reversed later but not edited.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="lg" disabled={pending} onClick={() => setConfirming(false)}>Back</Button>
          <Button size="lg" disabled={pending} onClick={submit}>{pending ? "Recording…" : "Record payment"}</Button>
        </div>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => { e.preventDefault(); review(); }}>
      {preset ? (
        <p className="text-sm">
          <strong>{preset.invoice_number}</strong> · {preset.customer_name} · {formatMoney(preset.amount_due, preset.currency)} due
        </p>
      ) : (
        <FormField id="pay-invoice" label="Invoice" required error={errors.invoiceId?.[0]}>
          {(p) => (
            <Select {...p} value={invoiceId} className="h-10" onChange={(e) => {
              setInvoiceId(e.target.value);
              const sel = invoices?.find((i) => i.id === e.target.value);
              setAmount(sel?.amount_due ?? "");
            }}>
              <option value="">Choose an unpaid invoice…</option>
              {invoices?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_number} · {i.customer_name} · {formatMoney(i.amount_due, i.currency)} due{i.effective_status === "overdue" ? " (overdue)" : ""}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="pay-amount" label="Amount received" required error={errors.amount?.[0]} hint={inv ? `Part payments are fine. Due: ${formatMoney(inv.amount_due, inv.currency)}` : undefined}>
          {(p) => <Input {...p} value={amount} inputMode="decimal" className="h-10 text-right" onChange={(e) => setAmount(e.target.value)} />}
        </FormField>
        <FormField id="pay-date" label="Date received" required error={errors.paymentDate?.[0]}>
          {(p) => <Input {...p} type="date" value={date} max={today} className="h-10" onChange={(e) => setDate(e.target.value)} />}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="pay-method" label="How was it paid?" required error={errors.method?.[0]}>
          {(p) => (
            <Select {...p} value={method} className="h-10" onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
            </Select>
          )}
        </FormField>
        <FormField id="pay-ref" label="Reference" error={errors.reference?.[0]} hint="e.g. the bank statement reference">
          {(p) => <Input {...p} value={reference} maxLength={200} className="h-10" onChange={(e) => setReference(e.target.value)} />}
        </FormField>
      </div>
      <FormField id="pay-notes" label="Notes" error={errors.notes?.[0]}>
        {(p) => <Textarea {...p} value={notes} maxLength={1000} rows={2} onChange={(e) => setNotes(e.target.value)} />}
      </FormField>
      <div className="flex justify-end gap-2">
        <Button type="submit" size="lg" disabled={!invoiceId}>Review payment</Button>
      </div>
    </form>
  );
}
