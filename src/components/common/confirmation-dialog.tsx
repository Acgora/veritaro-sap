"use client";
import { useState, useTransition } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Standard confirmation for destructive/consequential actions. Also the UI that
 * AI CONSEQUENTIAL actions must use (see src/lib/ai/types.ts).
 */
export function ConfirmationDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
  onConfirm,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: (open: () => void) => React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => Promise<boolean | void>;
  /** Controlled mode (e.g. when opened from a menu that unmounts). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setInternalOpen(o));
  const [pending, start] = useTransition();
  return (
    <>
      {trigger ? trigger(() => setOpen(true)) : null}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent title={title} description={description} role="alertdialog">
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button
              variant={tone}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await onConfirm();
                  if (result !== false) setOpen(false);
                })
              }
            >
              {pending ? "Working…" : confirmLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
