"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, createLeadSchema, type LeadSource } from "@/domain/leads/schema";
import type { Lead } from "@/domain/leads/service";
import { createLeadAction, updateLeadAction } from "@/app/app/sales/leads/actions";
import type { Assignee } from "./datetime";

type Errors = Record<string, string[] | undefined>;

/** Create or edit a lead. Only a person or company name is required. */
export function LeadForm({
  lead,
  assignees,
  currentUserId,
  onDone,
}: {
  lead?: Lead;
  assignees: Assignee[];
  currentUserId: string;
  onDone: (id?: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const isEdit = !!lead;
  const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");

  const submit = (fd: FormData) => {
    const input = {
      personName: s(fd, "personName"),
      companyName: s(fd, "companyName"),
      email: s(fd, "email"),
      phone: s(fd, "phone"),
      source: (s(fd, "source") || "manual") as LeadSource,
      serviceSummary: s(fd, "serviceSummary"),
      siteAddressText: s(fd, "siteAddressText"),
      requestedDate: s(fd, "requestedDate"),
      estimatedValue: s(fd, "estimatedValue"),
      assignedTo: s(fd, "assignedTo"),
      notes: s(fd, "notes"),
    };
    // Same schema as the server, for instant inline errors.
    const check = createLeadSchema.safeParse(input);
    if (!check.success) {
      setErrors(check.error.flatten().fieldErrors);
      setFormError("Please check the highlighted fields.");
      return;
    }
    setErrors({});
    setFormError(null);
    start(async () => {
      const r = isEdit ? await updateLeadAction(lead.id, input) : await createLeadAction(input);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.error);
        return;
      }
      toast.success(isEdit ? "Lead saved" : "Lead added");
      onDone(r.data.id);
      if (!isEdit) router.push(`/app/sales/leads/${r.data.id}`);
    });
  };

  const value = lead?.estimated_value;
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }} className="flex flex-col gap-4" noValidate>
      <p className="text-xs text-muted-foreground">Enter a person or a company name — everything else is optional.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="personName" label="Person" error={errors.personName?.[0]}>
          {(p) => <Input {...p} name="personName" className="h-10" defaultValue={lead?.person_name ?? ""} autoFocus={!isEdit} placeholder="e.g. Thandi Mokoena" maxLength={200} />}
        </FormField>
        <FormField id="companyName" label="Company" error={errors.companyName?.[0]}>
          {(p) => <Input {...p} name="companyName" className="h-10" defaultValue={lead?.company_name ?? ""} placeholder="e.g. Oak Street Body Corporate" maxLength={200} />}
        </FormField>
        <FormField id="leadPhone" label="Phone" error={errors.phone?.[0]}>
          {(p) => <Input {...p} name="phone" type="tel" className="h-10" defaultValue={lead?.phone ?? ""} maxLength={40} />}
        </FormField>
        <FormField id="leadEmail" label="Email" error={errors.email?.[0]}>
          {(p) => <Input {...p} name="email" type="email" className="h-10" defaultValue={lead?.email ?? ""} maxLength={320} />}
        </FormField>
        <FormField id="source" label="Where did it come from?" error={errors.source?.[0]}>
          {(p) => (
            <Select {...p} name="source" className="h-10" defaultValue={lead?.source ?? "manual"}>
              {LEAD_SOURCES.map((src) => <option key={src} value={src}>{LEAD_SOURCE_LABELS[src]}</option>)}
            </Select>
          )}
        </FormField>
        <FormField id="assignedTo" label="Assigned to" error={errors.assignedTo?.[0]}>
          {(p) => (
            <Select {...p} name="assignedTo" className="h-10" defaultValue={lead ? (lead.assigned_to ?? "") : currentUserId}>
              <option value="">Unassigned</option>
              {assignees.map((a) => <option key={a.userId} value={a.userId}>{a.displayName}</option>)}
            </Select>
          )}
        </FormField>
      </div>
      <FormField id="serviceSummary" label="What do they need?" error={errors.serviceSummary?.[0]}>
        {(p) => <Textarea {...p} name="serviceSummary" defaultValue={lead?.service_summary ?? ""} maxLength={1000} placeholder="e.g. Monthly office clean, 3 floors" />}
      </FormField>
      <details className="rounded-md border border-border p-3 text-sm" open={isEdit}>
        <summary className="cursor-pointer font-medium">Site, date, value and notes</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField id="siteAddressText" label="Site address" error={errors.siteAddressText?.[0]}>
              {(p) => <Input {...p} name="siteAddressText" className="h-10" defaultValue={lead?.site_address_text ?? ""} maxLength={500} placeholder="e.g. 12 Dorp Street, Stellenbosch" />}
            </FormField>
          </div>
          <FormField id="requestedDate" label="Requested date" error={errors.requestedDate?.[0]}>
            {(p) => <Input {...p} name="requestedDate" type="date" className="h-10" defaultValue={lead?.requested_date ?? ""} />}
          </FormField>
          <FormField id="estimatedValue" label="Estimated value" hint="Rough amount, excl. VAT" error={errors.estimatedValue?.[0]}>
            {(p) => (
              <Input {...p} name="estimatedValue" inputMode="decimal" className="h-10"
                defaultValue={value === null || value === undefined ? "" : value.toFixed(2)} placeholder="e.g. 4500" />
            )}
          </FormField>
          <div className="sm:col-span-2">
            <FormField id="leadNotes" label="Notes" error={errors.notes?.[0]}>
              {(p) => <Textarea {...p} name="notes" defaultValue={lead?.notes ?? ""} maxLength={5000} />}
            </FormField>
          </div>
        </div>
      </details>
      {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="lg" onClick={() => onDone()} disabled={pending}>Cancel</Button>
        <Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : isEdit ? "Save changes" : "Add lead"}</Button>
      </div>
    </form>
  );
}
