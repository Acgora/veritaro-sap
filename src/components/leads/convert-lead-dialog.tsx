"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Link2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Lead, LeadDuplicateMatch } from "@/domain/leads/service";
import { leadDisplayName } from "@/domain/leads/rules";
import { convertLeadAction, searchCustomersForLeadAction } from "@/app/app/sales/leads/actions";

type Found = { id: string; display_name: string; email: string | null; phone: string | null };

/**
 * Create a customer from a lead — or link an existing one. Duplicate detection runs in the DB
 * (convert_lead_to_customer); when it finds likely matches nothing is created and the user chooses.
 */
export function ConvertLeadDialog({ lead, open, onOpenChange, canCreate }: {
  lead: Lead;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canCreate: boolean;
}) {
  const [pending, start] = useTransition();
  const [duplicates, setDuplicates] = useState<LeadDuplicateMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const name = leadDisplayName(lead);

  const reset = () => { setDuplicates(null); setError(null); setQ(""); setFound(null); };

  const convert = (input: { existingCustomerId?: string; allowDuplicate?: boolean }) =>
    start(async () => {
      setError(null);
      const r = await convertLeadAction(lead.id, input);
      if (!r.ok) { setError(r.error); return; }
      if (r.data.outcome === "duplicates") { setDuplicates(r.data.duplicates); return; }
      toast.success(r.data.outcome === "created" ? "Customer created from this lead" : "Lead linked to the customer");
      reset();
      onOpenChange(false);
    });

  const search = () =>
    start(async () => {
      if (q.trim().length < 2) { setFound([]); return; }
      const r = await searchCustomersForLeadAction(q);
      if (r.ok) setFound(r.data);
      else setError(r.error);
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pending) { if (!o) reset(); onOpenChange(o); } }}>
      <DialogContent title="Create customer" description={`Turn ${name} into a customer so you can quote, schedule and invoice. The lead is kept.`} className="max-w-xl">
        <div className="flex flex-col gap-4">
          {duplicates && duplicates.length > 0 ? (
            <div role="status" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 text-warning" aria-hidden /> This may already be a customer</p>
              <p className="mt-1 text-muted-foreground">Nothing has been created. Link the lead to the right customer, or create a new one anyway.</p>
              <ul className="mt-2 flex flex-col gap-2">
                {duplicates.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/app/sales/customers/${d.id}`} target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">{d.display_name}</Link>
                    <span className="text-xs text-muted-foreground">{d.reason}{d.status === "archived" ? " · archived" : ""}</span>
                    <span className="flex-1" />
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => convert({ existingCustomerId: d.id })}>
                      <Link2 /> Link to this customer
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">A new customer will be created with:</p>
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                <li>Name: {lead.company_name || lead.person_name || lead.title}</li>
                {lead.person_name ? <li>Contact person: {lead.person_name}</li> : null}
                {lead.phone || lead.email ? <li>{[lead.phone, lead.email].filter(Boolean).join(" · ")}</li> : null}
                {lead.site_address_text ? <li>Site: {lead.site_address_text}</li> : null}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="convert-search" className="text-sm font-medium">Or link an existing customer</label>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
                <Input id="convert-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers" className="h-10 pl-8" />
              </div>
              <Button type="submit" variant="secondary" className="h-10" disabled={pending}>Search</Button>
            </form>
            {found ? (
              found.length === 0 ? <p className="text-xs text-muted-foreground">No customers found.</p> : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {found.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{c.display_name}<span className="text-xs text-muted-foreground">{c.phone || c.email ? ` · ${[c.phone, c.email].filter(Boolean).join(" · ")}` : ""}</span></span>
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => convert({ existingCustomerId: c.id })}><Link2 /> Link</Button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>

          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="lg" onClick={() => { reset(); onOpenChange(false); }} disabled={pending}>Cancel</Button>
            {canCreate ? (
              duplicates && duplicates.length > 0 ? (
                <Button variant="outline" size="lg" disabled={pending} onClick={() => convert({ allowDuplicate: true })}>
                  <UserPlus /> {pending ? "Working…" : "Create a new customer anyway"}
                </Button>
              ) : (
                <Button size="lg" disabled={pending} onClick={() => convert({})}>
                  <UserPlus /> {pending ? "Checking…" : "Create customer"}
                </Button>
              )
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
