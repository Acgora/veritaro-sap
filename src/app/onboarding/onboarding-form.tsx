"use client";
import { startTransition, useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { COUNTRIES, CURRENCIES } from "@/domain/organisations/schema";
import { createOrganisationAction } from "./actions";

export function timezoneOptions(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return COUNTRIES.map((c) => c.timezone);
  }
}

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createOrganisationAction, null);
  const [country, setCountry] = useState("ZA");
  const [currency, setCurrency] = useState("ZAR");
  const [timezone, setTimezone] = useState("Africa/Johannesburg");
  const zones = useMemo(timezoneOptions, []);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="flex flex-col gap-4" noValidate>
      <FormField id="name" label="Business name" required error={fe?.name?.[0]}>
        {(p) => <Input {...p} name="name" autoComplete="organization" placeholder="e.g. Boland Cleaning" />}
      </FormField>

      <FormField id="country" label="Country" required error={fe?.country?.[0]}>
        {(p) => (
          <Select
            {...p}
            name="country"
            value={country}
            onChange={(e) => {
              const c = COUNTRIES.find((x) => x.code === e.target.value);
              setCountry(e.target.value);
              if (c) {
                setCurrency(c.currency);
                setTimezone(c.timezone);
              }
            }}
          >
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
        )}
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField id="currency" label="Currency" required error={fe?.currency?.[0]}>
          {(p) => (
            <Select {...p} name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}
        </FormField>
        <FormField id="timezone" label="Timezone" required error={fe?.timezone?.[0]}>
          {(p) => (
            <Select {...p} name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((z) => <option key={z} value={z}>{z.replaceAll("_", " ")}</option>)}
            </Select>
          )}
        </FormField>
      </div>

      <details className="rounded-md border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Company details (optional)</summary>
        <div className="mt-3 flex flex-col gap-3">
          <FormField id="legalName" label="Registered (legal) name">{(p) => <Input {...p} name="legalName" />}</FormField>
          <FormField id="registrationNumber" label="Company registration number">{(p) => <Input {...p} name="registrationNumber" />}</FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="taxNumber" label="Tax number">{(p) => <Input {...p} name="taxNumber" />}</FormField>
            <FormField id="vatNumber" label="VAT number">{(p) => <Input {...p} name="vatNumber" />}</FormField>
          </div>
        </div>
      </details>

      {state && !state.ok ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Creating…" : "Create business"}</Button>
    </form>
  );
}
