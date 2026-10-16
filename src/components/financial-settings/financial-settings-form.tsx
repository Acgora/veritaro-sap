"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import { updateFinancialSettingsAction } from "@/app/app/settings/financial/actions";
import { BANK_ACCOUNT_TYPES } from "@/domain/financial-settings/schema";
import type { BusinessProfile, FinancialSettings } from "@/domain/financial-settings/service";

function Toggle({ id, checked, onChange, label, hint, disabled }: {
  id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex min-h-10 cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" className="mt-0.5 size-5 accent-primary" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint ? <span id={`${id}-hint`} className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {description ? <p className="-mt-2 text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </fieldset>
  );
}

export function FinancialSettingsForm({ settings: s, business: b, canEdit, canEditAddress }: {
  settings: FinancialSettings; business: BusinessProfile; canEdit: boolean; canEditAddress: boolean;
}) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [vat, setVat] = useState(s.vat_registered);
  const [inclusive, setInclusive] = useState(s.prices_include_tax_default);
  const err = (k: string) => errors[k]?.[0];

  const submit = (fd: FormData) => {
    const t = (k: string) => String(fd.get(k) ?? "");
    start(async () => {
      const r = await updateFinancialSettingsAction({
        vatRegistered: vat,
        taxLabel: t("taxLabel") || s.tax_label,
        taxRate: t("taxRate") || String(s.tax_rate),
        pricesIncludeTaxDefault: inclusive,
        quoteValidityDays: t("quoteValidityDays"),
        invoiceDueDays: t("invoiceDueDays"),
        defaultQuoteTerms: t("defaultQuoteTerms"),
        defaultInvoiceTerms: t("defaultInvoiceTerms"),
        bankName: t("bankName"),
        bankAccountHolder: t("bankAccountHolder"),
        bankAccountNumber: t("bankAccountNumber"),
        bankBranchCode: t("bankBranchCode"),
        bankAccountType: t("bankAccountType"),
        leadFollowupDays: t("leadFollowupDays"),
        quoteFollowupDays: t("quoteFollowupDays"),
        invoiceDueSoonDays: t("invoiceDueSoonDays"),
        address: canEditAddress ? {
          addressLine1: t("addressLine1"), addressLine2: t("addressLine2"), suburb: t("suburb"),
          city: t("city"), province: t("province"), postalCode: t("postalCode"),
        } : undefined,
      });
      if (r.ok) {
        setErrors({});
        toast.success("Settings saved. New quotes and invoices will use them.");
      } else {
        setErrors(r.fieldErrors ?? {});
        toast.error(r.error);
      }
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }} className="flex flex-col gap-5" noValidate>
      <div className="flex gap-2 rounded-md bg-info-soft p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p>
          These settings apply to quotes and invoices you create or issue from now on. Documents you have already issued keep the
          business details, VAT and bank details they were issued with — changing something here never alters them.
        </p>
      </div>
      {!canEdit ? <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">You can view these settings. Only owners and admins can change them.</p> : null}

      <fieldset disabled={!canEdit || pending} className="flex flex-col gap-5">
        <legend className="sr-only">Quote and invoice settings</legend>

        <Group title="Business address" description="Printed as your address on quotes and invoices.">
          {!canEditAddress && canEdit ? <p className="text-xs text-muted-foreground">Only someone who can edit the organisation can change the address.</p> : null}
          <fieldset disabled={!canEditAddress} className="flex flex-col gap-4">
            <legend className="sr-only">Business address</legend>
            <FormField id="addressLine1" label="Street address" error={err("address")}>{(p) => <Input {...p} name="addressLine1" defaultValue={b.address.addressLine1 ?? ""} autoComplete="address-line1" className="h-10" />}</FormField>
            <FormField id="addressLine2" label="Building, unit or PO box">{(p) => <Input {...p} name="addressLine2" defaultValue={b.address.addressLine2 ?? ""} autoComplete="address-line2" className="h-10" />}</FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="suburb" label="Suburb">{(p) => <Input {...p} name="suburb" defaultValue={b.address.suburb ?? ""} className="h-10" />}</FormField>
              <FormField id="city" label="City or town">{(p) => <Input {...p} name="city" defaultValue={b.address.city ?? ""} autoComplete="address-level2" className="h-10" />}</FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="province" label="Province">{(p) => <Input {...p} name="province" defaultValue={b.address.province ?? ""} autoComplete="address-level1" className="h-10" />}</FormField>
              <FormField id="postalCode" label="Postal code">{(p) => <Input {...p} name="postalCode" defaultValue={b.address.postalCode ?? ""} autoComplete="postal-code" inputMode="numeric" className="h-10" />}</FormField>
            </div>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Business name, VAT number, email and phone come from <Link href="/app/settings/organisation" className="text-primary underline-offset-2 hover:underline">Organisation settings</Link>.
          </p>
        </Group>

        <Group title="VAT">
          <Toggle id="vatRegistered" checked={vat} onChange={setVat} label="My business is VAT registered"
            hint="When on, VAT is added to taxable lines and invoices are titled “Tax invoice”." />
          {vat && !b.vatNumber ? (
            <p className="rounded-md bg-warning-soft p-2 text-xs">
              Add your VAT number in <Link href="/app/settings/organisation" className="underline">Organisation settings</Link> — a tax invoice must show it.
            </p>
          ) : null}
          {vat ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="taxLabel" label="Tax label" required error={err("taxLabel")} hint="Shown on documents, e.g. VAT">
                  {(p) => <Input {...p} name="taxLabel" defaultValue={s.tax_label} maxLength={20} className="h-10" />}
                </FormField>
                <FormField id="taxRate" label="Rate (%)" required error={err("taxRate")} hint="South Africa: 15">
                  {(p) => <Input {...p} name="taxRate" defaultValue={String(s.tax_rate)} inputMode="decimal" className="h-10" />}
                </FormField>
              </div>
              <Toggle id="pricesIncludeTaxDefault" checked={inclusive} onChange={setInclusive} label="Prices I type already include VAT"
                hint="Default for new documents. You can change it on each quote or invoice." />
            </>
          ) : null}
        </Group>

        <Group title="Quotes and invoices">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="quoteValidityDays" label="Quotes are valid for (days)" required error={err("quoteValidityDays")}>
              {(p) => <Input {...p} name="quoteValidityDays" type="number" min={1} max={365} defaultValue={s.quote_validity_days} className="h-10" />}
            </FormField>
            <FormField id="invoiceDueDays" label="Invoices are due after (days)" required error={err("invoiceDueDays")}
              hint="A customer's own payment terms take priority.">
              {(p) => <Input {...p} name="invoiceDueDays" type="number" min={0} max={365} defaultValue={s.invoice_due_days} className="h-10" />}
            </FormField>
          </div>
          <FormField id="defaultQuoteTerms" label="Default quote terms" error={err("defaultQuoteTerms")}>
            {(p) => <Textarea {...p} name="defaultQuoteTerms" defaultValue={s.default_quote_terms ?? ""} maxLength={4000} rows={4} />}
          </FormField>
          <FormField id="defaultInvoiceTerms" label="Default invoice terms" error={err("defaultInvoiceTerms")}>
            {(p) => <Textarea {...p} name="defaultInvoiceTerms" defaultValue={s.default_invoice_terms ?? ""} maxLength={4000} rows={4} />}
          </FormField>
        </Group>

        <Group title="Bank details" description="Printed on invoices so customers know where to pay.">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="bankName" label="Bank" error={err("bankName")}>{(p) => <Input {...p} name="bankName" defaultValue={s.bank_name ?? ""} className="h-10" />}</FormField>
            <FormField id="bankAccountHolder" label="Account holder" error={err("bankAccountHolder")}>{(p) => <Input {...p} name="bankAccountHolder" defaultValue={s.bank_account_holder ?? ""} className="h-10" />}</FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="bankAccountNumber" label="Account number" error={err("bankAccountNumber")}>{(p) => <Input {...p} name="bankAccountNumber" defaultValue={s.bank_account_number ?? ""} inputMode="numeric" autoComplete="off" className="h-10" />}</FormField>
            <FormField id="bankBranchCode" label="Branch code" error={err("bankBranchCode")}>{(p) => <Input {...p} name="bankBranchCode" defaultValue={s.bank_branch_code ?? ""} inputMode="numeric" className="h-10" />}</FormField>
            <FormField id="bankAccountType" label="Account type" error={err("bankAccountType")}>
              {(p) => (
                <Select {...p} name="bankAccountType" defaultValue={s.bank_account_type ?? ""} className="h-10">
                  <option value="">—</option>
                  {[...new Set([...BANK_ACCOUNT_TYPES, ...(s.bank_account_type ? [s.bank_account_type] : [])])].map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              )}
            </FormField>
          </div>
        </Group>

        <Group title="Follow-up reminders" description="When Today should nudge you.">
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="leadFollowupDays" label="Lead with no reply after (days)" required error={err("leadFollowupDays")}>
              {(p) => <Input {...p} name="leadFollowupDays" type="number" min={1} max={90} defaultValue={s.lead_followup_days} className="h-10" />}
            </FormField>
            <FormField id="quoteFollowupDays" label="Quote with no answer after (days)" required error={err("quoteFollowupDays")}>
              {(p) => <Input {...p} name="quoteFollowupDays" type="number" min={1} max={90} defaultValue={s.quote_followup_days} className="h-10" />}
            </FormField>
            <FormField id="invoiceDueSoonDays" label="Invoice “due soon” within (days)" required error={err("invoiceDueSoonDays")}>
              {(p) => <Input {...p} name="invoiceDueSoonDays" type="number" min={0} max={60} defaultValue={s.invoice_due_soon_days} className="h-10" />}
            </FormField>
          </div>
        </Group>
      </fieldset>
      {canEdit ? <div><Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button></div> : null}
    </form>
  );
}
