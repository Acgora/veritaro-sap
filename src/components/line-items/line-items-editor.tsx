"use client";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { documentTotals, isDecimalString, lineAmounts, type LineInput, type TaxBasis } from "@/lib/money-calc";
import { formatMoney } from "@/lib/money";
import { DISCOUNT_KINDS, DISCOUNT_LABELS, type DiscountKind } from "@/domain/commercial/line-items";
import { cn } from "@/lib/utils";

/** One editable line. All numeric fields are strings exactly as typed. */
export interface EditorLine {
  /** Existing item id, or a client UUID for a new line (makes saves idempotent). */
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountType: DiscountKind;
  discountValue: string;
  taxable: boolean;
}

export function newEditorLine(partial: Partial<EditorLine> = {}): EditorLine {
  return { id: crypto.randomUUID(), description: "", quantity: "1", unit: "", unitPrice: "", discountType: "none", discountValue: "", taxable: true, ...partial };
}

/** Editor line → money-calc input, or null while the user is still typing something invalid. */
export function toCalcLine(l: EditorLine): LineInput | null {
  const qty = l.quantity.trim();
  const price = (l.unitPrice.trim() || "0");
  if (!isDecimalString(qty, 3) || !isDecimalString(price, 2)) return null;
  const hasDiscount = l.discountType !== "none" && l.discountValue.trim() !== "";
  if (hasDiscount && !isDecimalString(l.discountValue, 2)) return null;
  return {
    quantity: qty, unitPrice: price, taxable: l.taxable,
    discountType: hasDiscount ? (l.discountType as "percent" | "amount") : null,
    discountValue: hasDiscount ? l.discountValue.trim() : null,
  };
}

/** Live preview totals (the DB recalculates authoritatively on save). */
export function previewTotals(lines: EditorLine[], basis: TaxBasis) {
  const valid = lines.map(toCalcLine).filter((l): l is LineInput => l !== null);
  return { ...documentTotals(valid, basis), invalidCount: lines.length - valid.length };
}

export function LineItemsEditor({
  lines, onChange, vatRegistered, taxLabel, taxRate, pricesIncludeTax, onPricesIncludeTaxChange, currency, errors = {}, disabled,
}: {
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  vatRegistered: boolean;
  taxLabel: string;
  taxRate: string;
  pricesIncludeTax: boolean;
  onPricesIncludeTaxChange: (v: boolean) => void;
  currency: string;
  /** Keys like "items.0.quantity" → messages (from the service's fieldErrors). */
  errors?: Record<string, string[] | undefined>;
  disabled?: boolean;
}) {
  const basis: TaxBasis = { taxRate, vatRegistered, pricesIncludeTax };
  const totals = previewTotals(lines, basis);
  const fm = (v: string) => formatMoney(v, currency);
  const set = (i: number, patch: Partial<EditorLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= lines.length) return;
    const next = [...lines];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const remove = (i: number) => onChange(lines.filter((_, j) => j !== i));
  const err = (i: number, f: string) => errors[`items.${i}.${f}`]?.[0];
  const cols = vatRegistered
    ? "md:grid-cols-[minmax(0,1fr)_5rem_5rem_7rem_9rem_3.5rem_7rem_6.5rem]"
    : "md:grid-cols-[minmax(0,1fr)_5rem_5rem_7rem_9rem_7rem_6.5rem]";

  return (
    <div className="flex flex-col gap-3">
      {vatRegistered ? (
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={pricesIncludeTax} disabled={disabled}
            onChange={(e) => onPricesIncludeTaxChange(e.target.checked)} />
          Prices I enter include {taxLabel}
        </label>
      ) : null}

      <div className={cn("hidden gap-2 px-1 text-xs font-medium text-muted-foreground md:grid", cols)} aria-hidden>
        <span>Description</span><span className="text-right">Qty</span><span>Unit</span><span className="text-right">Price</span>
        <span>Discount</span>{vatRegistered ? <span className="text-center">{taxLabel}</span> : null}<span className="text-right">Line total</span><span />
      </div>

      <ol className="flex flex-col gap-2">
        {lines.map((l, i) => {
          const calc = toCalcLine(l);
          const amounts = calc ? lineAmounts(calc, basis) : null;
          const shown = amounts ? (pricesIncludeTax ? amounts.total : amounts.excl) : null;
          const n = i + 1;
          return (
            <li key={l.id} className={cn("grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface p-3 md:items-start md:rounded-none md:border-0 md:border-b md:p-1 md:pb-2", cols)}>
              <div className="col-span-2 md:col-span-1">
                <label htmlFor={`d-${l.id}`} className="mb-1 block text-xs text-muted-foreground md:sr-only">Line {n} description</label>
                <Input id={`d-${l.id}`} value={l.description} disabled={disabled} placeholder="e.g. Deep clean, 3-bedroom house" maxLength={1000}
                  aria-invalid={err(i, "description") ? true : undefined} className="h-10"
                  onChange={(e) => set(i, { description: e.target.value })} />
                {err(i, "description") ? <p className="mt-1 text-xs text-danger">{err(i, "description")}</p> : null}
              </div>
              <div>
                <label htmlFor={`q-${l.id}`} className="mb-1 block text-xs text-muted-foreground md:sr-only">Quantity</label>
                <Input id={`q-${l.id}`} value={l.quantity} disabled={disabled} inputMode="decimal" className="h-10 text-right"
                  aria-invalid={!isDecimalString(l.quantity || "x", 3) || err(i, "quantity") ? true : undefined}
                  onChange={(e) => set(i, { quantity: e.target.value })} />
                {err(i, "quantity") ? <p className="mt-1 text-xs text-danger">{err(i, "quantity")}</p> : null}
              </div>
              <div>
                <label htmlFor={`u-${l.id}`} className="mb-1 block text-xs text-muted-foreground md:sr-only">Unit</label>
                <Input id={`u-${l.id}`} value={l.unit} disabled={disabled} placeholder="hrs, m²" maxLength={20} className="h-10"
                  onChange={(e) => set(i, { unit: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`p-${l.id}`} className="mb-1 block text-xs text-muted-foreground md:sr-only">Unit price</label>
                <Input id={`p-${l.id}`} value={l.unitPrice} disabled={disabled} inputMode="decimal" placeholder="0.00" className="h-10 text-right"
                  aria-invalid={(l.unitPrice && !isDecimalString(l.unitPrice, 2)) || err(i, "unitPrice") ? true : undefined}
                  onChange={(e) => set(i, { unitPrice: e.target.value })} />
                {err(i, "unitPrice") ? <p className="mt-1 text-xs text-danger">{err(i, "unitPrice")}</p> : null}
              </div>
              <div>
                <span className="mb-1 block text-xs text-muted-foreground md:sr-only" id={`dl-${l.id}`}>Discount</span>
                <div className="flex gap-1">
                  <Select aria-labelledby={`dl-${l.id}`} aria-label="Discount type" value={l.discountType} disabled={disabled} className="h-10 w-16 px-2 pr-6"
                    onChange={(e) => set(i, { discountType: e.target.value as DiscountKind, discountValue: e.target.value === "none" ? "" : l.discountValue })}>
                    {DISCOUNT_KINDS.map((k) => <option key={k} value={k}>{k === "none" ? "—" : DISCOUNT_LABELS[k]}</option>)}
                  </Select>
                  <Input aria-label="Discount value" value={l.discountValue} disabled={disabled || l.discountType === "none"} inputMode="decimal"
                    className="h-10 flex-1 text-right" placeholder={l.discountType === "percent" ? "%" : "0.00"}
                    aria-invalid={err(i, "discountValue") ? true : undefined}
                    onChange={(e) => set(i, { discountValue: e.target.value })} />
                </div>
                {err(i, "discountValue") ? <p className="mt-1 text-xs text-danger">{err(i, "discountValue")}</p> : null}
              </div>
              {vatRegistered ? (
                <label className="flex min-h-10 items-center gap-2 text-sm md:justify-center">
                  <input type="checkbox" className="size-5 accent-primary" checked={l.taxable} disabled={disabled}
                    onChange={(e) => set(i, { taxable: e.target.checked })} />
                  <span className="md:sr-only">Charge {taxLabel}</span>
                </label>
              ) : null}
              <div className="flex min-h-10 items-center justify-end text-sm font-medium tabular-nums">
                <span className="mr-auto text-xs font-normal text-muted-foreground md:hidden">Line total</span>
                {shown !== null ? fm(shown) : <span className="text-xs text-danger">Check numbers</span>}
              </div>
              <div className="col-span-2 flex justify-end gap-1 md:col-span-1">
                <Button variant="ghost" size="icon" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`Move line ${n} up`}><ArrowUp /></Button>
                <Button variant="ghost" size="icon" disabled={disabled || i === lines.length - 1} onClick={() => move(i, 1)} aria-label={`Move line ${n} down`}><ArrowDown /></Button>
                <Button variant="ghost" size="icon" disabled={disabled} onClick={() => remove(i)} aria-label={`Remove line ${n}`}><Trash2 /></Button>
              </div>
            </li>
          );
        })}
      </ol>

      {!disabled ? (
        <div><Button variant="secondary" size="lg" onClick={() => onChange([...lines, newEditorLine()])}><Plus /> Add line</Button></div>
      ) : null}

      <dl className="ml-auto flex w-full max-w-xs flex-col gap-1 text-sm" aria-live="polite">
        {Number(totals.discountTotal) > 0 ? (
          <div className="flex justify-between text-muted-foreground"><dt>Discount included</dt><dd className="tabular-nums">−{fm(totals.discountTotal)}</dd></div>
        ) : null}
        <div className="flex justify-between"><dt>{vatRegistered ? `Subtotal (excl. ${taxLabel})` : "Subtotal"}</dt><dd className="tabular-nums">{fm(totals.subtotal)}</dd></div>
        {vatRegistered ? <div className="flex justify-between"><dt>{taxLabel} @ {taxRate}%</dt><dd className="tabular-nums">{fm(totals.taxTotal)}</dd></div> : null}
        <div className="flex justify-between border-t border-border pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{fm(totals.total)}</dd></div>
        {totals.invalidCount > 0 ? <p className="text-xs text-danger">{totals.invalidCount} line(s) left out until the numbers are valid.</p> : null}
        <p className="text-xs text-muted-foreground">Preview — final amounts are calculated when you save.</p>
      </dl>
    </div>
  );
}
