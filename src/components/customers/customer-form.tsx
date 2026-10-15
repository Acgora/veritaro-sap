"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { CHANNEL_LABELS, CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS, PREFERRED_CHANNELS } from "@/domain/customers/schema";
import type { Customer, DuplicateMatch } from "@/domain/customers/service";
import { checkDuplicatesAction, createCustomerAction, updateCustomerAction } from "@/app/app/sales/customers/actions";

type Errors = Record<string, string[] | undefined>;

export function CustomerForm({ customer, onDone }: { customer?: Customer; onDone: (id?: string) => void }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<DuplicateMatch[]>([]);
  const [confirmedDifferent, setConfirmedDifferent] = useState(false);
  const isEdit = !!customer;

  const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");

  const checkDuplicates = async () => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    const r = await checkDuplicatesAction({
      name: s(fd, "displayName"), email: s(fd, "email"), phone: s(fd, "phone"), vat: s(fd, "vatNumber"), excludeId: customer?.id,
    });
    if (r.ok) {
      setDupes(r.data);
      setConfirmedDifferent(false);
    }
  };

  const submit = (fd: FormData) => {
    if (!isEdit && dupes.length > 0 && !confirmedDifferent) {
      setFormError("This looks like an existing customer. Open the match, or tick “This is a different customer”.");
      return;
    }
    const fields = {
      type: s(fd, "type") as (typeof CUSTOMER_TYPES)[number],
      displayName: s(fd, "displayName"),
      legalName: s(fd, "legalName"),
      registrationNumber: s(fd, "registrationNumber"),
      vatNumber: s(fd, "vatNumber"),
      email: s(fd, "email"),
      phone: s(fd, "phone"),
      website: s(fd, "website"),
      paymentTermsDays: s(fd, "paymentTermsDays") || "30",
      preferredChannel: s(fd, "preferredChannel") as "" | (typeof PREFERRED_CHANNELS)[number],
      notes: s(fd, "notes"),
    };
    start(async () => {
      const r = isEdit
        ? await updateCustomerAction(customer.id, fields)
        : await createCustomerAction({
            ...fields,
            contact: s(fd, "contactFirstName")
              ? { firstName: s(fd, "contactFirstName"), lastName: s(fd, "contactLastName"), phone: s(fd, "contactPhone"), email: s(fd, "contactEmail") }
              : null,
            address: s(fd, "line1")
              ? { kind: "site", line1: s(fd, "line1"), suburb: s(fd, "suburb"), city: s(fd, "city"), postalCode: s(fd, "postalCode") }
              : null,
          });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.error);
        return;
      }
      toast.success(isEdit ? "Customer saved" : "Customer added");
      onDone(r.data.id);
      if (!isEdit) router.push(`/app/sales/customers/${r.data.id}`);
    });
  };

  return (
    <form ref={formRef} onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <FormField id="displayName" label="Name" required error={errors.displayName?.[0]}>
            {(p) => <Input {...p} name="displayName" defaultValue={customer?.display_name} onBlur={checkDuplicates} autoFocus={!isEdit} placeholder="e.g. ABC Construction" />}
          </FormField>
        </div>
        <FormField id="type" label="Type" required>
          {(p) => (
            <Select {...p} name="type" defaultValue={customer?.type ?? "business"}>
              {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{CUSTOMER_TYPE_LABELS[t]}</option>)}
            </Select>
          )}
        </FormField>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="phone" label="Phone" error={errors.phone?.[0]}>
          {(p) => <Input {...p} name="phone" type="tel" defaultValue={customer?.phone ?? ""} onBlur={checkDuplicates} />}
        </FormField>
        <FormField id="email" label="Email" error={errors.email?.[0]}>
          {(p) => <Input {...p} name="email" type="email" defaultValue={customer?.email ?? ""} onBlur={checkDuplicates} />}
        </FormField>
      </div>

      {dupes.length > 0 ? (
        <div role="status" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 text-warning" aria-hidden /> Possible existing customer</p>
          <ul className="mt-2 flex flex-col gap-1">
            {dupes.map((d) => (
              <li key={d.id}>
                <Link href={`/app/sales/customers/${d.id}`} className="text-primary underline-offset-4 hover:underline">{d.display_name}</Link>
                <span className="text-muted-foreground"> — {d.reason}{d.status === "archived" ? " (archived)" : ""}</span>
              </li>
            ))}
          </ul>
          {!isEdit ? (
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={confirmedDifferent} onChange={(e) => setConfirmedDifferent(e.target.checked)} />
              This is a different customer
            </label>
          ) : null}
        </div>
      ) : null}

      {!isEdit ? (
        <details className="rounded-md border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Contact person and site address</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField id="contactFirstName" label="Contact first name">{(p) => <Input {...p} name="contactFirstName" />}</FormField>
            <FormField id="contactLastName" label="Contact last name">{(p) => <Input {...p} name="contactLastName" />}</FormField>
            <FormField id="contactPhone" label="Contact phone">{(p) => <Input {...p} name="contactPhone" type="tel" />}</FormField>
            <FormField id="contactEmail" label="Contact email">{(p) => <Input {...p} name="contactEmail" type="email" />}</FormField>
            <div className="sm:col-span-2">
              <FormField id="line1" label="Site street address">{(p) => <Input {...p} name="line1" placeholder="e.g. 12 Dorp Street" />}</FormField>
            </div>
            <FormField id="suburb" label="Suburb">{(p) => <Input {...p} name="suburb" />}</FormField>
            <FormField id="city" label="City / town">{(p) => <Input {...p} name="city" />}</FormField>
            <FormField id="postalCode" label="Postal code">{(p) => <Input {...p} name="postalCode" />}</FormField>
          </div>
        </details>
      ) : null}

      <details className="rounded-md border border-border p-3 text-sm" open={isEdit}>
        <summary className="cursor-pointer font-medium">Business details</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField id="legalName" label="Registered (legal) name" error={errors.legalName?.[0]}>{(p) => <Input {...p} name="legalName" defaultValue={customer?.legal_name ?? ""} />}</FormField>
          <FormField id="registrationNumber" label="Registration number" error={errors.registrationNumber?.[0]}>{(p) => <Input {...p} name="registrationNumber" defaultValue={customer?.registration_number ?? ""} />}</FormField>
          <FormField id="vatNumber" label="VAT number" error={errors.vatNumber?.[0]}>{(p) => <Input {...p} name="vatNumber" defaultValue={customer?.vat_number ?? ""} onBlur={checkDuplicates} />}</FormField>
          <FormField id="website" label="Website" error={errors.website?.[0]}>{(p) => <Input {...p} name="website" type="url" defaultValue={customer?.website ?? ""} />}</FormField>
          <FormField id="paymentTermsDays" label="Payment terms (days)" error={errors.paymentTermsDays?.[0]}>{(p) => <Input {...p} name="paymentTermsDays" type="number" min={0} max={365} defaultValue={customer?.payment_terms_days ?? 30} />}</FormField>
          <FormField id="preferredChannel" label="Preferred channel">
            {(p) => (
              <Select {...p} name="preferredChannel" defaultValue={customer?.preferred_channel ?? ""}>
                <option value="">No preference</option>
                {PREFERRED_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
              </Select>
            )}
          </FormField>
          <div className="sm:col-span-2">
            <FormField id="notes" label="Notes" error={errors.notes?.[0]}>{(p) => <Textarea {...p} name="notes" defaultValue={customer?.notes ?? ""} maxLength={5000} />}</FormField>
          </div>
        </div>
      </details>

      {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onDone()} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : isEdit ? "Save changes" : "Add customer"}</Button>
      </div>
    </form>
  );
}
