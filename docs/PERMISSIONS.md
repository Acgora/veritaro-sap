# Roles & permissions

**Source of truth:** `public.role_permissions` (migrations `…000300` + Phase 002 `20261015000100`; 30 keys). The UI mirrors keys in `src/lib/permissions/keys.ts`; a unit test fails if they drift.

Permission keys are `domain.action`. Code checks **permissions, never role names** (`permissions.can("tasks.create")`, not `role === "admin"`). The only role-name logic is owner protection in the members guard.

| Permission | owner | admin | accountant | supervisor | field_agent | viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| organisation.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| organisation.update | ✓ | ✓ | | | | |
| organisation.delete | ✓ | | | | | |
| organisation.transfer_ownership | ✓ | | | | | |
| members.read | ✓ | ✓ | ✓ | ✓ | | ✓ |
| members.manage | ✓ | ✓ (not owners) | | | | |
| settings.read | ✓ | ✓ | ✓ | ✓ | | ✓ |
| settings.update | ✓ | ✓ | | | | |
| activity.read | ✓ | ✓ | ✓ | ✓ | | ✓ |
| tasks.read_all | ✓ | ✓ | | ✓ | | ✓ |
| tasks.read_assigned | ✓ | ✓ | ✓ | | ✓ | |
| tasks.create | ✓ | ✓ | ✓ | ✓ | ✓ | |
| tasks.assign | ✓ | ✓ | | ✓ | | |
| tasks.update_all | ✓ | ✓ | | ✓ | | |
| tasks.update_assigned | ✓ | ✓ | ✓ | | ✓ | |
| tasks.delete | ✓ | ✓ | | | | |
| inbox.access | ✓ | ✓ | ✓ | ✓ | | ✓ |
| sales.access | ✓ | ✓ | ✓ | ✓ | | ✓ |
| work.access | ✓ | ✓ | | ✓ | ✓ | ✓ |
| money.access | ✓ | ✓ | ✓ | | | ✓ |
| team.access | ✓ | ✓ | | ✓ | | ✓ |
| documents.access | ✓ | ✓ | ✓ | ✓ | | ✓ |
| business.access | ✓ | ✓ | ✓ | | | ✓ |
| customers.read | ✓ | ✓ | ✓ | ✓ | | ✓ |
| customers.read_linked | | | | | ✓ | |
| customers.create | ✓ | ✓ | ✓ | ✓ | | |
| customers.update | ✓ | ✓ | ✓ | ✓ | | |
| customers.archive | ✓ | ✓ | | | | |
| ai.use | ✓ | ✓ | ✓ | ✓ | ✓ | |
| ai.usage_read | ✓ | ✓ | ✓ | | | |

## Review points for you (business decisions, not engineering)

- **Viewer has `money.access`.** "Read-only access to permitted business information" — once invoices exist, viewers would see financials. Remove if viewers are e.g. junior staff.
- **Accountant has no `tasks.read_all`.** They only see tasks assigned to/created by them.
- **Field agents can't see the member list or activity history.** Deliberate (privacy), but they'll see assignee names via tasks.

Changing a mapping = one INSERT/DELETE migration on `role_permissions`. No code change.

## Adding a permission

1. Migration: `insert into permissions(key, description)` + `role_permissions` rows.
2. Add the key to `PERMISSIONS` in `src/lib/permissions/keys.ts` and update the count assertion in `supabase/tests/rls.test.sql`.
3. Use it in RLS policies **and** in the domain service's early check.

## Future: granular / per-user permissions

The structure already supports it: add `member_permission_overrides(member_id, permission, granted boolean)` and extend `org_ids_with_permission()` to union grants / subtract revocations. Policies don't change.

## Phase 002 notes

- `customers.read_linked` (field agents): sees only customers linked to a task assigned to them, and sees the **full** record of those customers (contacts, sites). Narrowing columns is a later decision.
- `customers.archive`: owner/admin. Any creator may also archive their own customer within 15 minutes (undo of an accidental create).
- `ai.use` gates the assistant bar; each AI tool additionally requires the same permission a human would need. `ai.usage_read` gates Settings → AI usage.

## Phase 003

See [PHASE_003.md](./PHASE_003.md) for the lifecycle, tables, state machines, numbering, snapshots, tax rules, permissions, storage, PDFs, follow-up rules and AI tools added in Phase 003.
