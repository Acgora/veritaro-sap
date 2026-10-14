"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/dates";
import { markAllNotificationsReadAction } from "@/app/app/actions";
import { cn } from "@/lib/utils";
import type { ShellData } from "./types";

export function NotificationMenu({ notifications }: { notifications: ShellData["notifications"] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { items, unread, error } = notifications;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative rounded-md p-2 text-muted-foreground hover:bg-surface-raised hover:text-foreground" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}>
        <Bell className="size-4" aria-hidden />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white" aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto text-xs"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await markAllNotificationsReadAction();
                  if (!r.ok) toast.error(r.error);
                  router.refresh();
                })
              }
            >
              Mark all read
            </Button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {error ? (
            <p className="p-4 text-sm text-danger">{error}</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id} className={cn("border-b border-border px-3 py-2.5 last:border-0", !n.read_at && "bg-info-soft/50")}>
                  <p className="text-sm font-medium">
                    {!n.read_at ? <span className="sr-only">Unread: </span> : null}
                    {n.title}
                  </p>
                  {n.message ? <p className="truncate text-sm text-muted-foreground">{n.message}</p> : null}
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatRelative(n.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
