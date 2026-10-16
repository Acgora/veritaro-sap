"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Copy, Download, Eye, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { EntityStatus } from "@/components/common/entity-status";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import {
  DraftHeaderFields, DraftLinesSection, DraftNotesSection, downloadPdf, openPdfAfter, useDraftDocument,
} from "@/components/commercial/draft-editor";
import { archiveQuoteAction, duplicateQuoteAction, issueQuoteAction, saveQuoteDraftAction } from "@/app/app/sales/quotes/actions";
import type { QuoteDetail } from "@/domain/quotes/service";
import { formatMoney } from "@/lib/money";

export function QuoteBuilder({ detail, customers, can }: {
  detail: QuoteDetail;
  customers: { id: string; display_name: string }[];
  can: { write: boolean; issue: boolean };
}) {
  const q = detail.quote;
  const router = useRouter();
  const pdfUrl = `/api/documents/quotes/${q.id}/pdf`;
  const doc = useDraftDocument({
    customerId: q.customer_id, contactId: q.contact_id, siteAddressId: q.site_address_id, title: q.title, issueDate: q.issue_date,
    secondDate: q.expiry_date, pricesIncludeTax: q.prices_include_tax, notes: q.notes, terms: q.terms, items: detail.items,
  });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, start] = useTransition();
  const [issueOpen, setIssueOpen] = useState<null | "manual" | "download">(null);
  const [total, setTotal] = useState(q.total.toFixed(2));

  const save = async (quiet = false): Promise<boolean> => {
    const h = doc.header;
    const r = await saveQuoteDraftAction(q.id, {
      header: {
        customerId: h.party.customerId, contactId: h.party.contactId, siteAddressId: h.party.siteAddressId, title: h.title,
        issueDate: h.issueDate, expiryDate: h.secondDate, pricesIncludeTax: h.pricesIncludeTax, notes: h.notes, terms: h.terms,
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

  const issue = async (method: "manual" | "download") => {
    if (!(await save(true))) return false;
    const r = await issueQuoteAction(q.id, method);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success(`Quote ${r.data.quoteNumber} issued`);
    if (method === "download") downloadPdf(pdfUrl);
    router.refresh();
    return true;
  };

  const hasLines = doc.items.length > 0;

  return (
    <div className="flex flex-col gap-4 pb-24 sm:pb-4">
      <PageHeader
        title={`Quote ${q.quote_number}`}
        description={<span className="inline-flex items-center gap-2"><EntityStatus entity="quote" status="draft" />{detail.customer?.display_name ?? ""} · saved total {formatMoney(total, q.currency)}{doc.dirty ? " · unsaved changes" : ""}</span>}
      />
      {detail.revisionOf ? <p className="text-sm text-muted-foreground">Revision of quote {detail.revisionOf.quote_number}.</p> : null}

      <DraftHeaderFields header={doc.header} patch={doc.patch} customers={customers} secondDateLabel="Valid until" disabled={pending} errors={errors} />
      <DraftLinesSection doc={doc} vatRegistered={q.vat_registered_snapshot} taxLabel={q.tax_label_snapshot}
        taxRate={String(Number(q.tax_rate_snapshot))} currency={q.currency} disabled={pending} errors={errors} />
      <DraftNotesSection header={doc.header} patch={doc.patch} disabled={pending} errors={errors} />

      <div className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap gap-2 border-t border-border bg-surface p-3 sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Button size="lg" disabled={pending} onClick={() => start(async () => { await save(); })}><Save /> {pending ? "Saving…" : "Save draft"}</Button>
        <Button size="lg" variant="secondary" disabled={pending} onClick={() => openPdfAfter(() => save(true), pdfUrl)}><Eye /> Preview</Button>
        <Button size="lg" variant="secondary" disabled={pending} onClick={() => start(async () => { if (await save(true)) downloadPdf(pdfUrl); })}><Download /> Download PDF</Button>
        {can.issue ? (
          <>
            <Button size="lg" variant="outline" disabled={pending || !hasLines} onClick={() => setIssueOpen("manual")}><Send /> Mark as sent</Button>
            <Button size="lg" variant="outline" disabled={pending || !hasLines} onClick={() => setIssueOpen("download")}><Download /> Issue &amp; download</Button>
          </>
        ) : null}
        <Button size="lg" variant="ghost" disabled title="No channel connected yet" aria-describedby="no-channel"><Send /> Send through connected channel</Button>
        <span id="no-channel" className="self-center text-xs text-muted-foreground">No channel connected yet</span>
        <div className="flex-1" />
        <Button size="lg" variant="ghost" disabled={pending} onClick={() => start(async () => {
          const r = await duplicateQuoteAction(q.id);
          if (r.ok) { toast.success("Copy created"); router.push(`/app/sales/quotes/${r.data.id}`); } else toast.error(r.error);
        })}><Copy /> Duplicate</Button>
        {can.issue ? (
          <ConfirmationDialog
            trigger={(open) => <Button size="lg" variant="ghost" disabled={pending} onClick={open}><Archive /> Archive</Button>}
            title="Archive this draft?" description="It will move to Archived quotes. Nothing is deleted." confirmLabel="Archive"
            onConfirm={async () => {
              const r = await archiveQuoteAction(q.id);
              if (!r.ok) { toast.error(r.error); return false; }
              toast.success("Quote archived");
              router.refresh();
            }}
          />
        ) : null}
      </div>
      {!hasLines ? <p className="text-xs text-muted-foreground">Add at least one line before issuing.</p> : null}

      <ConfirmationDialog
        open={issueOpen !== null}
        onOpenChange={(o) => !o && setIssueOpen(null)}
        tone="primary"
        title={issueOpen === "download" ? "Issue the quote and download the PDF?" : "Mark this quote as sent?"}
        description={`Your changes are saved first. Issuing locks quote ${q.quote_number}: its lines, prices, VAT and your business and customer details are frozen exactly as they are now. To change it later you'll duplicate it as a revision. Use this once you've sent (or are about to send) the quote to the customer yourself.`}
        confirmLabel={issueOpen === "download" ? "Issue & download" : "Issue quote"}
        onConfirm={async () => {
          const method = issueOpen ?? "manual";
          const done = await issue(method);
          if (done) setIssueOpen(null);
          return done;
        }}
      />
    </div>
  );
}
