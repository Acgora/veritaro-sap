"use client";
import { useState } from "react";
import { Input, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { Section } from "@/components/common/page-header";
import { PartyPicker, type PartyValue } from "@/components/commercial/party-picker";
import { LineItemsEditor, newEditorLine, type EditorLine } from "@/components/line-items/line-items-editor";
import { fromItemRow } from "@/domain/commercial/line-items";

export interface DraftHeader {
  party: PartyValue;
  title: string;
  issueDate: string;
  secondDate: string;
  pricesIncludeTax: boolean;
  notes: string;
  terms: string;
}

type ItemRow = Parameters<typeof fromItemRow>[0];

/** Header + lines state for a draft quote/invoice, with a stable payload for the save service. */
export function useDraftDocument(init: {
  customerId: string; contactId: string | null; siteAddressId: string | null; title: string | null; issueDate: string;
  secondDate: string | null; pricesIncludeTax: boolean; notes: string | null; terms: string | null; items: ItemRow[];
}) {
  const [header, setHeader] = useState<DraftHeader>({
    party: { customerId: init.customerId, contactId: init.contactId ?? "", siteAddressId: init.siteAddressId ?? "" },
    title: init.title ?? "", issueDate: init.issueDate, secondDate: init.secondDate ?? init.issueDate,
    pricesIncludeTax: init.pricesIncludeTax, notes: init.notes ?? "", terms: init.terms ?? "",
  });
  const [lines, setLinesState] = useState<EditorLine[]>(() =>
    init.items.length ? init.items.map((r) => ({ ...fromItemRow(r), id: r.id })) : [newEditorLine()]);
  const [dirty, setDirty] = useState(false);
  const patch = (p: Partial<DraftHeader>) => { setHeader((h) => ({ ...h, ...p })); setDirty(true); };
  const setLines = (l: EditorLine[]) => { setLinesState(l); setDirty(true); };
  /** Blank lines (nothing typed) are dropped rather than failing validation. */
  const items = lines
    .filter((l) => l.description.trim() || l.unitPrice.trim())
    .map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice || "0",
      discountType: l.discountType, discountValue: l.discountValue, taxable: l.taxable }));
  return { header, patch, lines, setLines, items, dirty, setDirty };
}

export function DraftHeaderFields({ header, patch, customers, secondDateLabel, disabled, errors }: {
  header: DraftHeader; patch: (p: Partial<DraftHeader>) => void; customers: { id: string; display_name: string }[];
  secondDateLabel: string; disabled?: boolean; errors: Record<string, string[] | undefined>;
}) {
  const e = (k: string) => errors[`header.${k}`]?.[0];
  return (
    <Section title="Details">
      <div className="flex flex-col gap-4">
        <PartyPicker customers={customers} value={header.party} onChange={(party) => patch({ party })} disabled={disabled} error={e("customerId")} />
        <FormField id="doc-title" label="Title" error={e("title")}>
          {(p) => <Input {...p} value={header.title} maxLength={200} disabled={disabled} className="h-10" onChange={(ev) => patch({ title: ev.target.value })} />}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="doc-issue" label="Date" required error={e("issueDate")}>
            {(p) => <Input {...p} type="date" value={header.issueDate} disabled={disabled} className="h-10" onChange={(ev) => patch({ issueDate: ev.target.value })} />}
          </FormField>
          <FormField id="doc-second" label={secondDateLabel} required error={e("expiryDate") ?? e("dueDate")}>
            {(p) => <Input {...p} type="date" value={header.secondDate} min={header.issueDate} disabled={disabled} className="h-10" onChange={(ev) => patch({ secondDate: ev.target.value })} />}
          </FormField>
        </div>
      </div>
    </Section>
  );
}

export function DraftLinesSection({ doc, vatRegistered, taxLabel, taxRate, currency, disabled, errors }: {
  doc: ReturnType<typeof useDraftDocument>; vatRegistered: boolean; taxLabel: string; taxRate: string; currency: string;
  disabled?: boolean; errors: Record<string, string[] | undefined>;
}) {
  return (
    <Section title="Lines">
      <LineItemsEditor
        lines={doc.lines} onChange={doc.setLines} vatRegistered={vatRegistered} taxLabel={taxLabel} taxRate={taxRate}
        pricesIncludeTax={doc.header.pricesIncludeTax} onPricesIncludeTaxChange={(v) => doc.patch({ pricesIncludeTax: v })}
        currency={currency} errors={errors} disabled={disabled}
      />
    </Section>
  );
}

export function DraftNotesSection({ header, patch, disabled, errors }: {
  header: DraftHeader; patch: (p: Partial<DraftHeader>) => void; disabled?: boolean; errors: Record<string, string[] | undefined>;
}) {
  return (
    <Section title="Notes and terms">
      <div className="flex flex-col gap-4">
        <FormField id="doc-notes" label="Notes for the customer" error={errors["header.notes"]?.[0]}>
          {(p) => <Textarea {...p} value={header.notes} maxLength={4000} rows={3} disabled={disabled} onChange={(ev) => patch({ notes: ev.target.value })} />}
        </FormField>
        <FormField id="doc-terms" label="Terms" hint="Prefilled from your settings." error={errors["header.terms"]?.[0]}>
          {(p) => <Textarea {...p} value={header.terms} maxLength={4000} rows={4} disabled={disabled} onChange={(ev) => patch({ terms: ev.target.value })} />}
        </FormField>
      </div>
    </Section>
  );
}

/** Open a PDF URL in a new tab without tripping popup blockers (tab opened synchronously, URL set after save). */
export function openPdfAfter(task: () => Promise<boolean>, url: string) {
  const w = window.open("about:blank", "_blank");
  task().then((okay) => {
    if (okay && w) w.location.href = url;
    else if (okay) window.location.href = url;
    else w?.close();
  });
}

export function downloadPdf(url: string) {
  window.location.href = `${url}?download=1`;
}
