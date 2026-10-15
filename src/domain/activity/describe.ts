import type { ActivityItem } from "./service";

/** Human-readable sentence for an activity entry. Pure + unit-tested. */
export function describeActivity(
  item: Pick<ActivityItem, "action" | "metadata" | "actorType" | "actorName"> & { actorUserId?: string | null },
): string {
  const who = item.actorType === "ai" ? "The assistant" : item.actorType === "system" ? "System" : (item.actorName ?? "Someone");
  const title = typeof item.metadata.title === "string" ? `“${item.metadata.title}”` : "a task";
  const name = typeof item.metadata.name === "string" ? `“${item.metadata.name}”` : "a customer";
  const role = typeof item.metadata.role === "string" ? item.metadata.role.replace("_", " ") : null;
  switch (item.action) {
    case "organisation_created":
      return `${who} created the organisation`;
    case "organisation_updated":
      return `${who} updated organisation details`;
    case "settings_updated":
      return `${who} changed organisation preferences`;
    case "member_added":
      if (item.actorUserId && item.metadata.user_id === item.actorUserId) return `${who} joined${role ? ` as ${role}` : ""}`;
      return `${who} added a member${role ? ` as ${role}` : ""}`;
    case "member_removed":
      return `${who} removed a member`;
    case "member_role_changed":
      return `${who} changed a member's role to ${String(item.metadata.to_role ?? "").replace("_", " ")}`;
    case "member_status_changed":
      return `${who} changed a member's status to ${String(item.metadata.to_status ?? "")}`;
    case "task_created":
      return `${who} created task ${title}`;
    case "task_updated":
      return `${who} updated task ${title}`;
    case "task_completed":
      return `${who} completed task ${title}`;
    case "task_reopened":
      return `${who} reopened task ${title}`;
    case "task_archived":
      return `${who} archived task ${title}`;
    case "task_deleted":
      return `${who} deleted task ${title}`;
    case "customer_created":
      return `${who} added customer ${name}`;
    case "customer_updated":
      return `${who} updated customer ${name}`;
    case "customer_archived":
      return `${who} archived customer ${name}`;
    case "customer_restored":
      return `${who} restored customer ${name}`;
    case "contact_added":
      return `${who} added a contact to ${name}`;
    case "contact_updated":
      return `${who} updated a contact for ${name}`;
    case "contact_removed":
      return `${who} removed a contact from ${name}`;
    case "address_added":
      return `${who} added an address to ${name}`;
    case "address_updated":
      return `${who} updated an address for ${name}`;
    case "address_removed":
      return `${who} removed an address from ${name}`;
    case "ai_soft_budget_exceeded":
      return "AI usage passed this month's soft budget";
    case "ai_hard_limit_reached":
      return "AI paused: monthly AI spending ceiling reached";
    default:
      return `${who} · ${item.action.replaceAll("_", " ")}`;
  }
}
