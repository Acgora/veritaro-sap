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

## AI gateway, providers, metering

See **`docs/AI_ARCHITECTURE.md`** (locked decision 2026-10-15: OpenAI GPT-6 Luna active; Anthropic + self-hosted disabled; no fallback; no automatic routing) and `docs/AI_EVALUATION.md`.

## Phase 003

See [PHASE_003.md](./PHASE_003.md) for the lifecycle, tables, state machines, numbering, snapshots, tax rules, permissions, storage, PDFs, follow-up rules and AI tools added in Phase 003.
