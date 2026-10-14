# Next build phase

**Phase 002 is expected to implement the Customer/Contact foundation.**

The detailed specification will be supplied separately. No Phase 002 scope has been decided or built.

## Phase 001 surfaces Phase 002 should build on

- `docs/ADDING_A_MODULE.md` — checklist + activity logging pattern (Tasks is the reference).
- `docs/RLS_STRATEGY.md` — policy template; `supabase/tests/rls.test.sql` — add isolation tests.
- `src/domain/tasks/*` — service/schema pattern; `src/domain/context.ts` — `ServiceContext`.
- `src/lib/navigation.ts` — `/app/sales/customers` route and the Quick Create "Customer" entry exist as placeholders (`live: false`).
- `tasks.related_entity_type/id` — add `customer` as a validated target.
- `src/lib/ai/registry.ts` — `create_customer` is already classified as DRAFT (planned).
- `docs/DATABASE.md` conventions — lifecycle FKs (customers → quotes → jobs → invoices).

## Open items carried from Phase 001 (decide when relevant)

- Member invitations by email (needs custom SMTP + an invite flow).
- AI actor attribution in `activity_log` (see `docs/AI_ACTIONS.md` §5).
- Supabase Storage buckets (avatars, logos, receipts) — path convention `<organisation_id>/<module>/<uuid>` with policies using `app_private.org_ids_with_permission`.
- Viewer `money.access` mapping review (see `docs/PERMISSIONS.md`).
