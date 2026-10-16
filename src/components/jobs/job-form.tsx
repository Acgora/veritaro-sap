"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { JOB_PRIORITIES, JOB_PRIORITY_LABELS, type JobPriority } from "@/domain/jobs/schema";
import type { ScheduleConflict } from "@/domain/jobs/service";
import { createJobAction, loadCustomerPartiesAction } from "@/app/app/work/jobs/actions";
import { MemberChecklist, type MemberOption } from "./assign-dialog";
import { ScheduleFields, scheduleDefaults, scheduleToIso } from "./schedule-dialog";
import { ConflictList } from "./conflict-list";

type Errors = Record<string, string[] | undefined>;

/** Manual job for an existing customer. Schedule and team are optional. */
export function NewJobForm({ customers, members, timeZone, presetDate, presetCustomerId, onDone }: {
  customers: { id: string; display_name: string }[];
  members: MemberOption[];
  timeZone: string;
  presetDate?: string;
  presetCustomerId?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(presetCustomerId && customers.some((c) => c.id === presetCustomerId) ? presetCustomerId : "");
  const [parties, setParties] = useState<{ contacts: { id: string; name: string; isPrimary: boolean }[]; sites: { id: string; label: string }[] } | null>(null);
  const [contactId, setContactId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<JobPriority>("normal");
  const [withSchedule, setWithSchedule] = useState(!!presetDate);
  const [schedule, setSchedule] = useState(() => scheduleDefaults(null, null, timeZone, presetDate));
  const [assignees, setAssignees] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [created, setCreated] = useState<{ id: string; jobNumber: string; conflicts: ScheduleConflict[] } | null>(null);
  const [pending, start] = useTransition();
  const [loadingParties, startParties] = useTransition();

  useEffect(() => {
    if (!customerId) { setParties(null); return; }
    let live = true;
    startParties(async () => {
      const r = await loadCustomerPartiesAction(customerId);
      if (!live) return;
      if (!r.ok) { toast.error(r.error); setParties({ contacts: [], sites: [] }); return; }
      setParties(r.data);
      setContactId(r.data.contacts.find((c) => c.isPrimary)?.id ?? r.data.contacts[0]?.id ?? "");
      setSiteId(r.data.sites[0]?.id ?? "");
    });
    return () => { live = false; };
  }, [customerId]);

  if (created) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">Job <span className="font-medium">{created.jobNumber}</span> was created.</p>
        <ConflictList conflicts={created.conflicts} timeZone={timeZone} />
        <p className="text-sm text-muted-foreground">Open the job to reschedule if this clash is a problem.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onDone}>Close</Button>
          <Button onClick={() => router.push(`/app/work/jobs/${created.id}`)}>Open job</Button>
        </div>
      </div>
    );
  }

  if (customers.length === 0) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p>Add a customer first — every job belongs to a customer.</p>
        <div className="flex justify-end"><Button asChild><Link href="/app/sales/customers?new=1">New customer</Link></Button></div>
      </div>
    );
  }

  const toggle = (id: string) => setAssignees((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const iso = withSchedule ? scheduleToIso(schedule, timeZone) : { start: null, end: null };
        if (withSchedule && (iso.error || !iso.start)) { setErrors({ scheduledStart: [iso.error ?? "Choose a date"] }); return; }
        start(async () => {
          const r = await createJobAction({
            customerId, contactId: contactId || null, siteAddressId: siteId || null, title, description, priority,
            scheduledStart: iso.start, scheduledEnd: iso.end, assigneeIds: assignees,
          });
          if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast.error(r.error); return; }
          toast.success(`Job ${r.data.jobNumber} created`);
          if (r.data.conflicts.length) { setCreated(r.data); return; }
          onDone();
          router.push(`/app/work/jobs/${r.data.id}`);
        });
      }}
    >
      <FormField id="job-customer" label="Customer" required error={errors.customerId?.[0]}>
        {(p) => (
          <Select {...p} className="h-10" value={customerId} onChange={(e) => setCustomerId(e.target.value)} autoFocus>
            <option value="">Choose a customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </Select>
        )}
      </FormField>
      {customerId ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField id="job-contact" label="Contact" error={errors.contactId?.[0]}>
            {(p) => (
              <Select {...p} className="h-10" value={contactId} disabled={loadingParties} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{loadingParties ? "Loading…" : parties?.contacts.length ? "No contact" : "No contacts on file"}</option>
                {parties?.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isPrimary ? " (primary)" : ""}</option>)}
              </Select>
            )}
          </FormField>
          <FormField id="job-site" label="Site" error={errors.siteAddressId?.[0]}>
            {(p) => (
              <Select {...p} className="h-10" value={siteId} disabled={loadingParties} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">{loadingParties ? "Loading…" : parties?.sites.length ? "No site" : "No addresses on file"}</option>
                {parties?.sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            )}
          </FormField>
        </div>
      ) : null}
      <FormField id="job-title" label="Title" required error={errors.title?.[0]}>
        {(p) => <Input {...p} className="h-10" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Deep clean — 3-bed house" />}
      </FormField>
      <FormField id="job-desc" label="What needs doing" error={errors.description?.[0]}>
        {(p) => <Textarea {...p} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />}
      </FormField>
      <FormField id="job-priority" label="Priority">
        {(p) => (
          <Select {...p} className="h-10 sm:w-48" value={priority} onChange={(e) => setPriority(e.target.value as JobPriority)}>
            {JOB_PRIORITIES.map((k) => <option key={k} value={k}>{JOB_PRIORITY_LABELS[k]}</option>)}
          </Select>
        )}
      </FormField>

      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={withSchedule} onChange={(e) => setWithSchedule(e.target.checked)} /> Schedule now
      </label>
      {withSchedule ? (
        <ScheduleFields idPrefix="newjob" value={schedule} onChange={setSchedule} timeZone={timeZone}
          error={errors.scheduledStart?.[0] ?? errors.scheduledEnd?.[0]} />
      ) : null}

      {members.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Team <span className="font-normal text-muted-foreground">(optional — first person ticked is the team lead)</span></p>
          <MemberChecklist members={members} selected={assignees} onToggle={toggle} />
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending || !customerId}>{pending ? "Creating…" : "Create job"}</Button>
      </div>
    </form>
  );
}
