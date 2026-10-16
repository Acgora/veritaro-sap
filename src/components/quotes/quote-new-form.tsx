"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { PartyPicker, type PartyValue } from "@/components/commercial/party-picker";
import { createQuoteAction } from "@/app/app/sales/quotes/actions";

export function QuoteNewForm({ customers, initial, leadId, initialTitle }: {
  customers: { id: string; display_name: string }[];
  initial: PartyValue;
  leadId: string | null;
  initialTitle: string;
}) {
  const router = useRouter();
  const [party, setParty] = useState<PartyValue>(initial);
  const [title, setTitle] = useState(initialTitle);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, start] = useTransition();

  const submit = () => start(async () => {
    const r = await createQuoteAction({
      customerId: party.customerId, contactId: party.contactId, siteAddressId: party.siteAddressId, leadId: leadId ?? undefined, title,
    });
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      toast.error(r.error);
      return;
    }
    toast.success(`Quote ${r.data.quoteNumber} created`);
    router.push(`/app/sales/quotes/${r.data.id}`);
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4" noValidate>
      <PartyPicker customers={customers} value={party} onChange={setParty} disabled={pending} error={errors.customerId?.[0]} />
      <FormField id="quote-title" label="What is this quote for?" hint="Shown at the top of the quote, e.g. “Office deep clean – March”" error={errors.title?.[0]}>
        {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-10" />}
      </FormField>
      <p className="text-xs text-muted-foreground">The quote date is today and the expiry date follows your settings. You can change both and add lines next.</p>
      <div><Button type="submit" size="lg" disabled={pending || !party.customerId}>{pending ? "Creating…" : "Create draft quote"}</Button></div>
    </form>
  );
}
