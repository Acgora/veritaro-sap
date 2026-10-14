"use client";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/permissions";
import { switchOrganisationAction } from "@/app/app/actions";
import type { ShellData } from "./types";

export function OrganisationSwitcher({ data }: { data: ShellData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-w-0 max-w-56 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-surface-raised disabled:opacity-60"
        disabled={pending}
        aria-label={`Organisation: ${data.organisation.name}. Switch organisation`}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary text-[11px] font-bold text-primary-foreground" aria-hidden>
          {data.organisation.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate">{data.organisation.name}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organisations</DropdownMenuLabel>
        {data.memberships.map((m) => (
          <DropdownMenuItem
            key={m.organisationId}
            onSelect={() =>
              m.organisationId !== data.organisation.id &&
              start(async () => {
                const r = await switchOrganisationAction(m.organisationId);
                if (!r.ok) toast.error(r.error);
                else router.refresh();
              })
            }
          >
            <span className="flex-1 truncate">{m.organisationName}</span>
            <span className="text-xs text-muted-foreground">{ROLE_LABELS[m.role]}</span>
            {m.organisationId === data.organisation.id ? <Check aria-label="Current" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding?new=1"><Plus /> New organisation</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
