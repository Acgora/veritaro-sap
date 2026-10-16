import type { Metadata } from "next";
import { z } from "zod";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { getFieldJob, getJob, getPhotoUrls, listAssignableMembers } from "@/domain/jobs/service";
import { listActivityForEntity } from "@/domain/activity/service";
import { ErrorState } from "@/components/common/empty-state";
import { JobsGate } from "@/components/jobs/jobs-gate";
import { JOB_TABS, JobDetailView, type JobTab } from "@/components/jobs/job-detail";
import { FieldJobView } from "@/components/jobs/field-job-view";

export const metadata: Metadata = { title: "Job" };

export default async function JobPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; created?: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const tab: JobTab = (JOB_TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as JobTab) : "overview";

  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const tz = app.organisation.timezone;
  const p = ctx.permissions;

  // Field agents (no jobs.read_all): mobile view built only from get_field_job.
  if (!p.can("jobs.read_all")) {
    const detail = await getFieldJob(ctx, id);
    if (!detail.ok) return <JobsGate><ErrorState message={detail.error} /></JobsGate>;
    const urls = await getPhotoUrls(ctx, detail.data.photos.map((ph) => ph.storage_path));
    return (
      <JobsGate>
        <FieldJobView detail={detail.data} photoUrls={urls.ok ? urls.data : {}} organisationId={app.organisation.id} timeZone={tz}
          can={{ work: p.can("jobs.work"), write: p.can("jobs.write") }} />
      </JobsGate>
    );
  }

  const [detail, activity, members] = await Promise.all([
    getJob(ctx, id),
    tab === "activity" ? listActivityForEntity(ctx, "job", id) : Promise.resolve(null),
    p.can("jobs.write") ? listAssignableMembers(ctx) : Promise.resolve(null),
  ]);
  if (!detail.ok) return <JobsGate><ErrorState message={detail.error} /></JobsGate>;
  const urls = tab === "photos" ? await getPhotoUrls(ctx, detail.data.photos.map((ph) => ph.storage_path)) : null;

  return (
    <JobsGate>
      <JobDetailView
        detail={detail.data}
        tab={tab}
        activity={activity?.ok ? activity.data : []}
        members={members?.ok ? members.data : []}
        photoUrls={urls?.ok ? urls.data : {}}
        organisationId={app.organisation.id}
        timeZone={tz}
        justCreated={sp.created === "1"}
        can={{
          write: p.can("jobs.write"),
          work: p.can("jobs.work"),
          createTask: p.can("tasks.create"),
          readActivity: p.can("activity.read"),
          invoiceWrite: p.can("invoices.write"),
          readCustomers: p.can("customers.read"),
          readQuotes: p.can("quotes.read"),
          readInvoices: p.can("invoices.read"),
        }}
      />
    </JobsGate>
  );
}
