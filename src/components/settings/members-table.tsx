"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Select } from "@/components/ui/input";
import { DataTable } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { ROLES, ROLE_LABELS } from "@/lib/permissions";
import type { MemberRow } from "@/domain/members/service";
import { changeMemberRoleAction } from "@/app/app/settings/actions";

export function MembersTable({ members, currentUserId, canManage, isOwner }: { members: MemberRow[]; currentUserId: string; canManage: boolean; isOwner: boolean }) {
  const [pending, start] = useTransition();
  const editable = (m: MemberRow) => canManage && m.userId !== currentUserId && (isOwner || m.role !== "owner");
  const roleOptions = ROLES.filter((r) => r !== "owner" || isOwner);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        People with access to this organisation. Inviting new members by email arrives in a later phase.
      </p>
      <DataTable
        caption="Organisation members"
        rows={members}
        columns={[
          {
            key: "name",
            header: "Member",
            cell: (m) => (
              <span className="flex items-center gap-2">
                <UserAvatar size="sm" name={m.displayName} />
                <span>{m.displayName}{m.userId === currentUserId ? <span className="text-muted-foreground"> (you)</span> : null}</span>
              </span>
            ),
          },
          {
            key: "role",
            header: "Role",
            cell: (m) =>
              editable(m) ? (
                <Select
                  aria-label={`Role for ${m.displayName}`}
                  className="h-8 w-40"
                  defaultValue={m.role}
                  disabled={pending}
                  onChange={(e) => {
                    const role = e.target.value;
                    start(async () => {
                      const r = await changeMemberRoleAction(m.id, role);
                      if (r.ok) toast.success(`${m.displayName} is now ${ROLE_LABELS[role as keyof typeof ROLE_LABELS]}`);
                      else {
                        toast.error(r.error);
                        e.target.value = m.role;
                      }
                    });
                  }}
                >
                  {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
              ) : (
                ROLE_LABELS[m.role]
              ),
          },
          {
            key: "status",
            header: "Status",
            hideOnMobile: true,
            cell: (m) => <StatusBadge tone={m.status === "active" ? "success" : m.status === "suspended" ? "danger" : "neutral"}>{m.status[0]!.toUpperCase() + m.status.slice(1)}</StatusBadge>,
          },
        ]}
      />
    </div>
  );
}
