"use server";
import { revalidatePath } from "next/cache";
import { getServiceContext } from "@/lib/service-context";
import { recordPayment, voidPayment } from "@/domain/payments/service";
import { listUnpaidInvoicesForCustomer } from "@/domain/invoices/service";
import type { RecordPaymentInput } from "@/domain/payments/schema";

function refresh(invoiceId?: string | null) {
  revalidatePath("/app/money");
  revalidatePath("/app/money/payments");
  revalidatePath("/app/money/invoices");
  if (invoiceId) revalidatePath(`/app/money/invoices/${invoiceId}`);
  revalidatePath("/app/today");
}

export async function listUnpaidInvoicesAction(customerId?: string) {
  return listUnpaidInvoicesForCustomer(await getServiceContext(), customerId ?? null, 100);
}

export async function recordPaymentAction(input: RecordPaymentInput) {
  const r = await recordPayment(await getServiceContext(), input);
  if (r.ok) refresh(r.data.invoiceId);
  return r;
}

export async function voidPaymentAction(paymentId: string, reason: string) {
  const r = await voidPayment(await getServiceContext(), paymentId, reason);
  if (r.ok) refresh(r.data.invoiceId);
  return r;
}
