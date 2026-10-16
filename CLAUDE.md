# Veritaro — instructions for AI engineers

Read `SECURITY.md` before implementing anything. It is authoritative and part of the Definition of Done.

- Migrations only via `supabase/migrations/` (additive; hosted Supabase MCP times out on DROP). Never edit an applied migration.
- After a reviewed security-relevant migration: `npm run security:baseline` and commit `supabase/security-baseline.txt`.
- Done = `npm run typecheck && npm run lint && npm test && npm run test:db && npm run build` all green, plus E2E for UI flows.
- Phase docs: `docs/PHASE_003.md`, `docs/PHASE3_BUILD_GUIDE.md`.
