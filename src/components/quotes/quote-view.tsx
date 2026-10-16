"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Archive, Briefcase, Check, Copy, Download, Eye, Receipt, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PageHeader, Section } from "@/components/common/page-header";
import { EntityStatus } from "@/components/common/entity-status";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { FormField } from "@/components/common/form-field";
import { ActivityFeed } from "@/components/today/activity-feed";
import { DocumentView } from "@/components/commercial/document-view";
import { downloadPdf } from "@/components/commercial/draft-editor";
import {
  archiveQuoteAction, createInvoiceFromQuoteAction, duplicateQuoteAction, setQuoteOutcomeAction,
} from "@/app/app/sales/quotes/actions";
import { ACCEPT_METHODS, ACCEPT_METHOD_LABELS, type AcceptMethod } from "@/domain/quotes/schema";
import type { QuoteDetail } from "@/domain/quotes/service";
import type { ActivityItem } from "@/domain/activity/service";
import { toPdfLines } from "@/lib/pdf/document-data";
import { formatMoney } from "@/lib/money";
import { formatDocDate } from "@/domain/commercial/dates";

export function QuoteView({ detail, can, activity }: {
  detail: QuoteDetail;
  can: { write: boolean; issue: boolean; jobsWrite: boolean; invoicesWrite: boolean };
  activity: ActivityItem[];
  timeZone: string;
}) {
  const q = detail.quote;
  const eff = detail.effectiveStatus;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [method, setMethod] = useState<AcceptMethod>("verbal");
  const [reason, setReason] = useState("");
  const pdfUrl = `/api/documents/quotes/${q.id}/pdf`;
  const issued = !!q.issued_at;
  const open = q.status === "sent" || q.status === "viewed";
  const fm = (n: number) => formatMoney(n.toFixed(2), q.currency);

  const duplicate = () => start(async () => {
    const r = await duplicateQuoteAction(q.id);
    if (r.ok) { toast.success("Draft revision created"); router.push(`/app/sales/quotes/${r.data.id}`); } else toast.error(r.error);
  });
  const outcome = async (o: "accepted" | "declined" | "viewed", m?: AcceptMethod, why?: string) => {
    const r = await setQuoteOutcomeAction(q.id, o, m, why);
    if (!r.ok) { toast.error(r.error); return false; }
    toast.success(o === "accepted" ? "Quote marked accepted" : o === "declined" ? "Quote marked declined" : "Quote marked viewed");
    router.refresh();
    return true;
  };
  const toInvoice = () => start(async () => {
    const r = await createInvoiceFromQuoteAction(q.id);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.data.created ? "Draft invoice created" : "Opening the existing invoice");
    router.push(`/app/money/invoices/${r.data.invoiceId}`);
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Quote ${q.quote_number}`}
        description={<span className="inline-flex flex-wrap items-center gap-2"><EntityStatus entity="quote" status={eff} />{q.customer_name_snapshot ?? detail.customer?.display_name} · {fm(q.total)}</span>}
        actions={
          <>
            <Button variant="secondary" size="lg" onClick={() => window.open(pdfUrl, "_blank")}><Eye /> View PDF</Button>
            <Button variant="secondary" size="lg" onClick={() => downloadPdf(pdfUrl)}><Download /> Download PDF</Button>
          </>
        }
      />

      {eff === "expired" ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-warning-soft p-3 text-sm">
          <AlertTriangle className="size-4 text-warning" aria-hidden />
          <p className="flex-1">This quote expired on {formatDocDate(q.expiry_date)}. It can&apos;t be accepted any more — duplicate it to re-issue with a new expiry date.</p>
          {can.write ? <Button size="sm" disabled={pending} onClick={duplicate}><Copy /> Duplicate to re-issue</Button> : null}
        </div>
      ) : null}

      {q.status === "accepted" ? (
        <div className="flex flex-col gap-3 rounded-lg border border-success/40 bg-success-soft p-4 sm:flex-row sm:items-center">
          <div className="flex-1 text-sm">
            <p className="font-semibold">Accepted{q.accepted_method ? ` — ${ACCEPT_METHOD_LABELS[q.accepted_method as AcceptMethod]?.toLowerCase() ?? q.accepted_method}` : ""}</p>
            <p className="text-muted-foreground">Turn it into work and get paid. Everything on the quote carries over.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {detail.jobId ? (
              <Button asChild size="lg" variant="secondary"><Link href={`/app/work/jobs/${detail.jobId}`}><Briefcase /> Open job</Link></Button>
            ) : can.jobsWrite ? (
              <Button asChild size="lg"><Link href={`/app/work/jobs/new?quote=${q.id}`}><Briefcase /> Create job</Link></Button>
            ) : null}
            {detail.invoiceId ? (
              <Button asChild size="lg" variant="secondary"><Link href={`/app/money/invoices/${detail.invoiceId}`}><Receipt /> Open invoice</Link></Button>
            ) : can.invoicesWrite ? (
              <Button size="lg" variant={detail.jobId || !can.jobsWrite ? "primary" : "secondary"} disabled={pending} onClick={toInvoice}><Receipt /> Create invoice</Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {q.status === "declined" ? (
        <p className="rounded-md bg-muted p-3 text-sm">Declined{q.decline_reason ? `: “${q.decline_reason}”` : "."}</p>
      ) : null}
      {q.status === "draft" ? <p className="rounded-md bg-muted p-3 text-sm">This is a draft. You can view it but not edit it.</p> : null}

      {(open && can.issue) || can.write ? (
        <div className="flex flex-wrap gap-2">
          {open && can.issue && eff !== "expired" ? (
            <Button size="lg" disabled={pending} onClick={() => setAccepting(true)}><Check /> Mark accepted</Button>
          ) : null}
          {open && can.issue ? <Button size="lg" variant="secondary" disabled={pending} onClick={() => setDeclining(true)}><X /> Mark declined</Button> : null}
          {q.status === "sent" && can.issue ? (
            <Button size="lg" variant="outline" disabled={pending} onClick={() => start(async () => { await outcome("viewed"); })}><Eye /> Mark viewed</Button>
          ) : null}
          {open ? (
            <>
              <Button size="lg" variant="ghost" disabled title="No channel connected yet"><Send /> Send through connected channel</Button>
              <span className="self-center text-xs text-muted-foreground">No channel connected yet</span>
            </>
          ) : null}
          <div className="flex-1" />
          {can.write && issued ? <Button size="lg" variant="ghost" disabled={pending} onClick={duplicate}><Copy /> Duplicate (revision)</Button> : null}
          {can.issue && q.status !== "archived" ? (
            <ConfirmationDialog
              trigger={(o) => <Button size="lg" variant="ghost" disabled={pending} onClick={o}><Archive /> Archive</Button>}
              title={`Archive quote ${q.quote_number}?`}
              description="It moves to Archived quotes and stops appearing in follow-ups. Nothing is deleted and the issued document stays as it is."
              confirmLabel="Archive"
              onConfirm={async () => {
                const r = await archiveQuoteAction(q.id);
                if (!r.ok) { toast.error(r.error); return false; }
                toast.success("Quote archived");
                router.refresh();
              }}
            />
          ) : null}
        </div>
      ) : null}

      <DocumentView
        currency={q.currency}
        lines={toPdfLines(detail.items, q.prices_include_tax)}
        totals={{ subtotal: q.subtotal.toFixed(2), discountTotal: q.discount_total.toFixed(2), taxTotal: q.tax_total.toFixed(2), total: q.total.toFixed(2) }}
        tax={{ label: q.tax_label_snapshot, registered: q.vat_registered_snapshot, rate: String(Number(q.tax_rate_snapshot)), pricesInclude: q.prices_include_tax }}
        parties={issued
          ? { customer: q.customer_name_snapshot ?? "", contact: q.contact_name_snapshot, address: q.customer_address_snapshot, site: q.site_address_snapshot }
          : { customer: detail.customer?.display_name ?? "", contact: detail.contact?.name, site: detail.site?.label }}
        dates={[{ label: "Quote date", value: q.issue_date }, { label: "Valid until", value: q.expiry_date }]}
        title={q.title}
        notes={q.notes}
        terms={q.terms}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Links">
          <ul className="flex flex-col gap-1 text-sm">
            {detail.customer ? <li>Customer: <Link className="text-primary hover:underline" href={`/app/sales/customers/${detail.customer.id}`}>{detail.customer.display_name}</Link></li> : null}
            {detail.lead ? <li>Lead: <Link className="text-primary hover:underline" href={`/app/sales/leads/${detail.lead.id}`}>{detail.lead.title}</Link></li> : null}
            {detail.revisionOf ? <li>Revision of: <Link className="text-primary hover:underline" href={`/app/sales/quotes/${detail.revisionOf.id}`}>{detail.revisionOf.quote_number}</Link></li> : null}
            {detail.jobId ? <li><Link className="text-primary hover:underline" href={`/app/work/jobs/${detail.jobId}`}>Job</Link></li> : null}
            {detail.invoiceId ? <li><Link className="text-primary hover:underline" href={`/app/money/invoices/${detail.invoiceId}`}>Invoice</Link></li> : null}
          </ul>
        </Section>
        <Section title="History"><ActivityFeed items={activity} currency={q.currency} /></Section>
      </div>

      <Dialog open={accepting} onOpenChange={(o) => !pending && setAccepting(o)}>
        <DialogContent title={`Mark quote ${q.quote_number} as accepted?`} description={`Record that ${q.customer_name_snapshot ?? "the customer"} accepted ${fm(q.total)}. You can then create the job and invoice from it.`} role="alertdialog">
          <FormField id="accept-method" label="How did they accept?" required>
            {(p) => (
              <Select {...p} value={method} onChange={(e) => setMethod(e.target.value as AcceptMethod)} className="h-10">
                {ACCEPT_METHODS.map((m) => <option key={m} value={m}>{ACCEPT_METHOD_LABELS[m]}</option>)}
              </Select>
            )}
          </FormField>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => setAccepting(false)}>Cancel</Button>
            <Button disabled={pending} onClick={() => start(async () => { if (await outcome("accepted", method)) setAccepting(false); })}>
              {pending ? "Working…" : "Mark accepted"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={declining} onOpenChange={(o) => !pending && setDeclining(o)}>
        <DialogContent title={`Mark quote ${q.quote_number} as declined?`} description="The quote is closed as declined. You can still duplicate it later." role="alertdialog">
          <FormField id="decline-reason" label="Reason" hint="Helps you spot patterns, e.g. “price too high”">
            {(p) => <Textarea {...p} value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} />}
          </FormField>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => setDeclining(false)}>Cancel</Button>
            <Button variant="danger" disabled={pending} onClick={() => start(async () => { if (await outcome("declined", undefined, reason)) setDeclining(false); })}>
              {pending ? "Working…" : "Mark declined"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
