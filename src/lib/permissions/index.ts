import { isPermission, type Permission } from "./keys";

export * from "./keys";

/**
 * Immutable permission set for the current user in the active organisation.
 * Loaded from public.get_my_permissions() — the DB role_permissions table is the
 * single source of truth. UI checks are for UX only; RLS is the security boundary.
 */
export class PermissionSet {
  private readonly set: ReadonlySet<Permission>;

  constructor(keys: readonly string[]) {
    this.set = new Set(keys.filter(isPermission));
  }

  can(permission: Permission): boolean {
    return this.set.has(permission);
  }

  canAny(...permissions: Permission[]): boolean {
    return permissions.some((p) => this.set.has(p));
  }

  toArray(): Permission[] {
    return [...this.set].sort();
  }

  static empty() {
    return new PermissionSet([]);
  }
}
