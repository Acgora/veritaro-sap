# Local setup, environment & migrations

## Requirements
Node ≥ 20.18, npm. Optional: Supabase CLI + Docker for a full local stack; PostgreSQL 15+ client for `npm run test:db`.

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | `https://zqibpgbbchypqqyopxoh.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | `sb_publishable_…` from Supabase → Settings → API. Safe to expose; RLS protects data |
| `NEXT_PUBLIC_SITE_URL` | server | used for auth email redirects |
| `SUPABASE_SECRET_KEY` | **server only** (Vercel Sensitive) | AI metering RPCs + route reads only. Never `NEXT_PUBLIC_` |
| `AI_PROVIDER_OPENAI_KEY` | **server only** (Vercel Sensitive) | OpenAI API key (active provider). Without it (or the secret key) the assistant says it is unavailable; the rest of the app works |
| `AI_PROVIDER_OPENAI_BASE_URL` | server, optional | tests point this at `tests/e2e/mock-openai.mjs` |
| `AI_PROVIDER_ANTHROPIC_KEY` | not required | Anthropic is disabled; key ignored |
| `AI_PROVIDER_SELFHOSTED_BASE_URL` / `_KEY` | not used yet | future self-hosted model (see AI_ARCHITECTURE.md) |

`.env.local` is git-ignored; `.env.example` is committed.

## Supabase Auth settings (dashboard, one-time)
Authentication → URL Configuration:
- **Site URL:** your deployed URL (e.g. `https://app.veritaro.co.za`)
- **Redirect URLs:** `http://localhost:3000/**` and `https://<your-domain>/**`
Email confirmation is ON by default (recommended). The default Supabase mailer is rate-limited and only for testing — configure custom SMTP before real users sign up.

## Migration workflow
Schema changes are **only** made through files in `supabase/migrations/` (timestamped, never edited after being applied).

```bash
# create
supabase migration new <name>          # or add YYYYMMDDHHMMSS_<name>.sql by hand
# test locally (throwaway DB, no Docker needed)
PGHOST=... PGPORT=... PGUSER=... npm run test:db
# apply to hosted project
supabase link --project-ref zqibpgbbchypqqyopxoh
supabase db push
# regenerate types
npm run db:types
```
Production rollbacks are **forward-fix migrations**. `supabase/rollbacks/*.down.sql` is for dev resets only.

Free-plan note: no automatic backups / PITR. Upgrade (Pro) before storing real customer or financial data.

## Tests
- `npm test` — unit tests.
- `npm run test:db` — migrations + 87-assertion RLS/tenancy suite on plain Postgres (uses `supabase/tests/supabase_shim.sql` to emulate `auth.uid()`, API roles and Supabase default grants).
- `npm run test:e2e` / `test:e2e:roles` — Playwright against a running app. Point the app at a **local or branch** Supabase stack with email auto-confirm, then:
  ```bash
  E2E_REGISTER=1 E2E_BASE_URL=http://localhost:3000 E2E_EMAIL=erin@example.test E2E_PASSWORD='…' npm run test:e2e
  E2E_BASE_URL=http://localhost:3000 npm run test:e2e:roles      # needs dev seed
  ```
  Never run E2E against production.

## Development seed (dev only)
```bash
psql "$DEV_DATABASE_URL" -v allow_dev_seed=on -f supabase/seed/dev_seed.sql    # load
psql "$DEV_DATABASE_URL" -v allow_dev_seed=on -f supabase/seed/dev_reset.sql   # remove (only seed rows)
```
The seed refuses to run without the flag and refuses to run if the database contains any non-seed users. Demo users: `owner@ / admin@ / accountant@ / supervisor@ / field@ / viewer@ / other@seed.veritaro.test`, password `DevPassw0rd!`. Demo rows are prefixed `[Demo]`.

## Deploying the app
Supabase hosts the database, not the Next.js app. Recommended: push the repo to GitHub, import into Vercel, set the three `NEXT_PUBLIC_*` env vars, then add the Vercel URL to Supabase Redirect URLs.

## End-to-end tests (Phase 002)

`tests/e2e/phase2.mjs`, `smoke.mjs`, `roles.mjs` run against a local stack (Postgres + GoTrue + PostgREST + a small gateway) and a mock OpenAI Responses server (`node tests/e2e/mock-openai.mjs`; `AI_PROVIDER_OPENAI_BASE_URL=http://127.0.0.1:54400`, key `mock-key`). The mock rejects requests that send `temperature`, omit `store:false` or use an unapproved model/effort. `smoke.mjs` needs `E2E_REGISTER=1` on a fresh email. They never call a real model.
