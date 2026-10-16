"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Ban, Banknote, Download, Eye, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PageHeader, Section } from "@/components/common/page-header";
import { EntityStatus } from "@/components/common/entity-status";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { FormField } from "@/components/common/form-field";
import { StatusBadge } from "@/components/common/status-badge";
import { ActivityFeed } from "@/components/today/activity-feed";
import { DocumentView } from "@/components/commercial/document-view";
import { downloadPdf } from "@/components/commercial/draft-editor";
import { RecordPaymentDialog } from "@/components/payments/record-payment-dialog";
import { archiveInvoiceAction, voidInvoiceAction } from "@/app/app/money/invoices/actions";
import { voidPaymentAction } from "@/app/app/money/payments/actions";
import type { InvoiceDetail } from "@/domain/invoices/service";
import type { ActivityItem } from "@/domain/activity/service";
import { toPdfLines } from "@/lib/pdf/document-data";
import { formatMoney } from "@/lib/money";
import { formatDocDate } from "@/domain/commercial/dates";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/status";

/** Reason-required confirm (void invoice / reverse payment). */
function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; confirmLabel: string;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent title={title} description={description} role="alertdialog">
        <FormField id="reason" label="Reason" required>
          {(p) => <Textarea {...p} value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} />}
        </FormField>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" disabled={pending || !reason.trim()} onClick={() => start(async () => { if (await onConfirm(reason)) { setReason(""); onOpenChange(false); } })}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function InvoiceView({ detail, can, activity }: {
  detail: InvoiceDetail;
  can: { write: boolean; issue: boolean; recordPayment: boolean; readPayments: boolean };
  activity: ActivityItem[];
}) {
  const inv = detail.invoice;
  const eff = detail.effectiveStatus;
  const router = useRouter();
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reversing, setReversing] = useState<string | null>(null);
  const pdfUrl = `/api/documents/invoices/${inv.id}/pdf`;
  const issued = !!inv.issued_at;
  const fm = (n: number) => formatMoney(n.toFixed(2), inv.currency);
  const unpaid = (inv.status === "issued" || inv.status === "partially_paid") && inv.amount_due > 0;
  const livePayments = detail.payments.filter((p) => !p.voided_at);
  const customerName = inv.customer_name_snapshot ?? detail.customer?.display_name ?? "Customer";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={inv.invoice_number ? `${inv.vat_registered_snapshot ? "Tax invoice" : "Invoice"} ${inv.invoice_number}` : "Draft invoice"}
        description={<span className="inline-flex flex-wrap items-center gap-2"><EntityStatus entity="invoice" status={eff} />{customerName} · {fm(inv.total)}</span>}
        actions={
          <>
            <Button variant="secondary" size="lg" onClick={() => window.open(pdfUrl, "_blank")}><Eye /> View PDF</Button>
            <Button variant="secondary" size="lg" onClick={() => downloadPdf(pdfUrl)}><Download /> Download PDF</Button>
          </>
        }
      />

      {inv.status === "draft" ? <p className="rounded-md bg-muted p-3 text-sm">This is a draft. You can view it but not edit it.</p> : null}
      {inv.status === "void" ? <p className="rounded-md bg-muted p-3 text-sm">Voided on {inv.voided_at ? new Date(inv.voided_at).toLocaleDateString("en-ZA") : ""}{inv.void_reason ? `: “${inv.void_reason}”` : "."}</p> : null}

      {issued ? (
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Total</p><p className="font-semibold tabular-nums">{fm(inv.total)}</p></div>
          <div><p className="text-xs text-muted-foreground">Paid</p><p className="font-semibold tabular-nums">{fm(inv.amount_paid)}</p></div>
          <div>
            <p className="text-xs text-muted-foreground">Due {inv.due_date ? formatDocDate(inv.due_date) : ""}</p>
            <p className={eff === "overdue" ? "font-semibold text-danger tabular-nums" : "font-semibold tabular-nums"}>{fm(inv.amount_due)}</p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {unpaid && can.recordPayment ? <Button size="lg" onClick={() => setPaying(true)}><Banknote /> Record payment</Button> : null}
        <div className="flex-1" />
        {can.issue && ["issued", "partially_paid", "paid"].includes(inv.status) ? (
          <Button size="lg" variant="ghost" disabled={livePayments.length > 0} title={livePayments.length > 0 ? "Reverse the payments first" : undefined}
            onClick={() => setVoiding(true)}><Ban /> Void invoice</Button>
        ) : null}
        {can.write && ["draft", "paid", "void"].includes(inv.status) ? (
          <ConfirmationDialog
            trigger={(o) => <Button size="lg" variant="ghost" onClick={o}><Archive /> Archive</Button>}
            title="Archive this invoice?" description="It moves to Archived invoices. Nothing is deleted and the issued document stays as it is."
            confirmLabel="Archive"
            onConfirm={async () => {
              const r = await archiveInvoiceAction(inv.id);
              if (!r.ok) { toast.error(r.error); return false; }
              toast.success("Invoice archived");
              router.refresh();
            }}
          />
        ) : null}
      </div>
      {can.issue && livePayments.length > 0 && inv.status !== "void" ? (
        <p className="-mt-2 text-right text-xs text-muted-foreground">To void this invoice, reverse its payments first.</p>
      ) : null}

      <DocumentView
        currency={inv.currency}
        lines={toPdfLines(detail.items, inv.prices_include_tax)}
        totals={{ subtotal: inv.subtotal.toFixed(2), discountTotal: inv.discount_total.toFixed(2), taxTotal: inv.tax_total.toFixed(2), total: inv.total.toFixed(2) }}
        tax={{ label: inv.tax_label_snapshot, registered: inv.vat_registered_snapshot, rate: String(Number(inv.tax_rate_snapshot)), pricesInclude: inv.prices_include_tax }}
        parties={issued
          ? { customer: inv.customer_name_snapshot ?? "", contact: inv.contact_name_snapshot, address: inv.customer_address_snapshot, site: inv.site_address_snapshot }
          : { customer: detail.customer?.display_name ?? "", contact: detail.contact?.name, site: detail.site?.label }}
        dates={[{ label: "Invoice date", value: inv.issue_date }, { label: "Due date", value: inv.due_date }]}
        title={inv.title}
        notes={inv.notes}
        terms={inv.terms}
        payment={issued ? { amountPaid: inv.amount_paid.toFixed(2), amountDue: inv.amount_due.toFixed(2) } : null}
      />

      {issued && can.readPayments ? (
        <Section title="Payments">
          {detail.payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments recorded yet.</p> : (
            <ul className="divide-y divide-border">
              {detail.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className={p.voided_at ? "font-medium line-through" : "font-medium"}>{fm(p.amount)} · {PAYMENT_METHOD_LABELS[p.payment_method as PaymentMethod] ?? p.payment_method}</p>
                    <p className="text-xs text-muted-foreground">{formatDocDate(p.payment_date)}{p.reference ? ` · ref ${p.reference}` : ""}{p.void_reason ? ` · reversed: ${p.void_reason}` : ""}</p>
                  </div>
                  {p.voided_at ? <StatusBadge>Reversed</StatusBadge> : can.recordPayment ? (
                    <Button variant="ghost" size="sm" onClick={() => setReversing(p.id)}><Undo2 /> Reverse</Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Links">
          <ul className="flex flex-col gap-1 text-sm">
            {detail.customer ? <li>Customer: <Link className="text-primary hover:underline" href={`/app/sales/customers/${detail.customer.id}`}>{detail.customer.display_name}</Link></li> : null}
            {detail.job ? <li>Job: <Link className="text-primary hover:underline" href={`/app/work/jobs/${detail.job.id}`}>{detail.job.job_number}</Link></li> : null}
            {detail.quote ? <li>Quote: <Link className="text-primary hover:underline" href={`/app/sales/quotes/${detail.quote.id}`}>{detail.quote.quote_number}</Link></li> : null}
          </ul>
        </Section>
        <Section title="History"><ActivityFeed items={activity} currency={inv.currency} /></Section>
      </div>

      <RecordPaymentDialog open={paying} onOpenChange={setPaying} today={detail.today}
        invoice={{ id: inv.id, invoice_number: inv.invoice_number, customer_id: inv.customer_id, customer_name: customerName, due_date: inv.due_date,
          total: inv.total.toFixed(2), amount_due: inv.amount_due.toFixed(2), currency: inv.currency, effective_status: eff }} />

      <ReasonDialog open={voiding} onOpenChange={setVoiding}
        title={`Void invoice ${inv.invoice_number ?? ""}?`}
        description="Voiding cancels the invoice for good — its number stays used and it is kept on record marked VOID. Do this to correct a mistake, then create a new invoice. This can't be undone."
        confirmLabel="Void invoice"
        onConfirm={async (reason) => {
          const r = await voidInvoiceAction(inv.id, reason);
          if (!r.ok) { toast.error(r.error); return false; }
          toast.success("Invoice voided");
          router.refresh();
          return true;
        }} />

      <ReasonDialog open={reversing !== null} onOpenChange={(o) => !o && setReversing(null)}
        title="Reverse this payment?"
        description="Use this if the payment was recorded by mistake or bounced. The payment stays on record marked reversed, and the amount becomes due again."
        confirmLabel="Reverse payment"
        onConfirm={async (reason) => {
          if (!reversing) return false;
          const r = await voidPaymentAction(reversing, reason);
          if (!r.ok) { toast.error(r.error); return false; }
          toast.success("Payment reversed");
          router.refresh();
          return true;
        }} />
    </div>
  );
}
