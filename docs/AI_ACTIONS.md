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

## Current state (Phase 001)

- Registered: `create_task` (DRAFT), `list_open_tasks` (READ).
- Planned (classified, not executable): `create_quote`, `create_invoice`, `record_expense`, `create_customer`, `schedule_job`, `search_messages`, `send_whatsapp`, `send_email`, `send_invoice`, `generate_document`, `get_cashflow`, `get_outstanding_invoices`.
- **No language model is connected.** `handleCommand()` returns `unavailable` and the UI says so. Nothing is faked.

## Adding the model (future phase)

1. Server-only provider key (`ANTHROPIC_API_KEY`/similar, never `NEXT_PUBLIC_`).
2. `handleCommand` sends the message + `AI_TOOLS` JSON schemas to the model; model returns tool calls; each goes through `executeTool`.
3. `needs_confirmation` → render `ConfirmationDialog` with `summary`; on approve, re-call with the grant.
4. Persist conversations/actions in `ai_conversations`, `ai_messages`, `ai_actions(organisation_id, tool, action_class, input, status, confirmed_by, executed_at, result_ref)`.
5. **Attribution:** set `actor_type = 'ai'` in `activity_log`. Postgres reads `current_setting('app.actor_type')`; because PostgREST runs each request in its own transaction, the AI path should call domain writes through RPCs that set `set_config('app.actor_type','ai',true)` first (or read a request header via `current_setting('request.headers')`). Not wired yet — today AI-originated writes would log as `user`.
