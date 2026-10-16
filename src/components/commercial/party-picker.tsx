"use client";
import { useEffect, useState } from "react";
import { Select } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { customerPartiesAction } from "@/app/app/sales/quotes/actions";
import type { CustomerParties } from "@/domain/commercial/parties";

export interface PartyValue { customerId: string; contactId: string; siteAddressId: string }

/** Customer → contact/site picker for quotes and invoices (contacts and sites of the chosen customer). */
export function PartyPicker({ customers, value, onChange, disabled, error, idPrefix = "party" }: {
  customers: { id: string; display_name: string }[];
  value: PartyValue;
  onChange: (v: PartyValue) => void;
  disabled?: boolean;
  error?: string;
  idPrefix?: string;
}) {
  const [parties, setParties] = useState<CustomerParties | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    if (!value.customerId) {
      setParties(null);
      return;
    }
    setLoading(true);
    customerPartiesAction(value.customerId).then((r) => {
      if (!live) return;
      setParties(r.ok ? r.data : null);
      setLoading(false);
    });
    return () => { live = false; };
  }, [value.customerId]);

  // A customer that is archived (or beyond the option limit) still shows on its own document.
  const options = value.customerId && !customers.some((c) => c.id === value.customerId) && parties
    ? [{ id: parties.customer.id, display_name: parties.customer.display_name }, ...customers]
    : customers;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <FormField id={`${idPrefix}-customer`} label="Customer" required error={error}>
        {(p) => (
          <Select {...p} value={value.customerId} disabled={disabled} className="h-10"
            onChange={(e) => onChange({ customerId: e.target.value, contactId: "", siteAddressId: "" })}>
            <option value="">Choose a customer…</option>
            {options.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </Select>
        )}
      </FormField>
      <FormField id={`${idPrefix}-contact`} label="Contact" hint={loading ? "Loading…" : parties && parties.contacts.length === 0 ? "No contacts saved" : undefined}>
        {(p) => (
          <Select {...p} value={value.contactId} disabled={disabled || !parties || parties.contacts.length === 0} className="h-10"
            onChange={(e) => onChange({ ...value, contactId: e.target.value })}>
            <option value="">{parties?.contacts.some((c) => c.is_primary) ? "Primary contact" : "None"}</option>
            {parties?.contacts.map((c) => <option key={c.id} value={c.id}>{c.label}{c.is_primary ? " · primary" : ""}</option>)}
          </Select>
        )}
      </FormField>
      <FormField id={`${idPrefix}-site`} label="Site" hint={loading ? "Loading…" : parties && parties.sites.length === 0 ? "No addresses saved" : undefined}>
        {(p) => (
          <Select {...p} value={value.siteAddressId} disabled={disabled || !parties || parties.sites.length === 0} className="h-10"
            onChange={(e) => onChange({ ...value, siteAddressId: e.target.value })}>
            <option value="">None</option>
            {parties?.sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        )}
      </FormField>
    </div>
  );
}
