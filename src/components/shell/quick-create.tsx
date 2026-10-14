"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { QUICK_CREATE_ITEMS } from "@/lib/navigation";
import { PermissionSet } from "@/lib/permissions";

export function quickCreateFor(permissions: string[]) {
  const set = new PermissionSet(permissions);
  return QUICK_CREATE_ITEMS.filter((i) => !i.permission || set.can(i.permission));
}

/** Desktop "+ New" popover. Mobile uses the bottom sheet in MobileNavigation. */
export function QuickCreate({ permissions }: { permissions: string[] }) {
  const items = quickCreateFor(permissions);
  const live = items.filter((i) => i.live);
  const later = items.filter((i) => !i.live);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ size: "sm" })}>
        <Plus aria-hidden /> New
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        {live.map((i) => (
          <DropdownMenuItem key={i.key} asChild>
            <Link href={i.href}><i.icon /> {i.label}</Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Coming in next phases</DropdownMenuLabel>
        {later.map((i) => (
          <DropdownMenuItem key={i.key} asChild>
            <Link href={i.href} className="text-muted-foreground"><i.icon /> {i.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
