import { StatusBadge } from "@/components/common/status-badge";
import { statusMeta, type StatusEntity } from "@/lib/status";

/** Consistent status badge for any lifecycle entity. Pass the EFFECTIVE status (expired/overdue already derived). */
export function EntityStatus({ entity, status, className }: { entity: StatusEntity; status: string | null | undefined; className?: string }) {
  const m = statusMeta(entity, status);
  return <StatusBadge tone={m.tone} className={className}>{m.label}</StatusBadge>;
}
