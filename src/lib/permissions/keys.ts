/**
 * Permission catalogue — MUST mirror public.permissions (migrations 20261014000300, 20261015000100, 20261016000200).
 * tests/unit/permissions.test.ts parses the migration and fails if these drift.
 * The database is the source of truth; this file exists for type-safety in the UI.
 */
export const PERMISSIONS = [
  "organisation.read",
  "organisation.update",
  "organisation.delete",
  "organisation.transfer_ownership",
  "members.read",
  "members.manage",
  "settings.read",
  "settings.update",
  "activity.read",
  "tasks.read_all",
  "tasks.read_assigned",
  "tasks.create",
  "tasks.assign",
  "tasks.update_all",
  "tasks.update_assigned",
  "tasks.delete",
  "sales.access",
  "work.access",
  "money.access",
  "team.access",
  "documents.access",
  "business.access",
  "inbox.access",
  // Phase 002
  "customers.read",
  "customers.read_linked",
  "customers.create",
  "customers.update",
  "customers.archive",
  "ai.use",
  "ai.usage_read",
  // Phase 003
  "leads.read",
  "leads.write",
  "inbox.read",
  "inbox.write",
  "quotes.read",
  "quotes.write",
  "quotes.issue",
  "jobs.read_all",
  "jobs.read_assigned",
  "jobs.write",
  "jobs.work",
  "invoices.read",
  "invoices.write",
  "invoices.issue",
  "payments.read",
  "payments.record",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["owner", "admin", "accountant", "supervisor", "field_agent", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  accountant: "Accountant",
  supervisor: "Supervisor",
  field_agent: "Field agent",
  viewer: "Viewer",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
