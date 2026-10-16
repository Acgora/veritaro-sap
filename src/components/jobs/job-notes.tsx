"use client";
import { useState, useTransition } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/common/empty-state";
import type { JobNote } from "@/domain/jobs/service";
import { formatDateTime } from "@/lib/dates";
import { addJobNoteAction } from "@/app/app/work/jobs/actions";

export function JobNotes({ jobId, notes, canAdd, timeZone, big = false }: {
  jobId: string; notes: JobNote[]; canAdd: boolean; timeZone: string; big?: boolean;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      {canAdd ? (
        <form
          noValidate
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) { setError("Write a note"); return; }
            start(async () => {
              const r = await addJobNoteAction(jobId, { body });
              if (!r.ok) { setError(r.fieldErrors?.body?.[0]); toast.error(r.error); return; }
              setBody("");
              setError(undefined);
              toast.success("Note added");
            });
          }}
        >
          <label htmlFor={`note-${jobId}`} className="sr-only">Add a note</label>
          <Textarea id={`note-${jobId}`} value={body} maxLength={5000} aria-invalid={error ? true : undefined}
            aria-describedby={error ? `note-${jobId}-error` : undefined}
            placeholder="Add a note — what you found, what's left, access issues…" onChange={(e) => setBody(e.target.value)}
            className={big ? "min-h-24 text-base" : undefined} />
          {error ? <p id={`note-${jobId}-error`} className="text-xs text-danger">{error}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" size={big ? "lg" : "sm"} className={big ? "w-full" : undefined} disabled={pending}>{pending ? "Saving…" : "Add note"}</Button>
          </div>
        </form>
      ) : null}
      {notes.length === 0 ? (
        <EmptyState compact icon={MessageSquare} title="No notes yet" />
      ) : (
        <ol className="flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-border bg-surface-raised p-3 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">{n.authorName ?? "Someone"} · {formatDateTime(n.createdAt, timeZone)}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
