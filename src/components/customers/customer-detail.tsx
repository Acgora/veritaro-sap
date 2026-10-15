"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Archive, Mail, MessageCircle, Pencil, Phone, Plus, RotateCcw, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { FormField } from "@/components/common/form-field";
import { StatusBadge } from "@/components/common/status-badge";
import { ActivityFeed } from "@/components/today/activity-feed";
import { CHANNEL_LABELS, CUSTOMER_TYPE_LABELS } from "@/domain/customers/schema";
import type { CustomerDetail as Detail } from "@/domain/customers/service";
import type { ActivityItem } from "@/domain/activity/service";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/domain/tasks/schema";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  addAddressAction, addContactAction, archiveCustomerAction, removeAddressAction, removeContactAction, restoreCustomerAction,
} from "@/app/app/sales/customers/actions";
import { CustomerForm } from "./customer-form";
import { whatsappHref } from "./customers-list";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "contacts", label: "Contacts" },
  { key: "sites", label: "Sites" },
  { key: "tasks", label: "Tasks" },
  { key: "activity", label: "Activity" },
] as const;

interface TaskRow { id: string; title: string; status: string; priority: string; due_at: string | null }

export function CustomerDetailView(props: {
  detail: Detail;
  tasks: TaskRow[];
  activity: ActivityItem[];
  tab: string;
  timeZone: string;
  can: { update: boolean; archive: boolean; createTask: boolean; readActivity: boolean };
}) {
  const { detail, tasks, activity, tab, timeZone, can } = props;
  const c = detail.customer;
  const [editing, setEditing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [pending, start] = useTransition();
  const primary = detail.contacts.find((p) => p.is_primary);
  const phone = c.phone ?? primary?.phone ?? null;
  const email = c.email ?? primary?.email ?? null;
  const wa = whatsappHref(phone);
  const archived = c.status === "archived";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(msg);
      else toast.error((r as { error: string }).error);
    });

  return (
    <div>
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground"><Link href="/app/sales/customers" className="hover:underline">Customers</Link></p>
          <h1 className="text-xl font-semibold tracking-tight">{c.display_name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {CUSTOMER_TYPE_LABELS[c.type as keyof typeof CUSTOMER_TYPE_LABELS] ?? c.type}
            {primary ? <span>· {[primary.first_name, primary.last_name].filter(Boolean).join(" ")}</span> : null}
            {archived ? <StatusBadge>Archived</StatusBadge> : null}
            {c.source === "ai" ? <StatusBadge tone="info">Added by AI</StatusBadge> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {phone ? <Button asChild variant="secondary" size="sm"><a href={`tel:${phone}`}><Phone /> Call</a></Button> : null}
          {wa ? <Button asChild variant="secondary" size="sm"><a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle /> WhatsApp</a></Button> : null}
          {email ? <Button asChild variant="secondary" size="sm"><a href={`mailto:${email}`}><Mail /> Email</a></Button> : null}
          {can.update && !archived ? <Button variant="secondary" size="sm" onClick={() => setEditing(true)}><Pencil /> Edit</Button> : null}
          {can.archive && !archived ? (
            <ConfirmationDialog
              title="Archive this customer?"
              description={`${c.display_name} will be hidden from lists and pickers. Their history is kept and you can restore them.`}
              confirmLabel="Archive"
              onConfirm={async () => {
                const r = await archiveCustomerAction(c.id);
                if (r.ok) toast.success("Customer archived");
                else toast.error(r.error);
                return r.ok;
              }}
              trigger={(open) => <Button variant="secondary" size="sm" onClick={open}><Archive /> Archive</Button>}
            />
          ) : null}
          {can.archive && archived ? (
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => restoreCustomerAction(c.id), "Customer restored")}><RotateCcw /> Restore</Button>
          ) : null}
        </div>
      </header>

      <nav aria-label="Customer sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`?tab=${t.key}`}
            scroll={false}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn("-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground", tab === t.key && "border-primary font-medium text-foreground")}
          >
            {t.label}
          </Link>
        ))}
        {["Quotes", "Jobs", "Invoices"].map((l) => (
          <span key={l} className="whitespace-nowrap px-3 py-2 text-sm text-muted-foreground/60" title="Coming in a later build phase">{l} · soon</span>
        ))}
      </nav>

      {tab === "overview" ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2">
          {[
            ["Phone", c.phone], ["Email", c.email], ["Legal name", c.legal_name], ["Registration number", c.registration_number],
            ["VAT number", c.vat_number], ["Website", c.website], ["Payment terms", `${c.payment_terms_days} days`],
            ["Preferred channel", c.preferred_channel ? CHANNEL_LABELS[c.preferred_channel as keyof typeof CHANNEL_LABELS] : null],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className={cn(!v && "text-muted-foreground")}>{v || "—"}</dd>
            </div>
          ))}
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Notes</dt>
            <dd className="whitespace-pre-wrap">{c.notes || <span className="text-muted-foreground">—</span>}</dd>
          </div>
        </dl>
      ) : null}

      {tab === "contacts" ? (
        <section aria-label="Contacts">
          {can.update && !archived ? <div className="mb-2 flex justify-end"><Button size="sm" onClick={() => setAddingContact(true)}><Plus /> Add contact</Button></div> : null}
          {detail.contacts.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface"><EmptyState compact title="No contacts yet" description="Add the people you deal with at this customer." /></div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {detail.contacts.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {[p.first_name, p.last_name].filter(Boolean).join(" ")}
                      {p.is_primary ? <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground"><Star className="size-3" aria-hidden /> Primary</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{[p.role, p.phone, p.email].filter(Boolean).join(" · ") || "No details"}</p>
                  </div>
                  {can.update && !archived ? (
                    <Button variant="ghost" size="icon" disabled={pending} aria-label={`Remove ${p.first_name}`}
                      onClick={() => run(() => removeContactAction(c.id, p.id), "Contact removed")}><Trash2 /></Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "sites" ? (
        <section aria-label="Sites and addresses">
          {can.update && !archived ? <div className="mb-2 flex justify-end"><Button size="sm" onClick={() => setAddingAddress(true)}><Plus /> Add address</Button></div> : null}
          {detail.addresses.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface"><EmptyState compact title="No addresses yet" description="Add the sites you service and the billing address." /></div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {detail.addresses.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {a.label || (a.kind === "billing" ? "Billing address" : "Site")}
                      {a.label ? <span className="text-xs font-normal text-muted-foreground"> · {a.kind === "billing" ? "Billing" : "Site"}</span> : null}
                      {a.is_default_billing ? <span className="text-xs font-normal text-muted-foreground"> (default)</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{[a.line1, a.line2, a.suburb, a.city, a.postal_code].filter(Boolean).join(", ")}</p>
                    {a.notes ? <p className="text-xs text-muted-foreground">Note: {a.notes}</p> : null}
                  </div>
                  {can.update && !archived ? (
                    <Button variant="ghost" size="icon" disabled={pending} aria-label="Remove address"
                      onClick={() => run(() => removeAddressAction(c.id, a.id), "Address removed")}><Trash2 /></Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "tasks" ? (
        <section aria-label="Tasks">
          {can.createTask && !archived ? (
            <div className="mb-2 flex justify-end"><Button asChild size="sm"><Link href={`/app/work/tasks?new=1&customer=${c.id}`}><Plus /> New task</Link></Button></div>
          ) : null}
          {tasks.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface"><EmptyState compact title="No tasks for this customer" /></div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  {t.due_at ? <span className="text-xs text-muted-foreground">{formatDateTime(t.due_at, timeZone)}</span> : null}
                  <StatusBadge tone={t.status === "completed" ? "success" : "info"}>{TASK_STATUS_LABELS[t.status as TaskStatus] ?? t.status}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "activity" ? (
        <section aria-label="Activity" className="rounded-lg border border-border bg-surface p-4">
          {can.readActivity ? <ActivityFeed items={activity} /> : <p className="text-sm text-muted-foreground">Activity history isn&apos;t available for your role.</p>}
        </section>
      ) : null}

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent title="Edit customer" className="max-w-xl">
          <CustomerForm customer={c} onDone={() => setEditing(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={addingContact} onOpenChange={setAddingContact}>
        <DialogContent title="Add contact">
          <ContactForm customerId={c.id} hasPrimary={!!primary} onDone={() => setAddingContact(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={addingAddress} onOpenChange={setAddingAddress}>
        <DialogContent title="Add address">
          <AddressForm customerId={c.id} onDone={() => setAddingAddress(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContactForm({ customerId, hasPrimary, onDone }: { customerId: string; hasPrimary: boolean; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
  return (
    <form noValidate className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const r = await addContactAction(customerId, {
          firstName: s(fd, "firstName"), lastName: s(fd, "lastName"), role: s(fd, "role"), phone: s(fd, "phone"), email: s(fd, "email"),
          whatsappOptIn: fd.get("whatsappOptIn") === "on", isPrimary: fd.get("isPrimary") === "on",
        });
        if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast.error(r.error); return; }
        toast.success("Contact added");
        onDone();
      });
    }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="firstName" label="First name" required error={errors.firstName?.[0]}>{(p) => <Input {...p} name="firstName" autoFocus />}</FormField>
        <FormField id="lastName" label="Last name">{(p) => <Input {...p} name="lastName" />}</FormField>
        <FormField id="role" label="Role">{(p) => <Input {...p} name="role" placeholder="e.g. Site manager" />}</FormField>
        <FormField id="cphone" label="Phone" error={errors.phone?.[0]}>{(p) => <Input {...p} name="phone" type="tel" />}</FormField>
        <div className="sm:col-span-2"><FormField id="cemail" label="Email" error={errors.email?.[0]}>{(p) => <Input {...p} name="email" type="email" />}</FormField></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="whatsappOptIn" /> Agreed to receive WhatsApp messages</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPrimary" defaultChecked={!hasPrimary} /> Primary contact</label>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add contact"}</Button>
      </div>
    </form>
  );
}

function AddressForm({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
  return (
    <form noValidate className="flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const r = await addAddressAction(customerId, {
          kind: s(fd, "kind") as "site" | "billing", label: s(fd, "label"), line1: s(fd, "line1"), line2: s(fd, "line2"),
          suburb: s(fd, "suburb"), city: s(fd, "city"), province: s(fd, "province"), postalCode: s(fd, "postalCode"), notes: s(fd, "notes"),
        });
        if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast.error(r.error); return; }
        toast.success("Address added");
        onDone();
      });
    }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="kind" label="Type" required>
          {(p) => <Select {...p} name="kind" defaultValue="site"><option value="site">Site (where you work)</option><option value="billing">Billing</option></Select>}
        </FormField>
        <FormField id="label" label="Label">{(p) => <Input {...p} name="label" placeholder="e.g. Head office" />}</FormField>
        <div className="sm:col-span-2"><FormField id="line1" label="Street address" required error={errors.line1?.[0]}>{(p) => <Input {...p} name="line1" autoFocus />}</FormField></div>
        <div className="sm:col-span-2"><FormField id="line2" label="Unit / building">{(p) => <Input {...p} name="line2" />}</FormField></div>
        <FormField id="suburb" label="Suburb">{(p) => <Input {...p} name="suburb" />}</FormField>
        <FormField id="city" label="City / town">{(p) => <Input {...p} name="city" />}</FormField>
        <FormField id="province" label="Province">{(p) => <Input {...p} name="province" />}</FormField>
        <FormField id="postalCode" label="Postal code">{(p) => <Input {...p} name="postalCode" />}</FormField>
        <div className="sm:col-span-2"><FormField id="anotes" label="Access notes" hint="e.g. gate code, parking, alarm">{(p) => <Input {...p} name="notes" />}</FormField></div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add address"}</Button>
      </div>
    </form>
  );
}
