import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { getServiceContext } from "@/lib/service-context";
import { listCustomerOptions } from "@/domain/customers/service";
import { getLeadForQuote } from "@/domain/quotes/service";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/empty-state";
import { ModuleGate } from "@/components/common/module-gate";
import { Button } from "@/components/ui/button";
import { QuoteNewForm } from "@/components/quotes/quote-new-form";

export const metadata: Metadata = { title: "New quote" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const uuid = (v: string | string[] | undefined) => (typeof v === "string" && z.uuid().safeParse(v).success ? v : null);

export default async function NewQuotePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await getServiceContext();
  const customerParam = uuid(sp.customer);
  const leadParam = uuid(sp.lead);

  const [customers, lead] = await Promise.all([
    listCustomerOptions(ctx, 500),
    leadParam ? getLeadForQuote(ctx, leadParam) : Promise.resolve(null),
  ]);

  let body: React.ReactNode;
  if (!customers.ok) body = <ErrorState message={customers.error} />;
  else if (lead && !lead.ok) body = <ErrorState message={lead.error} />;
  else if (lead?.ok && !lead.data.customerId) {
    body = (
      <div role="status" className="flex flex-col items-start gap-3 rounded-lg border border-border bg-warning-soft p-4 text-sm">
        <p className="font-medium">Convert this lead to a customer first</p>
        <p>“{lead.data.title}” isn&apos;t linked to a customer yet. A quote needs a customer so their details flow onto the job and invoice. Convert the lead, then create the quote from it.</p>
        <Button asChild><Link href={`/app/sales/leads/${lead.data.id}`}>Open lead to convert</Link></Button>
      </div>
    );
  } else {
    const l = lead?.ok ? lead.data : null;
    body = (
      <QuoteNewForm
        customers={customers.data}
        leadId={l?.id ?? null}
        initialTitle={l?.title ?? ""}
        initial={{ customerId: l?.customerId ?? customerParam ?? "", contactId: l?.contactId ?? "", siteAddressId: l?.siteAddressId ?? "" }}
      />
    );
  }

  return (
    <ModuleGate permission="quotes.write">
      <PageHeader title="New quote" description="Pick the customer. You'll add lines on the next screen." />
      <div className="max-w-3xl">{body}</div>
    </ModuleGate>
  );
}
