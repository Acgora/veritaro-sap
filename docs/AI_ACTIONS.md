# AI action classification

Files: `src/lib/ai/types.ts` (classes & contracts), `registry.ts` (tools), `executor.ts` (enforcement), `command-service.ts` (natural-language entry), `tools/*.ts`.

## Classes

| Class | Examples | Rule |
|---|---|---|
| **READ** | "How much does ABC owe?", list open tasks | Executes without confirmation. |
| **DRAFT** | create draft quote/invoice, create task, record expense | Executes without confirmation, but must **never send, post or finalise**. Output is reviewable. |
| **CONSEQUENTIAL** | send invoice/email/WhatsApp, delete transaction, issue credit note, modify posted financial records | **Always** returns `needs_confirmation` first. Executes only with a `ConfirmationGrant` whose input fingerprint matches the exact validated input and whose `confirmedByUserId` is the current user. |

Autonomous consequential actions are prohibited.

## Executor pipeline (`executeTool`)

```
tool exists? ──no──► unknown_tool / not_implemented (planned tools)
input valid (zod)? ──no──► invalid_input
user holds requiredPermissions? ──no──► denied
class requires confirmation and no matching grant? ──► needs_confirmation {summary, inputFingerprint}
execute(ctx with actor='ai') → domain service → RLS/guards/audit as usual
```

Tools **must** call domain services (e.g. `create_task` → `createTask`). They inherit validation, permission checks, RLS and DB-side activity logging.

## Current state (Phase 002)

Registered tools: READ `search_customers`, `get_customer`, `list_open_tasks`; DRAFT `create_customer` (duplicate check first), `update_customer`, `add_contact`, `add_site_address`, `create_task` (optional `customerId`), `complete_task`; CONSEQUENTIAL `archive_customer`.

CONSEQUENTIAL calls are stored in `ai_actions` as `needs_confirmation`; the user clicks Confirm, the server re-parses the stored input and executes with a fingerprint grant (expires after 30 min). Cancel marks it cancelled. DRAFT results render as cards with Undo.

**Attribution:** AI writes run through `createAIClient()` which adds the `x-veritaro-actor: ai` header; `app_private.request_actor_type()` reads it and `log_activity` records `actor_type = 'ai'` with the real user as `actor_user_id`. Customers created by AI get `source = 'ai'`.

## AI gateway (provider-agnostic)

Files: `src/lib/ai/gateway/*`, `src/lib/ai/orchestrator.ts`, migration `20261015000200_ai_gateway.sql`.

- **Server-side allowlist** (`allowlist.ts`) is the only list of callable providers/models. `ai_model_routes` (DB) picks which allowlisted model is active per tier (primary/fallback/premium); a DB value not on the allowlist is refused (`not_allowlisted`).
- **V1 (D9):** primary = `anthropic / claude-haiku-5-5`. Fallback + premium rows exist but are disabled and unconfigured; the OpenAI-compatible adapter is built but has no allowlisted models. `FALLBACK_ENABLED_IN_V1 = false` — customer data is never silently sent to a second provider.
- **Outage:** any provider error returns a polite "assistant unavailable" message; the rest of the app is unaffected.
- **Credentials:** `AI_PROVIDER_ANTHROPIC_KEY` and `SUPABASE_SECRET_KEY` live only in Vercel env (Sensitive). The service key is used only for metering RPCs and route reads.
- **Deterministic logic:** totals, permissions, duplicate detection and all writes are code/DB. The model only picks tools and phrases replies. Context is minimal: last 6 messages, permission-filtered tool list, tool results trimmed to 3,000 chars, max 4 model turns per message, temperature 0.

## Metering & limits (D10)

`ai_begin_request` (row-locks the org-month, checks rate + budget, reserves an estimate) → provider call → `ai_record_usage` (cost computed in the DB from `ai_model_prices`) → `ai_finish_request` (releases reservation, sets soft flag, notifies owners/admins).

| Limit (plan `default`) | Value | Effect |
|---|---|---|
| Soft monthly budget | US$1.00 | flag + log + notification; AI keeps working |
| Hard ceiling | US$2.00 | further billable requests blocked until next month |
| Requests / month | 1,000 | blocked when reached |
| Per user | 30 per 10 min | blocked briefly |

Overrides: `ai_plans` (per plan) and `ai_org_limits` (per organisation). `ai_usage_events` (append-only) stores input/output tokens, provider, model, USD cost, organisation, user, tool/category, timestamp. The hard ceiling can overshoot by at most one in-flight estimate.

Maintenance RPCs (service_role; schedule with pg_cron if wanted): `ai_release_stale_reservations()`, `ai_purge_old_conversations()` (90 days).
