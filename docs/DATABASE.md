# Database structure (Phase 001)

All business tables live in `public`. Security-definer helpers live in `app_private` (not exposed through the Data API).

```
auth.users ──1:1── profiles ──< organisation_members >── organisations ──1:1── organisation_settings
                       │                 │ role → roles ──< role_permissions >── permissions
                       │                 │
                       ├──< tasks (assigned_to / created_by / completed_by) >── organisations
                       ├──< notifications (user_id) >── organisations
                       └──< activity_log (actor_user_id, SET NULL) >── organisations
```

| Table | Purpose | Notes |
|---|---|---|
| `profiles` | 1:1 with `auth.users` | auto-created by `on_auth_user_created` trigger from sign-up metadata |
| `organisations` | tenant root | ISO country/currency checks, timezone validated against `pg_timezone_names`, FY-end month (default Feb for SA). `created_by` immutable |
| `organisation_members` | membership + role | unique `(organisation_id, user_id)`; `status` active/invited/suspended — **only `active` grants access** |
| `roles`, `permissions`, `role_permissions` | permission catalogue | lookup tables, not enums — add roles/permissions with INSERTs, no `ALTER TYPE` |
| `organisation_settings` | non-critical preferences (`jsonb` object) | never relational business data, never secrets |
| `activity_log` | append-only audit/timeline | `actor_type` user/ai/system/integration; written only by trusted DB functions |
| `notifications` | per-user per-org | clients may only update `read_at` (column grant) |
| `tasks` | first business module | status/priority checks, polymorphic `related_entity_type/id`, server-owned `completed_at/by` |

## Conventions (binding for future phases)

- `uuid` PKs (`gen_random_uuid()`), `timestamptz` everywhere, `created_at`/`updated_at` with `app_private.set_updated_at()` trigger.
- Every tenant-owned table: `organisation_id uuid not null references organisations on delete cascade` + index leading with `organisation_id`.
- Status-like columns: `text` + `CHECK` (easy to extend in a migration) rather than Postgres enums.
- Text columns have length checks.
- Money: `numeric(19,4)` — never `float`/`real`/`double precision`. See `ACCOUNTING_ARCHITECTURE.md`.
- FKs to people reference `profiles(id)` (enables PostgREST embedding); `ON DELETE SET NULL` for authorship, `CASCADE` for ownership.
- Polymorphic links (`related_entity_type` + `related_entity_id`) are allowed only where a target can be many tables (tasks, activity, notifications). Both-or-neither is enforced by a CHECK. When a target module ships, add validation in a trigger (e.g. `app_private.validate_task_relation`) that checks the referenced row exists **in the same organisation**.
- Lifecycle tables (lead → customer → quote → job → invoice → payment → journal) must use **real foreign keys** between stages (e.g. `jobs.quote_id references quotes`, `invoices.job_id references jobs`) so data flows forward without re-entry.

## Functions

| Function | Kind | Purpose |
|---|---|---|
| `public.create_organisation(...)` | RPC, SECURITY DEFINER | atomic onboarding: org + settings + owner membership + audit. Caps 10 orgs/user |
| `public.get_my_permissions(org)` | RPC, invoker | caller's effective permission keys (UI gating) |
| `public.mark_notifications_read(org, ids?)` | RPC, invoker | marks own notifications read |
| `app_private.my_org_ids()` / `org_ids_with_permission(p)` | definer, stable | used inside RLS policies |
| `app_private.has_permission(org, p)` / `is_active_member(org, user)` / `visible_profile_ids()` / `active_owner_count(org)` | definer, stable | guards & policies |
| `app_private.log_activity(...)` / `create_notification(...)` | definer | the only writers of those tables |
| `app_private.guard_*` | invoker triggers | role-escalation & immutability rules |
| `app_private.audit_*` | definer triggers | activity + notifications |

## Migrations

| File | Content |
|---|---|
| `20261014000100_foundation_core.sql` | schema `app_private`, profiles (+auth trigger), roles/permissions tables, organisations, members, settings |
| `20261014000200_activity_notifications_tasks.sql` | activity_log (append-only), notifications, tasks |
| `20261014000300_roles_permissions_seed.sql` | reference data: 6 roles, 23 permissions, role mappings |
| `20261014000400_security_rls.sql` | helpers, guards, audit triggers, RPCs, grants, RLS policies |
| `20261014000500_harden_function_grants.sql` | removes platform-default EXECUTE grants from `anon`; `get_my_permissions` → invoker |

All five are applied to the hosted project and verified identical (function bodies, policies, triggers, role mappings fingerprinted local vs hosted).
