import { Lock } from "lucide-react";
import { requireAppContext } from "@/lib/context";
import type { Permission } from "@/lib/permissions";
import { EmptyState } from "./empty-state";

/** Server-side module gate. UX only — data access is still enforced by RLS. */
export async function ModuleGate({ permission, children }: { permission?: Permission; children: React.ReactNode }) {
  if (!permission) return <>{children}</>;
  const app = await requireAppContext();
  if (!app.permissions.can(permission)) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState icon={Lock} title="You don't have access to this area" description="Ask an owner or admin if you need it." />
      </div>
    );
  }
  return <>{children}</>;
}
