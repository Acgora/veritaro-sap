"use client";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { JOB_PRIORITIES, JOB_PRIORITY_LABELS, type JobPriority } from "@/domain/jobs/schema";
import type { Job } from "@/domain/jobs/service";
import { loadCustomerPartiesAction, updateJobAction } from "@/app/app/work/jobs/actions";

export function EditJobForm({ job, canPickParties, onDone }: { job: Job; canPickParties: boolean; onDone: () => void }) {
  const [title, setTitle] = useState(job.title);
  const [description, setDescription] = useState(job.description ?? "");
  const [priority, setPriority] = useState<JobPriority>(job.priority as JobPriority);
  const [internalNotes, setInternalNotes] = useState(job.internal_notes ?? "");
  const [contactId, setContactId] = useState(job.contact_id ?? "");
  const [siteId, setSiteId] = useState(job.site_address_id ?? "");
  const [parties, setParties] = useState<{ contacts: { id: string; name: string }[]; sites: { id: string; label: string }[] } | null>(null);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!canPickParties) return;
    let live = true;
    void loadCustomerPartiesAction(job.customer_id).then((r) => { if (live && r.ok) setParties(r.data); });
    return () => { live = false; };
  }, [canPickParties, job.customer_id]);

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateJobAction(job.id, {
            title, description, priority, internalNotes,
            ...(parties ? { contactId: contactId || null, siteAddressId: siteId || null } : {}),
          });
          if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast.error(r.error); return; }
          toast.success("Job saved");
          onDone();
        });
      }}
    >
      <FormField id="edit-title" label="Title" required error={errors.title?.[0]}>
        {(p) => <Input {...p} className="h-10" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}
      </FormField>
      <FormField id="edit-desc" label="Scope / description" error={errors.description?.[0]}>
        {(p) => <Textarea {...p} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} className="min-h-28" />}
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="edit-priority" label="Priority">
          {(p) => (
            <Select {...p} className="h-10" value={priority} onChange={(e) => setPriority(e.target.value as JobPriority)}>
              {JOB_PRIORITIES.map((k) => <option key={k} value={k}>{JOB_PRIORITY_LABELS[k]}</option>)}
            </Select>
          )}
        </FormField>
        {parties ? (
          <>
            <FormField id="edit-contact" label="Contact" error={errors.contactId?.[0]}>
              {(p) => (
                <Select {...p} className="h-10" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  <option value="">No contact</option>
                  {parties.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              )}
            </FormField>
            <div className="sm:col-span-2">
              <FormField id="edit-site" label="Site" error={errors.siteAddressId?.[0]}>
                {(p) => (
                  <Select {...p} className="h-10" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                    <option value="">No site</option>
                    {parties.sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </Select>
                )}
              </FormField>
            </div>
          </>
        ) : null}
      </div>
      <FormField id="edit-internal" label="Internal notes" hint="Not shown on the field (mobile) view" error={errors.internalNotes?.[0]}>
        {(p) => <Textarea {...p} value={internalNotes} maxLength={5000} onChange={(e) => setInternalNotes(e.target.value)} />}
      </FormField>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}
