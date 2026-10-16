"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServiceContext } from "@/lib/service-context";
import { fail, ok, type ActionResult } from "@/lib/errors";
import { getCustomer } from "@/domain/customers/service";
import {
  addJobNote, addJobPhoto, assignMembers, checkScheduleConflicts, createInvoiceFromJob, createJob, createJobFromQuote,
  getPhotoUrls, listMyJobsToday, scheduleJob, setJobStatus, unassignMember, updateJob,
} from "@/domain/jobs/service";
import type {
  AssignMembersInput, CreateJobFromQuoteInput, CreateJobInput, JobAction, JobNoteInput, JobPhotoInput, ScheduleJobInput, UpdateJobInput,
} from "@/domain/jobs/schema";

/** Thin adapters over the jobs domain service. */
function refresh(id?: string) {
  revalidatePath("/app/work/jobs");
  revalidatePath("/app/work/calendar");
  if (id) revalidatePath(`/app/work/jobs/${id}`);
  revalidatePath("/app/today");
}

const uuid = z.uuid();

export async function createJobAction(input: CreateJobInput) {
  const r = await createJob(await getServiceContext(), input);
  if (r.ok) refresh(r.data.id);
  return r;
}

/** Confirmation page submit: create (or find) the job for an accepted quote, then open it. */
export async function createJobFromQuoteAction(input: CreateJobFromQuoteInput): Promise<ActionResult<never>> {
  const r = await createJobFromQuote(await getServiceContext(), input);
  if (!r.ok) return r;
  refresh(r.data.jobId);
  revalidatePath("/app/sales/quotes");
  redirect(`/app/work/jobs/${r.data.jobId}${r.data.created ? "?created=1" : ""}`);
}

export async function updateJobAction(id: string, input: UpdateJobInput) {
  const r = await updateJob(await getServiceContext(), id, input);
  if (r.ok) refresh(id);
  return r;
}

export async function scheduleJobAction(id: string, input: ScheduleJobInput) {
  const r = await scheduleJob(await getServiceContext(), id, input);
  if (r.ok && r.data.scheduled) refresh(id);
  return r;
}

export async function checkConflictsAction(input: { start: string; end?: string | null; userIds: string[]; excludeJobId?: string }) {
  return checkScheduleConflicts(await getServiceContext(), input);
}

export async function assignMembersAction(jobId: string, input: AssignMembersInput) {
  const r = await assignMembers(await getServiceContext(), jobId, input);
  if (r.ok) refresh(jobId);
  return r;
}

export async function unassignMemberAction(jobId: string, userId: string) {
  const r = await unassignMember(await getServiceContext(), jobId, userId);
  if (r.ok) refresh(jobId);
  return r;
}

export async function setJobStatusAction(id: string, action: JobAction, notes?: string | null) {
  const r = await setJobStatus(await getServiceContext(), id, action, notes);
  if (r.ok) refresh(id);
  return r;
}

export async function addJobNoteAction(jobId: string, input: JobNoteInput) {
  const r = await addJobNote(await getServiceContext(), jobId, input);
  if (r.ok) refresh(jobId);
  return r;
}

export async function addJobPhotoAction(jobId: string, input: JobPhotoInput) {
  const r = await addJobPhoto(await getServiceContext(), jobId, input);
  if (r.ok) refresh(jobId);
  return r;
}

export async function getPhotoUrlsAction(paths: string[]) {
  return getPhotoUrls(await getServiceContext(), paths);
}

/** Jobs the user can attach a photo to right now (today's + in progress). */
export async function listPhotoJobsAction() {
  return listMyJobsToday(await getServiceContext());
}

/** Completed job → draft invoice, then open it in Money. */
export async function createInvoiceFromJobAction(jobId: string): Promise<ActionResult<never>> {
  if (!uuid.safeParse(jobId).success) return fail("Invalid job");
  const r = await createInvoiceFromJob(await getServiceContext(), jobId);
  if (!r.ok) return r;
  refresh(jobId);
  revalidatePath("/app/money/invoices");
  redirect(`/app/money/invoices/${r.data.invoiceId}`);
}

/** Contacts + sites for the customer picked in the New job dialog (office users only). */
export async function loadCustomerPartiesAction(customerId: string): Promise<ActionResult<{
  contacts: { id: string; name: string; isPrimary: boolean }[];
  sites: { id: string; label: string }[];
}>> {
  if (!uuid.safeParse(customerId).success) return fail("Choose a customer");
  const r = await getCustomer(await getServiceContext(), customerId);
  if (!r.ok) return r;
  return ok({
    contacts: r.data.contacts.map((c) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(" "), isPrimary: c.is_primary })),
    // Sites first; a billing address can also be where the work happens (e.g. a household).
    sites: [...r.data.addresses]
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "site" ? -1 : 1))
      .map((a) => ({
        id: a.id,
        label: [a.label, [a.line1, a.suburb, a.city].filter(Boolean).join(", "), a.kind === "billing" ? "(billing)" : null].filter(Boolean).join(" · "),
      })),
  });
}
