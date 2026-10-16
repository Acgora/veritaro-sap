import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { redirect } from "next/navigation";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { getQuoteJobPreview } from "@/domain/jobs/service";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/empty-state";
import { EntityStatus } from "@/components/common/entity-status";
import { Button } from "@/components/ui/button";
import { JobsGate } from "@/components/jobs/jobs-gate";
import { FromQuoteForm } from "@/components/jobs/from-quote-form";

export const metadata: Metadata = { title: "New job from quote" };

export default async function NewJobFromQuotePage({ searchParams }: { searchParams: Promise<{ quote?: string }> }) {
  const { quote } = await searchParams;
  // Without a quote this route is just the manual "New job" dialog.
  if (!quote) redirect("/app/work/jobs?new=1");
  const app = await requireAppContext();
  const ctx = await getServiceContext();

  if (!z.uuid().safeParse(quote).success) {
    return <JobsGate write><ErrorState message="That quote link isn't valid." /></JobsGate>;
  }
  const preview = await getQuoteJobPreview(ctx, quote);

  return (
    <JobsGate write>
      <PageHeader title="Create job from quote" description="Accepted work becomes a job you can schedule, assign and complete." />
      {!preview.ok ? (
        <ErrorState message={preview.error} />
      ) : preview.data.existingJob ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            title={`This quote already has job ${preview.data.existingJob.job_number}`}
            description="Each accepted quote becomes one job."
            action={<Button asChild><Link href={`/app/work/jobs/${preview.data.existingJob.id}`}>Open job</Link></Button>}
          />
        </div>
      ) : preview.data.quote.status !== "accepted" ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            title="Only an accepted quote can become a job"
            description={`${preview.data.quote.quote_number} isn't accepted yet. Mark it accepted first.`}
            action={<Button asChild variant="secondary"><Link href={`/app/sales/quotes/${preview.data.quote.id}`}>Open quote</Link></Button>}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <section aria-label="Quote summary" className="rounded-lg border border-border bg-surface p-4 text-sm lg:col-span-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-medium">{preview.data.quote.quote_number}</span>
              <EntityStatus entity="quote" status={preview.data.quote.status} />
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Customer</dt><dd>{preview.data.customerName ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Contact</dt><dd>{preview.data.contactName ?? "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Site</dt><dd>{preview.data.siteAddress ?? "No site on the quote"}</dd></div>
            </dl>
            <h2 className="mb-1 mt-4 text-sm font-semibold">Scope (copied to the job)</h2>
            {preview.data.scope.length ? (
              <ul className="list-disc pl-5">
                {preview.data.scope.map((s, i) => (
                  <li key={i}>{s.description}{s.quantity !== 1 ? ` × ${s.quantity}${s.unit ? ` ${s.unit}` : ""}` : ""}</li>
                ))}
              </ul>
            ) : <p className="text-muted-foreground">No lines on this quote.</p>}
            {preview.data.quote.notes ? <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{preview.data.quote.notes}</p> : null}
            <p className="mt-3 text-xs text-muted-foreground">Prices stay on the quote and invoice — field staff never see them.</p>
          </section>
          <section aria-label="Create job" className="rounded-lg border border-border bg-surface p-4 lg:col-span-2">
            <FromQuoteForm
              quoteId={preview.data.quote.id}
              defaultTitle={preview.data.quote.title || `Job for ${preview.data.quote.quote_number}`}
              timeZone={app.organisation.timezone}
            />
          </section>
        </div>
      )}
    </JobsGate>
  );
}
