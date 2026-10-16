"use client";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/common/form-field";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import {
  createInvoiceDraftAction, createInvoiceFromJobAction, createInvoiceFromQuoteAction, listInvoiceSourcesAction,
} from "@/app/app/money/invoices/actions";

type Mode = "customer" | "job" | "quote";
type Sources = Awaited<ReturnType<typeof listInvoiceSourcesAction>>;

export function NewInvoiceButton({ customers, initiallyOpen }: { customers: { id: string; display_name: string }[]; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const router = useRouter();
  const pathname = usePathname();
  const close = (o: boolean) => {
    setOpen(o);
    if (!o && initiallyOpen) router.replace(pathname);
  };
  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)}><Plus /> New invoice</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent title="New invoice" description="Start from a finished job or an accepted quote so nothing is typed twice — or start blank.">
          {open ? <NewInvoiceForm customers={customers} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewInvoiceForm({ customers }: { customers: { id: string; display_name: string }[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("job");
  const [sources, setSources] = useState<Sources | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [jobId, setJobId] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    listInvoiceSourcesAction().then((r) => {
      if (!live) return;
      setSources(r);
      if (r.ok && r.data.jobs.length === 0) setMode(r.data.quotes.length ? "quote" : "customer");
    });
    return () => { live = false; };
  }, []);

  const go = () => start(async () => {
    const r = mode === "customer" ? await createInvoiceDraftAction({ customerId }).then((x) => (x.ok ? { ok: true as const, data: { invoiceId: x.data.id, created: true } } : x))
      : mode === "job" ? await createInvoiceFromJobAction(jobId)
      : await createInvoiceFromQuoteAction(quoteId);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.data.created ? "Draft invoice created" : "This already has an invoice — opening it");
    router.push(`/app/money/invoices/${r.data.invoiceId}`);
  });

  const jobs = sources?.ok ? sources.data.jobs : [];
  const quotes = sources?.ok ? sources.data.quotes : [];
  const ready = mode === "customer" ? !!customerId : mode === "job" ? !!jobId : !!quoteId;
  const tabs: { key: Mode; label: string; count?: number }[] = [
    { key: "job", label: "Completed job", count: jobs.length },
    { key: "quote", label: "Accepted quote", count: quotes.length },
    { key: "customer", label: "Blank" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Start from" className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="radio" aria-checked={mode === t.key} onClick={() => setMode(t.key)}
            className={cn("h-10 rounded px-2 text-sm", mode === t.key ? "bg-surface font-medium shadow-sm" : "text-muted-foreground")}>
            {t.label}{t.count !== undefined && sources ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>
      {!sources ? <p className="text-sm text-muted-foreground">Loading…</p> : !sources.ok ? <p role="alert" className="text-sm text-danger">{sources.error}</p> : null}

      {mode === "job" && sources?.ok ? (
        jobs.length === 0 ? <p className="text-sm text-muted-foreground">No completed jobs waiting to be invoiced.</p> : (
          <FormField id="ni-job" label="Job" required>
            {(p) => (
              <Select {...p} value={jobId} onChange={(e) => setJobId(e.target.value)} className="h-10">
                <option value="">Choose a completed job…</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.customer_name} · {j.title}</option>)}
              </Select>
            )}
          </FormField>
        )
      ) : null}
      {mode === "quote" && sources?.ok ? (
        quotes.length === 0 ? <p className="text-sm text-muted-foreground">No accepted quotes waiting to be invoiced.</p> : (
          <FormField id="ni-quote" label="Quote" required>
            {(p) => (
              <Select {...p} value={quoteId} onChange={(e) => setQuoteId(e.target.value)} className="h-10">
                <option value="">Choose an accepted quote…</option>
                {quotes.map((q) => <option key={q.id} value={q.id}>{q.quote_number} · {q.customer_name} · {formatMoney(q.total, q.currency)}</option>)}
              </Select>
            )}
          </FormField>
        )
      ) : null}
      {mode === "customer" ? (
        <FormField id="ni-customer" label="Customer" required hint="You'll add the lines on the next screen.">
          {(p) => (
            <Select {...p} value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="h-10">
              <option value="">Choose a customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </Select>
          )}
        </FormField>
      ) : null}
      <div className="flex justify-end">
        <Button size="lg" disabled={!ready || pending} onClick={go}>{pending ? "Creating…" : "Create draft invoice"}</Button>
      </div>
    </div>
  );
}
