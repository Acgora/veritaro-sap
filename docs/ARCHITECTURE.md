# Architecture

## Principles

1. **One implementation per business action.** UI forms, Quick Create, ⌘K and AI tools all call the same domain service (`src/domain/<module>/service.ts`). There is no separate "AI version" of any logic.
2. **The database is the security boundary.** RLS + guard triggers enforce tenancy and roles. UI permission checks exist only for UX (hiding buttons, friendly errors).
3. **The database writes the audit trail.** Activity is logged by triggers, so no caller can forget or skip it.
4. **Honest UI.** Unbuilt modules show "coming in a later build phase" screens. No fake numbers, no fake AI responses, no fake records.
5. **Money is never a float.** See `ACCOUNTING_ARCHITECTURE.md`.

## Layers

```
Browser ─┬─ Client components (src/components/**)       presentation + local state only
         │
Server ──┼─ Server actions (src/app/**/actions.ts)        thin adapters: build ServiceContext → call service → revalidate
         ├─ Server components (src/app/**/page.tsx)       data loading via services, Suspense streaming
         ├─ AI executor (src/lib/ai/executor.ts)          tool → validate → permission → safety class → service
         │
Domain ──┼─ src/domain/<module>/schema.ts                 zod validation (shared by UI + AI)
         ├─ src/domain/<module>/service.ts                business logic; takes ServiceContext; returns ActionResult
         │
Data ────┴─ Supabase (Postgres + RLS + triggers)          tenancy, permissions, audit, invariants
```

`ServiceContext` (`src/domain/context.ts`) = `{ supabase, organisationId, userId, permissions, actor }`. Services never read cookies or headers, so the same function runs for a web request, an AI tool call, or (later) a WhatsApp webhook.

## Folder structure

```
src/
  app/
    (auth)/login, register           sign-in / sign-up (server actions)
    auth/callback                     email-confirmation PKCE exchange
    onboarding/                       first-run organisation creation
    app/                              authenticated shell (layout loads context once)
      today/                          Today screen
      work/tasks/                     Tasks — the reference module
      settings/{organisation,members,profile,preferences}
      sales|work|money/...            module overviews + future-module placeholders
      new/[entity]                    honest Quick Create targets for unbuilt entities
      actions.ts                      shell actions: switch org, notifications, sign out, ask AI
  components/
    ui/                               primitives (Button, Input, Select, Dialog/Sheet, DropdownMenu, Skeleton)
    common/                           PageHeader, Section, EmptyState, ErrorState, StatusBadge, MoneyDisplay,
                                      UserAvatar, FormField, ConfirmationDialog, DataTable, ComingSoon, ModuleGate
    shell/                            AppShell, Sidebar, TopBar parts, OrganisationSwitcher, NotificationMenu,
                                      UserMenu, QuickCreate, CommandPalette (⌘K), AICommandBar/AskDialog, MobileNavigation
    today/  tasks/  settings/         feature components
  domain/                             business logic per module (tasks, organisations, members, profiles, activity, notifications)
  lib/
    supabase/{server,client,middleware}.ts
    context.ts                        requireUser / requireAppContext (request-cached)
    service-context.ts                builds ServiceContext for the current request
    permissions/                      permission keys + PermissionSet
    ai/                               action types, registry, executor, command service, tools/
    navigation.ts                     nav + Quick Create registries
    errors.ts  dates.ts  money.ts  routes.ts  env.ts  utils.ts
  types/database.types.ts             generated from Supabase
supabase/
  migrations/                         ordered, committed SQL (source of truth for schema)
  rollbacks/                          dev-only down scripts
  seed/                               dev-only seed + reset
  tests/                              shim + RLS suite + runner
tests/unit  tests/e2e
```

## Request flow (example: create task)

1. `TaskForm` (client) → `createTaskAction(input)` (server action).
2. Action calls `getServiceContext()` → validates session, resolves active organisation **from real memberships** (the cookie is only a preference), loads permissions via `get_my_permissions`.
3. `createTask(ctx, input)` validates with zod, checks `tasks.create` / `tasks.assign` for a friendly error, inserts with `organisation_id = ctx.organisationId`.
4. Postgres: RLS `tasks_insert` checks permission; `tasks_guard` forces `created_by`, validates assignee membership and assign rights; `tasks_audit` writes `task_created` to `activity_log` and a notification for the assignee.
5. Action revalidates `/app/work/tasks` and `/app/today`.

## Navigation

- Desktop: sticky top bar (org switcher, ⌘K search, + New, notifications, user menu), left sidebar, docked AI bar.
- Mobile: bottom nav **Today · Inbox · + · Work · More**; "+" opens the field quick-action sheet; "More" holds remaining modules. Same business logic, different navigation.
- Nav items are filtered by module-access permissions; `ModuleGate` blocks direct URLs server-side.

## Integrations & secrets (future)

- No service-role key exists in the app. If one is ever needed it must live only in server-only modules (`import "server-only"`) and env vars without `NEXT_PUBLIC_`.
- Third-party credentials (WhatsApp, email, model providers) will be stored in **Supabase Vault** (or Edge Function secrets) and used only from Edge Functions / server code. Planned table `integration_connections(organisation_id, provider, status, vault_secret_id, …)` — the secret itself never sits in a readable column.
- Webhooks (WhatsApp/email) will run as Edge Functions using a dedicated, narrowly-granted role and will write `actor_type = 'integration'`.

## Design system

Tokens live in `src/app/globals.css` (`--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--border`, `--success`, `--warning`, `--danger`, radius, fonts) with a dark-mode set. Components use token classes only (`bg-surface`, `text-muted-foreground`…). Rebranding = editing that file.

## Accessibility

Semantic landmarks, skip link, labelled form fields (`FormField` wires `aria-invalid`/`aria-describedby`), Radix dialogs/menus for focus management, `aria-current` on navigation, text labels on all status badges (colour never the only signal), visible focus rings.
