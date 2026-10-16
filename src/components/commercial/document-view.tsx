import { formatMoney } from "@/lib/money";
import { formatDocDate } from "@/domain/commercial/dates";
import type { PdfLine } from "@/lib/pdf/document-data";

/** Read-only on-screen rendering of an issued quote/invoice (values straight from the DB). */
export function DocumentView({
  currency, lines, totals, tax, parties, dates, title, notes, terms, payment,
}: {
  currency: string;
  lines: PdfLine[];
  totals: { subtotal: string; discountTotal: string; taxTotal: string; total: string };
  tax: { label: string; registered: boolean; rate: string; pricesInclude: boolean };
  parties: { customer: string; contact?: string | null; address?: string | null; site?: string | null };
  dates: { label: string; value: string | null }[];
  title?: string | null;
  notes?: string | null;
  terms?: string | null;
  payment?: { amountPaid: string; amountDue: string } | null;
}) {
  const fm = (v: string) => formatMoney(v, currency);
  const showDiscount = lines.some((l) => l.discount);
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Customer</p>
          <p className="font-medium">{parties.customer}</p>
          {parties.contact ? <p>Attn: {parties.contact}</p> : null}
          {parties.address ? <p className="whitespace-pre-line text-muted-foreground">{parties.address}</p> : null}
          {parties.site && parties.site !== parties.address ? <p className="mt-1 whitespace-pre-line text-muted-foreground"><span className="text-foreground">Site: </span>{parties.site}</p> : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:justify-self-end">
          {dates.map((d) => (
            <div key={d.label} className="contents"><dt className="text-muted-foreground">{d.label}</dt><dd className="text-right font-medium">{formatDocDate(d.value)}</dd></div>
          ))}
        </dl>
      </div>
      {title ? <p className="font-medium">{title}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 font-medium">Description</th>
              <th scope="col" className="py-2 text-right font-medium">Qty</th>
              <th scope="col" className="py-2 text-right font-medium">Price</th>
              {showDiscount ? <th scope="col" className="py-2 text-right font-medium">Discount</th> : null}
              {tax.registered ? <th scope="col" className="py-2 text-right font-medium">{tax.label}</th> : null}
              <th scope="col" className="py-2 text-right font-medium">{tax.registered ? (tax.pricesInclude ? `Amount (incl. ${tax.label})` : `Amount (excl. ${tax.label})`) : "Amount"}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-border align-top">
                <td className="py-2 pr-2">{l.description}</td>
                <td className="py-2 text-right tabular-nums">{l.quantity}{l.unit ? ` ${l.unit}` : ""}</td>
                <td className="py-2 text-right tabular-nums">{fm(l.unitPrice)}</td>
                {showDiscount ? <td className="py-2 text-right tabular-nums">{l.discount ? (l.discount.type === "percent" ? `${l.discount.value}%` : fm(l.discount.amount)) : ""}</td> : null}
                {tax.registered ? <td className="py-2 text-right">{l.taxable ? `${tax.rate}%` : "0%"}</td> : null}
                <td className="py-2 text-right tabular-nums">{fm(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto flex w-full max-w-xs flex-col gap-1 text-sm">
        {Number(totals.discountTotal) > 0 ? <div className="flex justify-between text-muted-foreground"><dt>Discount included</dt><dd className="tabular-nums">−{fm(totals.discountTotal)}</dd></div> : null}
        <div className="flex justify-between"><dt>{tax.registered ? `Subtotal (excl. ${tax.label})` : "Subtotal"}</dt><dd className="tabular-nums">{fm(totals.subtotal)}</dd></div>
        {tax.registered ? <div className="flex justify-between"><dt>{tax.label} @ {tax.rate}%</dt><dd className="tabular-nums">{fm(totals.taxTotal)}</dd></div> : null}
        <div className="flex justify-between border-t border-border pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{fm(totals.total)}</dd></div>
        {payment ? (
          <>
            <div className="flex justify-between text-muted-foreground"><dt>Paid</dt><dd className="tabular-nums">{fm(payment.amountPaid)}</dd></div>
            <div className="flex justify-between rounded-md bg-muted px-2 py-1 font-semibold"><dt>Amount due</dt><dd className="tabular-nums">{fm(payment.amountDue)}</dd></div>
          </>
        ) : null}
      </dl>

      {notes ? <div className="text-sm"><p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p><p className="whitespace-pre-line">{notes}</p></div> : null}
      {terms ? <div className="text-sm"><p className="text-xs uppercase tracking-wide text-muted-foreground">Terms</p><p className="whitespace-pre-line text-muted-foreground">{terms}</p></div> : null}
    </div>
  );
}
