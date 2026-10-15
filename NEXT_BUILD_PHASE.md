# Next build phase

**Phase 002 (Customers + AI assistant) is complete.** Phase 003 scope will be supplied separately; nothing has been started.

## Phase 002 delivered
- Customers, contacts, site addresses; duplicate detection; tasks linked to customers; activity per customer.
- Provider-agnostic AI gateway (**OpenAI GPT-6 Luna active** since the 2026-10-15 decision; Anthropic + self-hosted disabled), metering and limits, READ/DRAFT/CONSEQUENTIAL flow with confirm/undo, AI usage page.

## Known limitations / open items
- Field agents see the full record of linked customers.
- A user could send the AI header themselves; the action is still attributed to them (`actor_user_id`), only `actor_type` changes.
- Hard ceiling can overshoot by one in-flight estimate.
- Customer pickers capped at 200 entries (search to narrow).
- Fallback/premium providers and automatic routing disabled by design.
- AI evaluation suite planned, not built (`docs/AI_EVALUATION.md`).
- Carried from Phase 001: email invitations, Storage buckets, viewer `money.access` review, leaked-password protection.
