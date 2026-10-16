"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Download, Eye, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { EntityStatus } from "@/components/common/entity-status";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import {
  DraftHeaderFields, DraftLinesSection, DraftNotesSection, downloadPdf, openPdfAfter, useDraftDocument,
} from "@/components/commercial/draft-editor";
import { archiveInvoiceAction, issueInvoiceAction, saveInvoiceDraftAction } from "@/app/app/money/invoices/actions";
import type { InvoiceDetail } from "@/domain/invoices/service";
import { formatMoney } from "@/lib/money";

export function InvoiceBuilder({ detail, customers, can }: {
  detail: InvoiceDetail;
  customers: { id: string; display_name: string }[];
  can: { write: boolean; issue: boolean };
}) {
  const inv = detail.invoice;
  const router = useRouter();
  const pdfUrl = `/api/documents/invoices/${inv.id}/pdf`;
  const doc = useDraftDocument({
    customerId: inv.customer_id, contactId: inv.contact_id, siteAddressId: inv.site_address_id, title: inv.title, issueDate: inv.issue_date,
    secondDate: inv.due_date, pricesIncludeTax: inv.prices_include_tax, notes: inv.notes, terms: inv.terms, items: detail.items,
  });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, start] = useTransition();
  const [issueOpen, setIssueOpen] = useState(false);
  const [total, setTotal] = useState(inv.total.toFixed(2));
  // An invoice's customer can't change once it came from a job or quote (those links are fixed).
  const lockedCustomer = !!(inv.job_id || inv.quote_id);

  const save = async (quiet = false): Promise<boolean> => {
    const h = doc.header;
    const r = await saveInvoiceDraftAction(inv.id, {
      header: {
        customerId: h.party.customerId, contactId: h.party.contactId, siteAddressId: h.party.siteAddressId, title: h.title,
        issueDate: h.issueDate, dueDate: h.secondDate, pricesIncludeTax: h.pricesIncludeTax, notes: h.notes, terms: h.terms,
      },
      items: doc.items,
    });
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      toast.error(r.error);
      return false;
    }
    setErrors({});
    doc.setDirty(false);
    setTotal(r.data.total);
    if (!quiet) toast.success("Draft saved");
    router.refresh();
    return true;
  };

  const hasLines = doc.items.length > 0;
  const customerList = lockedCustomer ? customers.filter((c) => c.id === inv.customer_id) : customers;

  return (
    <div className="flex flex-col gap-4 pb-24 sm:pb-4">
      <PageHeader
        title="Draft invoice"
        description={<span className="inline-flex flex-wrap items-center gap-2"><EntityStatus entity="invoice" status="draft" />{detail.customer?.display_name ?? ""} · saved total {formatMoney(total, inv.currency)}{doc.dirty ? " · unsaved changes" : ""}</span>}
      />
      <p className="text-sm text-muted-foreground">
        The invoice number is assigned when you issue it.
        {detail.job ? <> From job <Link className="text-primary hover:underline" href={`/app/work/jobs/${detail.job.id}`}>{detail.job.job_number}</Link>.</> : null}
        {detail.quote ? <> From quote <Link className="text-primary hover:underline" href={`/app/sales/quotes/${detail.quote.id}`}>{detail.quote.quote_number}</Link>.</> : null}
      </p>

      <DraftHeaderFields header={doc.header} patch={doc.patch} customers={customerList} secondDateLabel="Due date" disabled={pending} errors={errors} />
      <DraftLinesSection doc={doc} vatRegistered={inv.vat_registered_snapshot} taxLabel={inv.tax_label_snapshot}
        taxRate={String(Number(inv.tax_rate_snapshot))} currency={inv.currency} disabled={pending} errors={errors} />
      <DraftNotesSection header={doc.header} patch={doc.patch} disabled={pending} errors={errors} />

      <div className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap gap-2 border-t border-border bg-surface p-3 sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Button size="lg" disabled={pending} onClick={() => start(async () => { await save(); })}><Save /> {pending ? "Saving…" : "Save draft"}</Button>
        <Button size="lg" variant="secondary" disabled={pending} onClick={() => openPdfAfter(() => save(true), pdfUrl)}><Eye /> Preview</Button>
        <Button size="lg" variant="secondary" disabled={pending} onClick={() => start(async () => { if (await save(true)) downloadPdf(pdfUrl); })}><Download /> Download draft PDF</Button>
        {can.issue ? <Button size="lg" variant="outline" disabled={pending || !hasLines} onClick={() => setIssueOpen(true)}><Send /> Issue invoice</Button> : null}
        <Button size="lg" variant="ghost" disabled title="No channel connected yet"><Send /> Send through connected channel</Button>
        <span className="self-center text-xs text-muted-foreground">No channel connected yet</span>
        <div className="flex-1" />
        <ConfirmationDialog
          trigger={(open) => <Button size="lg" variant="ghost" disabled={pending} onClick={open}><Archive /> Archive draft</Button>}
          title="Archive this draft invoice?" description="It moves to Archived invoices. Nothing is deleted and no invoice number is used." confirmLabel="Archive"
          onConfirm={async () => {
            const r = await archiveInvoiceAction(inv.id);
            if (!r.ok) { toast.error(r.error); return false; }
            toast.success("Draft archived");
            router.refresh();
          }}
        />
      </div>

      <ConfirmationDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        tone="primary"
        title="Issue this invoice?"
        description="Your changes are saved first. Issuing gives the invoice its number (e.g. INV-0042) and locks it: lines, amounts, VAT, your bank details and the customer's details are frozen exactly as they are now. Issued invoices can't be edited or deleted — only voided (if no payments are recorded) and re-issued. You can then download the PDF and send it yourself."
        confirmLabel="Issue invoice"
        onConfirm={async () => {
          if (!(await save(true))) return false;
          const r = await issueInvoiceAction(inv.id);
          if (!r.ok) { toast.error(r.error); return false; }
          toast.success(`Invoice ${r.data.invoiceNumber} issued`);
          router.refresh();
        }}
      />
    </div>
  );
}
