"use server";
import { revalidatePath } from "next/cache";
import { getServiceContext } from "@/lib/service-context";
import {
  archiveLead, convertLead, createLead, createLeadTask, findLeads, restoreLead, scheduleFollowUp, setLeadStatus, updateLead,
  type CreateLeadTaskInput,
} from "@/domain/leads/service";
import { listCustomers } from "@/domain/customers/service";
import type { ConvertLeadInput, CreateLeadInput, SetLeadStatusInput, UpdateLeadInput } from "@/domain/leads/schema";

/** Thin adapters over the leads domain service. */
function refresh(id?: string) {
  revalidatePath("/app/sales/leads");
  if (id) revalidatePath(`/app/sales/leads/${id}`);
  revalidatePath("/app/today");
}

export async function createLeadAction(input: CreateLeadInput) {
  const r = await createLead(await getServiceContext(), input);
  if (r.ok) refresh(r.data.id);
  return r;
}

export async function updateLeadAction(id: string, input: UpdateLeadInput) {
  const r = await updateLead(await getServiceContext(), id, input);
  if (r.ok) refresh(id);
  return r;
}

export async function setLeadStatusAction(id: string, input: SetLeadStatusInput) {
  const r = await setLeadStatus(await getServiceContext(), id, input);
  if (r.ok) refresh(id);
  return r;
}

export async function scheduleFollowUpAction(id: string, at: string | null) {
  const r = await scheduleFollowUp(await getServiceContext(), id, at);
  if (r.ok) refresh(id);
  return r;
}

export async function archiveLeadAction(id: string) {
  const r = await archiveLead(await getServiceContext(), id);
  if (r.ok) refresh(id);
  return r;
}

export async function restoreLeadAction(id: string) {
  const r = await restoreLead(await getServiceContext(), id);
  if (r.ok) refresh(id);
  return r;
}

export async function convertLeadAction(id: string, input: ConvertLeadInput) {
  const r = await convertLead(await getServiceContext(), id, input);
  if (r.ok && r.data.outcome !== "duplicates") {
    refresh(id);
    revalidatePath("/app/sales/customers");
    revalidatePath(`/app/sales/customers/${r.data.customerId}`);
  }
  return r;
}

export async function createLeadTaskAction(id: string, input: CreateLeadTaskInput) {
  const r = await createLeadTask(await getServiceContext(), id, input);
  if (r.ok) {
    refresh(id);
    revalidatePath("/app/work/tasks");
  }
  return r;
}

export async function findLeadsAction(q: string) {
  return findLeads(await getServiceContext(), q);
}

/** Customer search for "link to an existing customer" in the convert dialog. */
export async function searchCustomersForLeadAction(q: string) {
  const r = await listCustomers(await getServiceContext(), { q, pageSize: 8 });
  if (!r.ok) return r;
  return { ok: true as const, data: r.data.customers.map((c) => ({ id: c.id, display_name: c.display_name, email: c.email, phone: c.phone })) };
}
