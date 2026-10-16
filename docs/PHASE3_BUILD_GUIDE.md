# Phase 003 build guide (engineering conventions)

Binding conventions for every Phase 003 module. Read this before writing code.

## Product
Veritaro is an SME operating system for service businesses (cleaning, pest control, handymen, small contractors) in South Africa.
Users are owners, not accountants. Screens must be simple, mobile-friendly, honest, and fast. Lifecycle:
Enquiry → Lead → Customer → Quote → Accepted → Job → Completed → Invoice → Payment. Information entered once flows forward.

## The database is done and authoritative
Migrations `supabase/migrations/20261016000200…700` are APPLIED in production. **Do not edit migrations or add new ones.**
If you believe the DB is wrong or missing something, stop and report it in your final message with the exact SQL you'd propose.
Read the migration for your module first — column names, constraints, RPC signatures and error messages are all there.
Generated types: `src/types/database.types.ts` (`Tables<"quotes">`, RPCs via `supabase.rpc("issue_quote", {...})`).
Note: generated RPC arg types mark SQL-defaulted args optional and do NOT allow `null`; pass `undefined` to omit, or cast `null as unknown as string` only where the SQL needs an explicit null.

Key DB behaviours you must rely on (never re-implement them in TS):
- Money is `numeric(14,2)`; Supabase returns numbers. Totals are computed by triggers. NEVER compute stored totals in TS.
  For live previews in builders use `src/lib/money-calc.ts` (exact mirror of SQL; pass decimal strings).
- Numbering (Q-0001, J-0001, INV-0001) is done by the DB. Invoices get a number only when issued.
- State transitions ONLY via RPCs: `issue_quote`, `set_quote_outcome`, `duplicate_quote`, `create_job_from_quote`, `set_job_status`,
  `create_invoice_from_job`, `create_invoice_from_quote`, `issue_invoice`, `void_invoice`, `archive_invoice`, `record_payment`, `void_payment`,
  `convert_lead_to_customer`, `log_communication`. Direct status updates are rejected by guard triggers.
- Snapshots (seller/customer/tax) are taken by the issue RPCs. PDFs render from snapshots for issued docs.
- Derived statuses: quote `expired`, invoice `overdue` — use `effectiveQuoteStatus` / `effectiveInvoiceStatus` from `src/lib/status.ts`.
- RLS is the security boundary. Always also filter `.eq("organisation_id", ctx.organisationId)`.

## Layering (same as Phase 002 customers — copy that pattern)
- `src/domain/<module>/schema.ts` — zod v4 input schemas + label maps. `src/domain/<module>/service.ts` — functions taking
  `ServiceContext` (from `src/domain/context.ts`), returning `ActionResult<T>` (`ok`/`fail` from `src/lib/errors.ts`).
  Log with `logServerError("module.op", error)`, return `fail(toUserMessage(error, "We couldn't …"))`.
  Services are the single implementation used by screens AND AI tools — keep them UI-free.
- `src/app/app/<area>/<module>/actions.ts` — `"use server"` thin adapters: `getServiceContext()` → service → `revalidatePath`.
- Pages are RSC: `getServiceContext()`, `requireAppContext()` (org timezone/currency/permissions), wrap in `<ModuleGate permission=…>`.
- Client components in `src/components/<module>/`.
- Reference implementation: `src/domain/customers/*`, `src/app/app/sales/customers/*`, `src/components/customers/*`.

## UI kit (reuse, don't reinvent)
`PageHeader`, `Section` (`components/common/page-header`), `EmptyState`, `ErrorState`, `ModuleGate`, `FormField`,
`Input`/`Select`/`Textarea`/`Label` (`components/ui/input`), `Button` (variants primary/secondary/ghost/outline/danger/link; sizes sm/md/lg/icon),
`Dialog`/`DialogContent`/`SheetContent` (`components/ui/dialog`), `ConfirmationDialog` (REQUIRED for consequential actions),
`EntityStatus` (`components/common/entity-status`) for ALL status badges, `TabsNav` (`components/common/tabs-nav`),
`ActivityFeed` (`components/today/activity-feed`), `MoneyDisplay`/`formatMoney` (`lib/money` — takes a decimal STRING; use `amount.toFixed(2)`),
dates in `lib/dates`, toasts via `sonner`, icons `lucide-react`. Tailwind v4 tokens: bg-surface, bg-surface-raised, border-border,
text-muted-foreground, text-primary, bg-muted, text-danger, bg-warning-soft, etc. Look at existing components for the look.

## Forms
Validate with the same zod schema client- and server-side; show field errors inline; keep user input on error;
disable submit while pending (`useTransition`) to prevent double submit; sensible defaults; minimal required fields;
large tap targets on mobile (`h-10`+), single-column on small screens.

## Honesty rules (hard)
- No fake data, no seeded demo rows, no simulated inbound messages.
- No channel (email/WhatsApp) is connected in this phase. "Send" means: Download PDF / Mark as sent manually.
  Show "Send through connected channel" disabled with "No channel connected yet".
- Consequential actions (issue, accept, decline, void, record payment, complete job) need explicit confirmation UI.
- Never hard-delete business records. Archive / void / cancel.

## Permissions (central keys in `src/lib/permissions/keys.ts`)
leads.read/write, inbox.read/write, quotes.read/write/issue, jobs.read_all/read_assigned/write/work,
invoices.read/write/issue, payments.read/record, customers.read/create/update/archive, tasks.*, activity.read, ai.use.
Field agents: `jobs.read_assigned` + `jobs.work` only — they cannot read customers/quotes/invoices tables at all;
they get job customer info ONLY via `get_field_job(job)` / `list_my_jobs(org, from, to)` RPCs. Hide UI the user can't use.

## Files you must NOT edit (owned by the integrator)
`src/lib/navigation.ts`, `src/lib/errors.ts`, `src/lib/status.ts`, `src/lib/money-calc.ts`, `src/lib/permissions/*`,
`src/types/database.types.ts`, `src/components/shell/*`, `src/lib/ai/*`, `src/domain/activity/*`, `src/components/customers/*`,
`src/app/app/today/*`, migrations, package.json (no new dependencies without asking — `@react-pdf/renderer` is installed).
If you need a change there, list it in your final report.

## Verification before you finish
- `npx tsc --noEmit 2>&1 | grep -E "<your paths>"` must be empty (other modules are being built in parallel; ignore their errors).
- `npx eslint <your paths>` clean.
- Unit tests for your schemas/pure logic in `tests/unit/<module>.test.ts`; `npx vitest run tests/unit/<module>.test.ts` green.
- Do NOT run `next build`, `next dev`, or start servers (the integrator runs build and E2E). Do NOT touch the hosted Supabase project.
- A local Postgres with the full schema is at `psql -h /tmp -p 54329 -U postgres -d veritaro_test` if you need to inspect SQL behaviour (read-only use; tables are emptied by tests).
- Final message: files created, routes, service function signatures (others will call them, e.g. AI tools), anything you couldn't do, any DB issues found.
