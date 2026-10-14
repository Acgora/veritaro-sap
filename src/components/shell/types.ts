import type { Role } from "@/lib/permissions";
import type { Tables } from "@/types/database.types";

/** Serialisable data passed from the server layout into client shell components. */
export interface ShellData {
  user: { id: string; name: string; email: string | null };
  organisation: { id: string; name: string };
  role: Role;
  memberships: { organisationId: string; organisationName: string; role: Role }[];
  permissions: string[];
  notifications: { items: Tables<"notifications">[]; unread: number; error: string | null };
}
