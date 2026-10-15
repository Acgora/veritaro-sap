# RLS strategy

## Rules

1. **RLS is enabled on every table in `public`** (asserted by the test suite).
2. **No policy grants blanket `authenticated` access** except read-only reference data (`roles`, `permissions`, `role_permissions`).
3. **Tenancy is resolved in the database**, never from client input. Policies call:
   - `app_private.my_org_ids()` — organisations where the caller is an **active** member
   - `app_private.org_ids_with_permission('<key>')` — organisations where the caller's role holds a permission
4. **Non-correlated form for performance:** `organisation_id in (select app_private.org_ids_with_permission('tasks.read_all'))`. Postgres evaluates the sub-select once per statement (InitPlan), not per row. `auth.uid()` is always wrapped as `(select auth.uid())`.
5. **Helpers are `SECURITY DEFINER`, `STABLE`, `set search_path = ''`**, live in the non-exposed `app_private` schema, and only `authenticated` may execute the ones used by policies (`anon` has no USAGE on the schema and no EXECUTE).
6. **Writes clients must never make are not granted at all** (defence in depth on top of RLS): no INSERT/DELETE on `organisations`, no writes on `activity_log`, only `UPDATE(read_at)` on `notifications`, no writes on reference tables. `anon` has **no** table privileges in `public`.
7. **Rules RLS can't express live in guard triggers** (run as the invoking role):
   - `guard_organisation_members`: can't add yourself; can't change your own role/status; only owners grant/remove `owner`; at least one active owner must remain; membership org/user immutable.
   - `guard_tasks`: `created_by` forced to caller; tasks can't change organisation; assignee must be an active member; assigning others requires `tasks.assign`; completion fields are server-owned.
   - `guard_organisations`: `created_by`/`created_at` immutable.
   Trusted paths (SECURITY DEFINER RPCs, service role, FK cascades) bypass guards via `app_private.is_client_role()`.
8. **Onboarding can't create cross-tenant access:** organisations are created only through `create_organisation()`, which inserts the caller as owner of the *new* org. No client path inserts a membership for an organisation the caller doesn't manage.

## Policy matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| profiles | self + people sharing an active org | self | self | — |
| organisations | active member | via RPC only | `organisation.update` | — |
| organisation_members | own row, or `members.read` | `members.manage` (+guard) | `members.manage` (+guard) | `members.manage`, or self (leave) (+guard) |
| organisation_settings | `settings.read` | via RPC only | `settings.update` | — |
| activity_log | `activity.read` | trusted functions only | blocked (append-only trigger) | — |
| notifications | own, in active org | trusted functions only | own, `read_at` column only | own |
| tasks | `tasks.read_all`, or `tasks.read_assigned` + assigned/created by me | `tasks.create` (+guard) | `tasks.update_all`, or `tasks.update_assigned` + assigned/created by me (+guard) | `tasks.delete` |

## Template for a new tenant table

```sql
alter table public.<t> enable row level security;
revoke all on public.<t> from anon, authenticated;
grant select, insert, update, delete on public.<t> to authenticated;   -- only what's needed

create policy <t>_select on public.<t> for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('<module>.read')));
create policy <t>_insert on public.<t> for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('<module>.create')));
create policy <t>_update on public.<t> for update to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('<module>.update')))
  with check (organisation_id in (select app_private.org_ids_with_permission('<module>.update')));
```

Then add a guard trigger forbidding `organisation_id` changes, an audit trigger calling `app_private.log_activity`, and isolation tests in `supabase/tests/rls.test.sql`.

## Verification

- `npm run test:db` — 159 assertions (Phase 001 + `rls_phase2.test.sql`) incl. cross-tenant read/write/insert/update/delete denial for every table, role escalation attempts, anon lockout, append-only audit, SECURITY DEFINER `search_path` hygiene.
- Hosted project: a rolled-back transaction smoke test (11 checks) passed on 2026-10-14; Supabase security advisor reports only the intentional `create_organisation` SECURITY DEFINER RPC.

## Known trade-offs

- The active-organisation cookie is a UI preference; every query still filters by `organisation_id` **and** RLS checks membership.
- Deleting an auth user cascades their memberships without the last-owner guard (platform path). An organisation can be left ownerless; recovery is an admin/support task.
- Suspended/invited members lose all access immediately (policies require `status = 'active'`).

## Phase 002 additions

- Customers/contacts/addresses: read via `customers.read`, or `customers.read_linked` limited to `app_private.linked_customer_ids()`. Writes need create/update; archive is a guarded update (no hard delete for non-admins).
- AI server tables (`ai_requests`, `ai_usage_monthly`, routes, prices, plans, limits) have RLS on with **no policies** — reachable only by service_role. Advisor reports this as INFO; intentional.
- `ai_conversations/messages/actions`: a user sees only their own rows in orgs where they are active.
- All `app_private` functions: EXECUTE revoked from `anon`.
