"use client";
import { startTransition, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import type { AuthFormState } from "./actions";

interface Field {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
}

export function AuthForm({
  action,
  fields,
  submitLabel,
  hidden,
}: {
  action: (state: AuthFormState, fd: FormData) => Promise<AuthFormState>;
  fields: Field[];
  submitLabel: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.message) {
    return <p role="status" className="rounded-md bg-success-soft p-3 text-sm text-success">{state.message}</p>;
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => formAction(fd)); }} className="flex flex-col gap-4" noValidate>
      {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
      {fields.map((f) => (
        <FormField key={f.name} id={f.name} label={f.label} required={f.required} hint={f.hint} error={state.fieldErrors?.[f.name]?.[0]}>
          {(p) => <Input {...p} name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} />}
        </FormField>
      ))}
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Please wait…" : submitLabel}</Button>
    </form>
  );
}
