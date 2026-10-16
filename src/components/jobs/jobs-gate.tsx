import { Lock } from "lucide-react";
import { requireAppContext } from "@/lib/context";
import { EmptyState } from "@/components/common/empty-state";

/**
 * Jobs are visible to office roles (jobs.read_all — including accountants who invoice them)
 * and field roles (jobs.read_assigned). ModuleGate takes a single key, so jobs use this.
 * UX only — RLS is the security boundary.
 */
export async function JobsGate({ children, write = false }: { children: React.ReactNode; write?: boolean }) {
  const app = await requireAppContext();
  const allowed = write ? app.permissions.can("jobs.write") : app.permissions.canAny("jobs.read_all", "jobs.read_assigned");
  if (!allowed) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState icon={Lock} title="You don't have access to this area" description="Ask an owner or admin if you need it." />
      </div>
    );
  }
  return <>{children}</>;
}
