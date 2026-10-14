import type { Metadata } from "next";
import { getServiceContext } from "@/lib/service-context";
import { listMembers } from "@/domain/members/service";
import { ErrorState } from "@/components/common/empty-state";
import { MembersTable } from "@/components/settings/members-table";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const ctx = await getServiceContext();
  if (!ctx.permissions.can("members.read")) {
    return <p className="text-sm text-muted-foreground">Your role can&apos;t view the member list.</p>;
  }
  const members = await listMembers(ctx);
  if (!members.ok) return <ErrorState message={members.error} />;
  return (
    <MembersTable
      members={members.data}
      currentUserId={ctx.userId}
      canManage={ctx.permissions.can("members.manage")}
      isOwner={ctx.permissions.can("organisation.transfer_ownership")}
    />
  );
}
