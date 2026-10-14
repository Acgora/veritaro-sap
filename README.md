# Veritaro — SME Business Operating System

AI-first operating headquarters for small service businesses (cleaning, pest control, handymen, small construction, delivery).

**Status:** Build Phase 001 — foundation, architecture & app shell. See [`NEXT_BUILD_PHASE.md`](NEXT_BUILD_PHASE.md).

| | |
|---|---|
| Frontend | Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Radix primitives · cmdk · sonner |
| Backend | Supabase (Postgres 17, Auth, RLS, Storage) — project `veritaro-sap` (`zqibpgbbchypqqyopxoh`, eu-west-2 London) |
| Tests | Vitest (unit) · SQL RLS suite (87 assertions) · Playwright E2E smoke + role tests |

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in the publishable key (Supabase → Settings → API)
npm run dev                      # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run check` | typecheck + lint + unit tests + production build |
| `npm test` | unit tests (permissions sync, AI safety, task service, validation, routes) |
| `npm run test:db` | applies all migrations to a throwaway Postgres and runs the tenancy/RLS suite (needs `PGHOST/PGPORT/PGUSER`) |
| `npm run test:e2e` | browser smoke test against a running app (see `docs/LOCAL_SETUP.md`) |
| `npm run db:types` | regenerate `src/types/database.types.ts` from the live schema |

## Documentation

- [Architecture & folder structure](docs/ARCHITECTURE.md)
- [Database structure](docs/DATABASE.md)
- [RLS strategy](docs/RLS_STRATEGY.md)
- [Roles & permissions](docs/PERMISSIONS.md)
- [AI action classification](docs/AI_ACTIONS.md)
- [Accounting architecture constraints](docs/ACCOUNTING_ARCHITECTURE.md)
- [Adding a module (incl. activity logging pattern)](docs/ADDING_A_MODULE.md)
- [Local setup, env vars, migrations, seed](docs/LOCAL_SETUP.md)
