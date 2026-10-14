import type { Metadata } from "next";
import { requireAppContext } from "@/lib/context";
import { getServiceContext } from "@/lib/service-context";
import { listTasks } from "@/domain/tasks/service";
import { listMembers } from "@/domain/members/service";
import { listTasksSchema } from "@/domain/tasks/schema";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/empty-state";
import { TasksView } from "@/components/tasks/tasks-view";

export const metadata: Metadata = { title: "Tasks" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filters = listTasksSchema.parse({
    status: typeof sp.status === "string" ? sp.status : undefined,
    scope: typeof sp.scope === "string" ? sp.scope : undefined,
    page: typeof sp.page === "string" ? sp.page : undefined,
  });
  const app = await requireAppContext();
  const ctx = await getServiceContext();

  const [tasks, members] = await Promise.all([
    listTasks(ctx, filters),
    ctx.permissions.can("tasks.assign") && ctx.permissions.can("members.read") ? listMembers(ctx) : Promise.resolve(null),
  ]);

  const self = { userId: app.userId, displayName: `${app.profile.display_name || app.profile.first_name || "Me"} (me)` };
  const assignees = members?.ok
    ? members.data.filter((m) => m.status === "active").map((m) => (m.userId === app.userId ? self : { userId: m.userId, displayName: m.displayName }))
    : [self];

  return (
    <div>
      <PageHeader title="Tasks" description="Reminders and to-dos for you and your team." />
      {!tasks.ok ? (
        <ErrorState message={tasks.error} />
      ) : (
        <TasksView
          key={`${filters.status}-${filters.scope}-${filters.page}`}
          tasks={tasks.data.tasks}
          total={tasks.data.total}
          page={tasks.data.page}
          pageSize={tasks.data.pageSize}
          filters={{ status: filters.status, scope: filters.scope }}
          assignees={assignees}
          currentUserId={app.userId}
          timeZone={app.organisation.timezone}
          permissions={app.permissions.toArray()}
          openCreate={sp.new === "1"}
        />
      )}
    </div>
  );
}
