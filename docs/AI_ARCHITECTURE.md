# AI architecture

**Status (locked 2026-10-15):** active provider **OpenAI**, model **GPT-6 Luna** (`gpt-6-luna`), reasoning effort `low`, for *all* AI work. Anthropic and self-hosted providers are built but **disabled**. No fallback, no premium escalation, no automatic routing.

> The current provider/model is a **configuration decision**, not an architectural dependency. Switching is: allowlist entry (code review) + price row + env key + route row. No business logic changes.

## Why provider-agnostic

- Prices, quality and terms change monthly; we benchmark on real SME workflows before choosing (see `AI_EVALUATION.md`).
- POPIA: every provider is a data processor. Adding one must be a deliberate, reviewed decision — never a silent fallback.
- Future high-volume/simple work may move to a cheaper self-hosted open-weight model.

## Layers

```
UI (AI command bar, future WhatsApp/voice/receipts)
  ↓  server actions only — no AI code or keys in the browser
Orchestrator  src/lib/ai/orchestrator.ts      selectTool / executeIntent: tool loop, READ/DRAFT/CONSEQUENTIAL
Capabilities  src/lib/ai/gateway/capabilities.ts   generate() · extract() · classify()
Context       src/lib/ai/context.ts           what the model may see
  ↓
Gateway       src/lib/ai/gateway/gateway.ts   runModel(): route → size cap → reserve budget → call → record → release
Router        src/lib/ai/gateway/router.ts    DB route row ∩ server allowlist → callable route (or a refusal reason)
Allowlist     src/lib/ai/gateway/allowlist.ts providers, status, models, efforts, env key/endpoint names
  ↓
Adapters      providers/openai.ts             OpenAI Responses API        ACTIVE
              providers/anthropic.ts          Anthropic Messages API      DISABLED
              providers/openai-compatible.ts  Chat Completions shape      DISABLED (future self-hosted)
```

Application code imports only neutral types (`gateway/types.ts`). No vendor SDK is installed.

## Model allowlisting (server-controlled)

| Check | Where | Result if it fails |
|---|---|---|
| Provider listed | allowlist | `not_allowlisted` |
| Provider `status: "active"` | allowlist | `provider_disabled` |
| Model listed for that provider | allowlist | `not_allowlisted` |
| Reasoning effort approved for the model (`none/low/medium/high`; `xhigh`/`max` never) | allowlist + DB check | `not_allowlisted` |
| Credential present | env var named by allowlist | `missing_credentials` |
| Endpoint valid (https; http only on loopback; no embedded credentials) | env var named by allowlist | `missing_endpoint` |
| Price row exists | `ai_model_prices` | request blocked `unknown_price` |

The database (`ai_model_routes`) can only **choose among** approved entries. It can never introduce a provider, model or URL. Endpoints and keys are never stored in the database.

## AI is an interpretation layer

The model interprets intent, extracts fields, selects approved tools and phrases replies. **Deterministic code** does everything else:

| Concern | Owner |
|---|---|
| Permissions, tenancy | RLS + `permissions.can()` + executor |
| Validation | zod schemas on every tool input / extraction |
| Duplicates | `find_customer_duplicates` (SQL) |
| VAT, totals, balances, due status | (future) domain functions / SQL — never the model |
| Accounting postings | (future) accounting engine — never the model |
| Dates, scheduling conflicts | deterministic functions |
| Documents | template engine |
| AI cost | `app_private.ai_cost_usd` (numeric, in Postgres) |

Example (future invoice tool): *"Invoice ABC R4,500 plus VAT"* → model emits `{customer:"ABC", items:[{description, amount:4500}], vat:true}` → app resolves the customer, checks permission, validates, **calculates VAT and totals**, creates a **draft**, logs activity. Sending/posting is CONSEQUENTIAL.

## Tool registry & action safety

Registry: `src/lib/ai/registry.ts`, tools in `src/lib/ai/tools/*`. Each tool declares a zod input, permissions, action class, `summarise()` and calls a **domain service** (never raw SQL). Executor enforces: unknown tool → refused; invalid input → refused; missing permission → denied; CONSEQUENTIAL without a fingerprint-matched user grant → `needs_confirmation`.

- **READ** executes immediately · **DRAFT** executes, never sends/posts, has Undo · **CONSEQUENTIAL** stored in `ai_actions`, runs only after the user clicks Confirm (30-min expiry, input re-validated from the stored row, not the client).
- Only tools the user may run are offered to the model.

## Data minimisation & context

- Model gets: user first name, org name, timezone, currency, date, **current screen entity** (id + name, re-verified through RLS — the browser pathname is only a hint), last 6 messages of this conversation, permitted tool schemas.
- Business data arrives only via tool calls with small result limits; results trimmed to 3,000 chars.
- Prompt hard cap 20K tokens per call; max 4 model turns per message.
- OpenAI requests use `store: false` and carry no user identifiers.
- Reserved for later: rolling conversation summary (slot in `context.ts`).

## Usage metering & limits

Every model call: `ai_begin_request` (row-locked per org-month; checks permission, enabled, rate, monthly requests, hard ceiling, known price; reserves an estimate) → provider → `ai_record_usage` → `ai_finish_request`.

`ai_usage_events` (append-only) records organisation, user, provider, model, tier, category, tool, input tokens, **cached** input tokens, output tokens, **reasoning** tokens, cost (numeric 14,8), latency, outcome (`ok/error/timeout/provider_unavailable`), timestamp. Prices are dated rows (`effective_from/to`) — never constants in code. Historical rows keep their original provider/model.

| Limit (`ai_plans.default`, override per org in `ai_org_limits`) | Value | Effect |
|---|---|---|
| Soft monthly budget | US$1 | flag + activity log + notify owners/admins; keeps working |
| Hard ceiling | US$2 | blocks further billable requests this month |
| Requests / month | 1,000 | blocks |
| Per user | 30 / 10 min | blocks briefly |

GPT-6 Luna price row: $0.10 input / $0.01 cached / $0.50 output per 1M tokens; >272K-token prompts 2× input, 1.5× output (never reached: 20K cap).

## Failure behaviour

Provider error/timeout → recorded as failed, user sees "AI is temporarily unavailable", nothing else in the app is affected. **No cross-provider fallback** (`FALLBACK_ENABLED_IN_V1 = false`).

## Adding a self-hosted / open-weight model later

1. Deploy an OpenAI-compatible server (vLLM/TGI/Ollama) — infra outside this repo.
2. In `allowlist.ts` → `selfhosted`: approve the model id(s), set `status: "active"`.
3. Vercel env: `AI_PROVIDER_SELFHOSTED_BASE_URL` (https) and `AI_PROVIDER_SELFHOSTED_KEY`.
4. Add an `ai_model_prices` row (0 or amortised hosting cost).
5. Point a route at it. Run the evaluation suite first.

No change to tools, orchestrator, metering, UI or business logic.

## Future routing (prepared, OFF)

`AUTOMATIC_ROUTING_ENABLED_IN_V1 = false`. Intended later: simple/high-volume → self-hosted; normal → GPT-6 Luna; complex → premium tier (`ai_plans.premium_allowed`). Enabled only after evaluation.

## Future channels (not built)

- **Voice notes (WhatsApp):** voice → speech-to-text → `handleAssistantMessage` (same tools, same confirmations). No realtime voice.
- **Receipts:** image → `extract()` with a receipt zod schema → deterministic expense validation → **expense draft** → user/authorised workflow → accounting engine. Vision/LLM never posts transactions.

## Credentials

`AI_PROVIDER_OPENAI_KEY`, `SUPABASE_SECRET_KEY` — Vercel Sensitive env vars, server-only (`import "server-only"`), never `NEXT_PUBLIC_`, never in DB, logs, prompts or GitHub. Provider error bodies are never shown or logged (they can echo input).
