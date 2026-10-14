"use client";
import Link from "next/link";
import { LogOut, Settings, UserRound } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/common/user-avatar";
import { ROLE_LABELS } from "@/lib/permissions";
import { signOutAction } from "@/app/app/actions";
import type { ShellData } from "./types";

export function UserMenu({ data }: { data: ShellData }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full" aria-label="Account menu">
        <UserAvatar name={data.user.name} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium text-foreground">{data.user.name}</p>
          <p className="truncate text-xs">{data.user.email}</p>
          <p className="mt-1 text-xs">{ROLE_LABELS[data.role]} · {data.organisation.name}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/app/settings/profile"><UserRound /> My profile</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/app/settings/organisation"><Settings /> Settings</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full"><LogOut /> Sign out</button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
