"use server";
import { revalidatePath } from "next/cache";
import { getServiceContext } from "@/lib/service-context";
import {
  addAddress, addContact, archiveCustomer, createCustomer, findDuplicates, removeAddress, removeContact, restoreCustomer, updateCustomer,
} from "@/domain/customers/service";
import type { AddressInput, ContactInput, CreateCustomerInput, UpdateCustomerInput } from "@/domain/customers/schema";

/** Thin adapters over the customer domain service. */
function refresh(id?: string) {
  revalidatePath("/app/sales/customers");
  if (id) revalidatePath(`/app/sales/customers/${id}`);
  revalidatePath("/app/today");
}

export async function checkDuplicatesAction(input: { name?: string; email?: string; phone?: string; vat?: string; excludeId?: string }) {
  return findDuplicates(await getServiceContext(), input);
}

export async function createCustomerAction(input: CreateCustomerInput) {
  const r = await createCustomer(await getServiceContext(), input);
  if (r.ok) refresh(r.data.id);
  return r;
}

export async function updateCustomerAction(id: string, input: UpdateCustomerInput) {
  const r = await updateCustomer(await getServiceContext(), id, input);
  if (r.ok) refresh(id);
  return r;
}

export async function archiveCustomerAction(id: string) {
  const r = await archiveCustomer(await getServiceContext(), id);
  if (r.ok) refresh(id);
  return r;
}

export async function restoreCustomerAction(id: string) {
  const r = await restoreCustomer(await getServiceContext(), id);
  if (r.ok) refresh(id);
  return r;
}

export async function addContactAction(customerId: string, input: ContactInput & { isPrimary?: boolean }) {
  const r = await addContact(await getServiceContext(), customerId, input);
  if (r.ok) refresh(customerId);
  return r;
}

export async function removeContactAction(customerId: string, contactId: string) {
  const r = await removeContact(await getServiceContext(), contactId);
  if (r.ok) refresh(customerId);
  return r;
}

export async function addAddressAction(customerId: string, input: AddressInput) {
  const r = await addAddress(await getServiceContext(), customerId, input);
  if (r.ok) refresh(customerId);
  return r;
}

export async function removeAddressAction(customerId: string, addressId: string) {
  const r = await removeAddress(await getServiceContext(), addressId);
  if (r.ok) refresh(customerId);
  return r;
}
