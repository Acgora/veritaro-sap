"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Plus } from "lucide-react";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { MOBILE_PRIMARY_KEYS, MOBILE_QUICK_ACTIONS, isNavActive } from "@/lib/navigation";
import { PermissionSet } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { visibleNav } from "./sidebar";
import { useShell } from "./shell-context";

/** Mobile-first navigation: Today · Inbox · + · Work · More. Not a shrunken sidebar. */
export function MobileNavigation({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { openAsk } = useShell();
  const [quickOpen, setQuickOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const nav = visibleNav(permissions);
  const primary = MOBILE_PRIMARY_KEYS.map((k) => nav.find((n) => n.key === k)).filter((n) => n !== undefined);
  const more = nav.filter((n) => !(MOBILE_PRIMARY_KEYS as readonly string[]).includes(n.key));
  const perms = new PermissionSet(permissions);
  const actions = MOBILE_QUICK_ACTIONS.filter((a) => !a.permission || perms.can(a.permission));

  const tab = (href: string, label: string, Icon: React.ComponentType<{ className?: string }>) => {
    const active = isNavActive(pathname, href);
    return (
      <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground", active && "text-primary")}>
        <Icon className="size-5" aria-hidden />
        {label}
      </Link>
    );
  };

  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {primary.slice(0, 2).map((n) => tab(n.href, n.label, n.icon))}
        <div className="flex flex-1 items-center justify-center">
          <button type="button" onClick={() => setQuickOpen(true)} aria-label="Quick actions" className="-mt-5 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
            <Plus className="size-6" aria-hidden />
          </button>
        </div>
        {primary.slice(2).map((n) => tab(n.href, n.label, n.icon))}
        <button type="button" onClick={() => setMoreOpen(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
          <Menu className="size-5" aria-hidden />
          More
        </button>
      </nav>

      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <SheetContent title="Quick actions">
          <ul className="grid grid-cols-2 gap-2">
            {actions.map((a) => (
              <li key={a.key}>
                <button
                  type="button"
                  onClick={() => {
                    setQuickOpen(false);
                    if (a.key === "ask") openAsk();
                    else router.push(a.href);
                  }}
                  className="flex w-full items-center gap-2 rounded-md border border-border p-3 text-left text-sm hover:bg-surface-raised"
                >
                  <a.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1">{a.label}</span>
                  {!a.live ? <span className="text-[10px] uppercase text-muted-foreground">soon</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Dialog>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent title="More">
          <ul className="flex flex-col">
            {more.map((n) => (
              <li key={n.key}>
                <Link href={n.href} onClick={() => setMoreOpen(false)} className="flex items-center gap-3 rounded-md px-2 py-2.5 text-sm hover:bg-surface-raised">
                  <n.icon className="size-4 text-muted-foreground" aria-hidden /> {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Dialog>
    </>
  );
}
