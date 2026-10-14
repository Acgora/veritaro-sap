"use client";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { updateOrganisationAction } from "@/app/app/settings/actions";
import type { Tables } from "@/types/database.types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function OrganisationForm({ organisation: o, canEdit }: { organisation: Tables<"organisations">; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [o.timezone];
    }
  }, [o.timezone]);

  const submit = (fd: FormData) => {
    const s = (k: string) => String(fd.get(k) ?? "");
    start(async () => {
      const r = await updateOrganisationAction({
        name: s("name"), legalName: s("legalName"), registrationNumber: s("registrationNumber"), taxNumber: s("taxNumber"),
        vatNumber: s("vatNumber"), email: s("email"), phone: s("phone"), website: s("website"), timezone: s("timezone"),
        financialYearEndMonth: s("financialYearEndMonth"),
      });
      if (r.ok) {
        setErrors({});
        toast.success("Organisation saved");
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }} className="flex flex-col gap-4" noValidate>
      {!canEdit ? <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">You can view these details. Only owners and admins can change them.</p> : null}
      <fieldset disabled={!canEdit || pending} className="flex flex-col gap-4">
        <legend className="sr-only">Organisation details</legend>
        <FormField id="name" label="Business name" required error={errors.name?.[0]}>{(p) => <Input {...p} name="name" defaultValue={o.name} />}</FormField>
        <FormField id="legalName" label="Registered (legal) name" error={errors.legalName?.[0]}>{(p) => <Input {...p} name="legalName" defaultValue={o.legal_name ?? ""} />}</FormField>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="registrationNumber" label="Registration no." error={errors.registrationNumber?.[0]}>{(p) => <Input {...p} name="registrationNumber" defaultValue={o.registration_number ?? ""} />}</FormField>
          <FormField id="taxNumber" label="Tax number" error={errors.taxNumber?.[0]}>{(p) => <Input {...p} name="taxNumber" defaultValue={o.tax_number ?? ""} />}</FormField>
          <FormField id="vatNumber" label="VAT number" error={errors.vatNumber?.[0]}>{(p) => <Input {...p} name="vatNumber" defaultValue={o.vat_number ?? ""} />}</FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="email" label="Email" error={errors.email?.[0]}>{(p) => <Input {...p} name="email" type="email" defaultValue={o.email ?? ""} />}</FormField>
          <FormField id="phone" label="Phone" error={errors.phone?.[0]}>{(p) => <Input {...p} name="phone" type="tel" defaultValue={o.phone ?? ""} />}</FormField>
        </div>
        <FormField id="website" label="Website" error={errors.website?.[0]}>{(p) => <Input {...p} name="website" type="url" defaultValue={o.website ?? ""} />}</FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="timezone" label="Timezone" required error={errors.timezone?.[0]}>
            {(p) => <Select {...p} name="timezone" defaultValue={o.timezone}>{zones.map((z) => <option key={z} value={z}>{z.replaceAll("_", " ")}</option>)}</Select>}
          </FormField>
          <FormField id="financialYearEndMonth" label="Financial year end" required error={errors.financialYearEndMonth?.[0]}>
            {(p) => <Select {...p} name="financialYearEndMonth" defaultValue={String(o.financial_year_end_month)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium">Country</p>
            <p className="mt-1 text-sm text-muted-foreground">{o.country}</p>
          </div>
          <div>
            <p className="text-sm font-medium">Base currency</p>
            <p className="mt-1 text-sm text-muted-foreground">{o.currency} · locked to protect future financial records</p>
          </div>
        </div>
      </fieldset>
      {canEdit ? <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button></div> : null}
    </form>
  );
}
