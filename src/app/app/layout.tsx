import { AppShell } from "@/components/shell/app-shell";
import type { ShellData } from "@/components/shell/types";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { listNotifications } from "@/domain/notifications/service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const app = await requireAppContext();
  const ctx = await getServiceContext();
  const notifications = await listNotifications(ctx, 10);

  const data: ShellData = {
    user: {
      id: app.userId,
      name: app.profile.display_name || app.profile.first_name || app.email || "You",
      email: app.email,
    },
    organisation: { id: app.organisation.id, name: app.organisation.name },
    role: app.role,
    memberships: app.memberships,
    permissions: app.permissions.toArray(),
    notifications: notifications.ok
      ? { ...notifications.data, error: null }
      : { items: [], unread: 0, error: notifications.error },
  };

  return <AppShell data={data}>{children}</AppShell>;
}
