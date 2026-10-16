"use client";
import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/common/confirmation-dialog";
import { FormField } from "@/components/common/form-field";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LEAD_STATUS, type LeadStatus } from "@/domain/leads/schema";
import { moveTargets } from "@/domain/leads/rules";
import { setLeadStatusAction } from "@/app/app/sales/leads/actions";

interface Target { id: string; name: string }

/**
 * One place for pipeline moves. Ordinary stages move immediately; "Won" asks for confirmation and
 * "Lost" asks for a reason. Used by the board menu, drag & drop and the lead detail page.
 */
export function useLeadMove(onMoved?: (id: string, status: LeadStatus) => void) {
  const [pending, start] = useTransition();
  const [won, setWon] = useState<Target | null>(null);
  const [lost, setLost] = useState<Target | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const apply = async (t: Target, status: LeadStatus, lostReason?: string) => {
    const r = await setLeadStatusAction(t.id, { status, lostReason });
    if (!r.ok) {
      if (status === "lost" && r.fieldErrors?.lostReason?.[0]) setReasonError(r.fieldErrors.lostReason[0]);
      toast.error(r.error);
      return false;
    }
    toast.success(`${t.name} moved to ${LEAD_STATUS[status].label}`);
    onMoved?.(t.id, status);
    return true;
  };

  const requestMove = (t: Target, status: LeadStatus) => {
    if (status === "won") return setWon(t);
    if (status === "lost") {
      setReason("");
      setReasonError(null);
      return setLost(t);
    }
    start(async () => { await apply(t, status); });
  };

  const dialogs = (
    <>
      <ConfirmationDialog
        open={!!won}
        onOpenChange={(o) => { if (!o) setWon(null); }}
        tone="primary"
        title="Mark this lead as won?"
        description={won ? `${won.name} will move to Won. If there's a quote, accept it from the quote so the job can be created.` : ""}
        confirmLabel="Mark won"
        onConfirm={async () => {
          if (!won) return false;
          const done = await apply(won, "won");
          if (done) setWon(null);
          return done;
        }}
      />
      <Dialog open={!!lost} onOpenChange={(o) => { if (!o && !pending) setLost(null); }}>
        <DialogContent title="Mark this lead as lost?" description={lost ? `${lost.name} will move to Lost. It stays on record.` : undefined}>
          <form
            noValidate
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!lost) return;
              if (!reason.trim()) { setReasonError("Say briefly why the lead was lost"); return; }
              start(async () => { if (await apply(lost, "lost", reason)) setLost(null); });
            }}
          >
            <FormField id="lostReason" label="Reason" required error={reasonError ?? undefined} hint="e.g. Went with a cheaper quote, no budget, couldn't reach them">
              {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />}
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setLost(null)} disabled={pending}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={pending}>{pending ? "Saving…" : "Mark lost"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );

  return { requestMove, dialogs, pending };
}

/** Accessible "Move to…" menu (keyboard + touch). */
export function MoveToMenu({ target, current, onMove, disabled, size = "sm" }: {
  target: Target;
  current: string;
  onMove: (t: Target, status: LeadStatus) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={size} disabled={disabled} className="h-8 px-2 text-xs" aria-label={`Move ${target.name} to another stage`}>
          Move to… <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        {moveTargets(current).map((s) => (
          <DropdownMenuItem key={s} onSelect={() => onMove(target, s)}>{LEAD_STATUS[s].label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
