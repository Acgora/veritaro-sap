"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormField } from "@/components/common/form-field";
import {
  DIRECTIONS, DIRECTION_LABELS, KIND_LABELS, LOGGABLE_KINDS, logCommunicationSchema, type Direction, type LoggableKind,
} from "@/domain/inbox/schema";
import { logCommunicationAction } from "@/app/app/inbox/actions";
import { fromLocalInput, toLocalInput } from "@/components/leads/datetime";

export interface LogLink {
  conversationId?: string | null;
  leadId?: string | null;
  customerId?: string | null;
}

/**
 * "Log a call / note / meeting" — records something that happened outside Veritaro.
 * Nothing is sent. Uses public.log_communication (finds or creates the conversation).
 */
export function LogCommunicationForm({
  link,
  idPrefix = "log",
  withSubject = false,
  defaultKind = "call",
  onDone,
  onCancel,
}: {
  link: LogLink;
  idPrefix?: string;
  withSubject?: boolean;
  defaultKind?: LoggableKind;
  onDone?: (r: { conversationId: string; messageId: string }) => void;
  onCancel?: () => void;
}) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [kind, setKind] = useState<LoggableKind>(defaultKind);
  const [formKey, setFormKey] = useState(0);
  const id = (k: string) => `${idPrefix}-${k}`;

  const submit = (fd: FormData) => {
    const input = {
      body: String(fd.get("body") ?? ""),
      kind,
      direction: String(fd.get("direction") ?? (kind === "note" ? "internal" : "outbound")) as Direction,
      occurredAt: fromLocalInput(String(fd.get("occurredAt") ?? "")),
      subject: withSubject ? String(fd.get("subject") ?? "") : undefined,
      conversationId: link.conversationId ?? undefined,
      leadId: link.leadId ?? undefined,
      customerId: link.customerId ?? undefined,
    };
    const check = logCommunicationSchema.safeParse(input);
    if (!check.success) {
      setErrors(check.error.flatten().fieldErrors);
      setFormError(null);
      return;
    }
    setErrors({});
    start(async () => {
      const r = await logCommunicationAction(input);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.error);
        return;
      }
      setFormError(null);
      toast.success(`${KIND_LABELS[kind]} logged`);
      setFormKey((k) => k + 1); // reset fields
      onDone?.(r.data);
    });
  };

  return (
    <form key={formKey} noValidate className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }}>
      <div role="group" aria-label="What happened?" className="flex flex-wrap gap-1.5">
        {LOGGABLE_KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
            className={`h-9 rounded-full border px-3 text-sm ${kind === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface"}`}>
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      {withSubject ? (
        <FormField id={id("subject")} label="Subject" error={errors.subject?.[0]}>
          {(p) => <Input {...p} name="subject" className="h-10" maxLength={300} placeholder="e.g. Office clean enquiry" />}
        </FormField>
      ) : null}
      <FormField id={id("body")} label={kind === "note" ? "Note" : "What was said?"} required error={errors.body?.[0]}>
        {(p) => <Textarea {...p} name="body" maxLength={20000} placeholder={kind === "call" ? "e.g. Called Thandi — wants a quote for 3 floors, site visit Thursday" : undefined} />}
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id={id("direction")} label="Direction" error={errors.direction?.[0]}>
          {(p) => (
            <Select {...p} name="direction" className="h-10" key={kind} defaultValue={kind === "note" ? "internal" : "outbound"}>
              {DIRECTIONS.map((d) => <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>)}
            </Select>
          )}
        </FormField>
        <FormField id={id("occurredAt")} label="When" hint="Leave empty if it was just now" error={errors.occurredAt?.[0]}>
          {(p) => <Input {...p} name="occurredAt" type="datetime-local" className="h-10" max={toLocalInput(new Date(Date.now() + 60_000).toISOString())} suppressHydrationWarning />}
        </FormField>
      </div>
      {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
      <div className="flex justify-end gap-2">
        {onCancel ? <Button variant="secondary" size="lg" onClick={onCancel} disabled={pending}>Cancel</Button> : null}
        <Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : `Log ${KIND_LABELS[kind].toLowerCase()}`}</Button>
      </div>
    </form>
  );
}
