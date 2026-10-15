"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Mail, MessageCircle, Phone, Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { CUSTOMER_TYPE_LABELS } from "@/domain/customers/schema";
import type { CustomerListItem } from "@/domain/customers/service";
import { CustomerForm } from "./customer-form";

export function whatsappHref(phone: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) digits = `27${digits.slice(1)}`; // SA local → international
  return digits.length >= 9 ? `https://wa.me/${digits}` : null;
}

export function CustomersList(props: {
  customers: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  filters: { q: string; status: string; type: string };
  canCreate: boolean;
  openCreate: boolean;
}) {
  const { customers, total, page, pageSize, filters, canCreate } = props;
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(props.openCreate);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const href = (patch: Record<string, string | number>) => {
    const q = new URLSearchParams({ q: filters.q, status: filters.status, type: filters.type, page: String(page) });
    for (const [k, v] of Object.entries(patch)) q.set(k, String(v));
    if (!q.get("q")) q.delete("q");
    return `${pathname}?${q.toString()}`;
  };

  const closeCreate = () => {
    setCreating(false);
    if (props.openCreate) router.replace(href({}));
  };

  return (
    <div>
      <form role="search" action={pathname} className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <label htmlFor="customer-search" className="sr-only">Search customers</label>
          <Input id="customer-search" name="q" defaultValue={filters.q} placeholder="Search name, email or phone" className="pl-8" />
        </div>
        <label htmlFor="customer-status" className="sr-only">Status</label>
        <Select id="customer-status" name="status" defaultValue={filters.status} className="w-32">
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </Select>
        <label htmlFor="customer-type" className="sr-only">Type</label>
        <Select id="customer-type" name="type" defaultValue={filters.type} className="w-36">
          <option value="all">All types</option>
          <option value="business">Business</option>
          <option value="individual">Individual</option>
        </Select>
        <Button type="submit" variant="secondary" size="sm">Search</Button>
        <div className="flex-1" />
        {canCreate ? <Button size="sm" onClick={() => setCreating(true)}><Plus /> New customer</Button> : null}
      </form>

      {customers.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={Users}
            title={filters.q ? "No customers match your search" : filters.status === "archived" ? "No archived customers" : "No customers yet"}
            description={filters.q ? undefined : "Add your first customer, or ask the assistant: “Add ABC Construction, contact Pieter, 082 555 1234”."}
            action={canCreate && !filters.q && filters.status === "active" ? <Button size="sm" onClick={() => setCreating(true)}><Plus /> New customer</Button> : undefined}
          />
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {customers.map((c) => {
            const wa = whatsappHref(c.phone);
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/app/sales/customers/${c.id}`} className="text-sm font-medium hover:underline">{c.display_name}</Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {CUSTOMER_TYPE_LABELS[c.type as keyof typeof CUSTOMER_TYPE_LABELS] ?? c.type}
                    {c.phone ? ` · ${c.phone}` : ""}
                    {c.email ? ` · ${c.email}` : ""}
                  </p>
                </div>
                {c.status === "archived" ? <StatusBadge>Archived</StatusBadge> : null}
                <div className="flex shrink-0 gap-1">
                  {c.phone ? <a href={`tel:${c.phone}`} className="rounded p-2 text-muted-foreground hover:bg-surface-raised" aria-label={`Call ${c.display_name}`}><Phone className="size-4" /></a> : null}
                  {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className="rounded p-2 text-muted-foreground hover:bg-surface-raised" aria-label={`WhatsApp ${c.display_name}`}><MessageCircle className="size-4" /></a> : null}
                  {c.email ? <a href={`mailto:${c.email}`} className="hidden rounded p-2 text-muted-foreground hover:bg-surface-raised sm:inline-flex" aria-label={`Email ${c.display_name}`}><Mail className="size-4" /></a> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {pages} · {total} customers</span>
          <div className="flex gap-2">
            {page > 1 ? <Button asChild variant="secondary" size="sm"><Link href={href({ page: page - 1 })}>Previous</Link></Button> : null}
            {page < pages ? <Button asChild variant="secondary" size="sm"><Link href={href({ page: page + 1 })}>Next</Link></Button> : null}
          </div>
        </nav>
      ) : null}

      <Dialog open={creating} onOpenChange={(o) => (o ? setCreating(true) : closeCreate())}>
        <DialogContent title="New customer" className="max-w-xl">
          <CustomerForm onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
