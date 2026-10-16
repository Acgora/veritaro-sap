# Veritaro security — authoritative requirements

Security is part of the Definition of Done. A feature is **done** only when functional, security, RLS,
tenant-isolation, permission and audit tests pass. Critical security failures block deployment.

## 1. Permanent rules

- Zero trust and least privilege, everywhere.
- All tenant data is isolated by `organisation_id` and protected by Postgres RLS. RLS is the final boundary.
- Never trust a client-supplied `organisation_id`, record id or permission. Every query also filters by the
  server-resolved organisation, and RLS re-checks membership.
- UI hiding is not security. Every action is enforced in the database.
- AI is untrusted. It may only use approved, permission-aware tools (`src/lib/ai/registry.ts`). It can never bypass
  auth, RLS, permissions, deterministic business logic, audit, or consequential-action confirmation.
- Service-role credentials stay server-side and are never used to work around broken RLS.
- Secrets never enter source control, browser bundles, AI prompts or logs.
- Financial and tax calculations are deterministic (Postgres). They are never calculated by an LLM.
- Sensitive actions need confirmation, a single transaction and idempotency.
- External providers and webhooks are untrusted until their signature or origin is verified.
- Sensitive storage is private and tenant-protected.
- Important actions create durable audit events (`activity_log`, append-only).
- Local, staging and production security configuration must not silently drift (§6.2).
- New tenant tables need RLS plus cross-tenant negative tests.
- Privileged (`SECURITY DEFINER`) functions need an explicit justification (§5) and security tests.

### STOP and report — never implement

- disabling or bypassing RLS
- exposing secrets or service-role credentials
- unrestricted AI or database access
- public sensitive storage
- bypassing permissions, audit or confirmation
- weakening tenant isolation
- silently rewriting financial history

## 2. Before implementing any feature

Write down, in the PR or phase doc:

1. **Data sensitivity:** personal data, financial data, bank details, internal notes.
2. **Tenant ownership:** which `organisation_id` owns each row.
3. **Permissions:** the keys needed (`src/lib/permissions/keys.ts`, mirrored in `public.permissions`).
4. **RLS:** the policies per command (template in §4).
5. **Privileged operations:** any `SECURITY DEFINER` function, with its justification (§5).
6. **AI and tools:** the action class (read / draft / consequential) and data minimisation.
7. **External integrations:** how trust is established.
8. **Audit events:** what is logged, by whom, and on whose behalf for AI.
9. **Abuse cases:** cross-tenant access, role escalation, double submit, replay, overpayment, prompt injection.

## 3. Data classification

| Class | Examples | Controls |
|---|---|---|
| Financial | invoices, payments, balances | `invoices.*`/`payments.*` permissions; issued records immutable; void/reverse only; payments via RPC only |
| Bank details | `organisation_financial_settings.bank_*` | settings, quotes or invoices readers only; never field agents |
| Customer personal data | names, phones, emails, sites | `customers.read`; field agents only through `get_field_job` for their assigned jobs |
| Internal notes | `jobs.internal_notes` | not column-readable via the API; office staff use `get_job_internal_notes` |
| Documents and photos | PDFs, job photos | private buckets, `{organisation_id}/…` paths, signed URLs ≤ 5 min |
| Secrets | Supabase secret key, AI provider keys | server-only environment variables (Vercel Sensitive); never `NEXT_PUBLIC_` |

## 4. Tenant tables — required pattern

```sql
alter table public.<t> enable row level security;
revoke all on public.<t> from anon, authenticated;
grant select, insert, update on public.<t> to authenticated;          -- only what is needed; no delete on records
create policy <t>_select on public.<t> for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('<module>.read')));
create policy <t>_write on public.<t> for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('<module>.write')));
```

Also required:
- a guard trigger: `organisation_id` is immutable; status changes only through RPCs;
- an audit trigger;
- tests in `supabase/tests/`: cross-organisation select / insert / update / delete denial, a per-role
  matrix, and anon lockout.

Platform invariants are enforced by `supabase/tests/security_invariants.test.sql`:
- RLS on every public table;
- anon can execute nothing and holds no table privileges;
- every definer function pins `search_path`;
- privileged functions match §5 exactly;
- no public buckets;
- payments, invoices, quotes and the activity log cannot be deleted or edited directly.

## 5. Privileged function register

These are the `SECURITY DEFINER` functions callable by signed-in users. A definer function that is not on this list
fails `security_invariants.test.sql`. Every function pins `search_path = ''` and checks permissions itself.

| Function | Why definer | Internal check |
|---|---|---|
| `create_organisation` | inserts the first owner membership for a new organisation (no client path can) | caller becomes owner of the NEW org only; per-user org limit |
| `issue_quote`, `set_quote_outcome`, `duplicate_quote` | state transitions and snapshots behind guard flags | `lock_quote_for` → `quotes.read` + `quotes.issue`/`write` for that org |
| `issue_invoice`, `void_invoice`, `archive_invoice` | numbering at issue, snapshots incl. bank details, guarded transitions | `lock_invoice_for` → `invoices.read` + `invoices.issue`/`write` |
| `record_payment`, `void_payment` | payments table is not client-writable; balance update in one transaction | `payments.record`; overpayment rejected; idempotency key bound to one invoice |
| `set_job_status` | guarded job transitions | `jobs.write`, or `jobs.work` on an assigned job |
| `get_field_job`, `list_my_jobs` | field agents get minimal customer/site/contact data without table access | assignment (or `jobs.read_all`); no financial fields returned |
| `get_job_internal_notes` | the column is not API-readable | `jobs.read_all` |
| `ai_usage_summary` | reads metering tables that have no client policies | membership + `ai.usage_read` |
| `app_private.has_permission`, `org_ids_with_permission`, `my_org_ids`, `is_active_member`, `active_owner_count`, `visible_profile_ids`, `my_assigned_job_ids`, `can_access_job`, `linked_customer_ids` | RLS helper predicates (avoid recursive RLS) | read-only; scoped to `auth.uid()` |
| `app_private.next_document_number` | row-locked sequence update | the matching write/issue permission for that document type |

`app_private` is not exposed by PostgREST; grants there exist only for RLS predicates and invoker code paths.

## 6. Release gate and drift

### 6.1 Gates

- **Vercel build:** `prebuild` runs `vitest run`. The unit tests include `tests/unit/security-static.test.ts`:
  secret patterns in tracked files, `NEXT_PUBLIC_` secrets, service-role use, client imports, and migrations
  that disable RLS, open buckets or grant to anon. A failure stops the production build.
- **GitHub Actions** (`.github/workflows/security.yml`): typecheck, lint, unit tests, and the full database suite.
  That suite covers RLS/tenancy, invariants, concurrency, money parity and the security baseline.

### 6.2 Drift

- `supabase/security-baseline.txt` is the reviewed snapshot of security configuration. It covers RLS flags,
  policies, table and column grants, function execute rights, `search_path` and buckets.
- `npm run test:db` fails when the migrations produce anything different. After a reviewed change, run
  `npm run security:baseline` and commit the new file with the migration.
- `npm run security:drift` compares a LIVE database (`SUPABASE_DB_URL`, read-only role) with the baseline.
  It runs in CI when the `SUPABASE_DB_URL_READONLY` secret is set.
- The local test shim mirrors hosted Supabase grants: auto-execute applies only to the `public` schema.

### 6.3 One-time manual settings (owner)

- [ ] Vercel → Project → Settings → **Deployment Checks**: require `security-gate` before production promotion.
- [ ] GitHub → Settings → Branches: protect `main` and require the `security-gate` check.
- [ ] Supabase → Auth → **Leaked password protection**: on.
- [ ] Supabase plan with backups/PITR before real customer or financial data.
- [ ] Optional: add `SUPABASE_DB_URL_READONLY` (read-only role) as a GitHub Actions secret for live drift checks.

## 7. AI

- Tools call the same domain services as the UI, under the user's RLS-scoped client; tools are offered only when
  the user holds their permissions.
- **Consequential tools need confirmation of the exact input**, and the confirmation is claimed atomically so it
  runs once. These are:
  - issue, accept or decline a quote;
  - complete a job;
  - issue or void an invoice;
  - record a payment;
  - send a message;
  - archive a customer.
- Tools that cannot run (no channel connected) are refused before any confirmation.
- Prompts carry minimal data. Tool results and stored context are framed as data, never instructions. Amounts come
  from the database; the model passes user-stated amounts through and never calculates.
- Metering, budgets (US$1 soft / US$2 hard), rate limits and the model allowlist are enforced server-side.

## 8. Secrets

- Vercel Sensitive environment variables only; `.env.local` is git-ignored; `.env.example` holds names, not values.
- Never paste secrets into chat, issues or AI prompts. If one is exposed, revoke it immediately and record it below.

### Incident log

| Date | What | Action |
|---|---|---|
| 2026-10-16 | Fine-grained GitHub token (scope: Contents RW, repo `veritaro-sap`, 7 days) pasted into an AI chat to unblock a push | Owner to delete the `veritaro-push` token; future pushes via repository authorisation |
