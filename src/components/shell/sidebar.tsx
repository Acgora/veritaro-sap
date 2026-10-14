"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavActive, type NavItem } from "@/lib/navigation";
import { PermissionSet } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export function visibleNav(permissions: string[]): NavItem[] {
  const set = new PermissionSet(permissions);
  return NAV_ITEMS.filter((i) => !i.permission || set.can(i.permission));
}

export function Sidebar({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const items = visibleNav(permissions);
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-0.5 p-2">
      {items.map((item) => {
        const active = isNavActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <div key={item.key}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground",
                active && "bg-surface-raised font-medium text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
            {active && item.children ? (
              <div className="mb-1 ml-[1.15rem] mt-0.5 flex flex-col border-l border-border pl-2.5">
                {item.children.map((c) => (
                  <Link
                    key={c.href}
                    href={c.href}
                    aria-current={pathname === c.href ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:text-foreground",
                      pathname === c.href && "font-medium text-foreground",
                    )}
                  >
                    {c.label}
                    {!c.live ? <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">soon</span> : null}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
