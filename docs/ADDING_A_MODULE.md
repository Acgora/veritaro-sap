# Adding a module (Tasks is the reference implementation)

Checklist — follow in order:

1. **Migration** `supabase/migrations/<timestamp>_<module>.sql`
   - table with `organisation_id not null references organisations on delete cascade`, timestamps, checks, indexes (`(organisation_id, …)`)
   - `set_updated_at` trigger
   - guard trigger (immutable `organisation_id`, server-owned fields, cross-org reference validation)
   - audit trigger (see pattern below)
   - grants + RLS per the template in `RLS_STRATEGY.md`
   - permissions: insert keys + role mappings
2. **Tests** in `supabase/tests/rls.test.sql`: other-org read/insert/update/delete denied; each role's allowed/denied actions.
3. **Types:** `npm run db:types`.
4. **Domain:** `src/domain/<module>/schema.ts` (zod) + `service.ts` (functions taking `ServiceContext`, returning `ActionResult`, early permission checks, `toUserMessage` on errors, always `.eq("organisation_id", ctx.organisationId)`).
5. **Server actions:** `src/app/app/<area>/<module>/actions.ts` — adapters only.
6. **UI:** page (server) + client components using `PageHeader`, `EmptyState`, `ErrorState`, `StatusBadge`, `ConfirmationDialog`, `FormField`; `loading.tsx` if needed. Handle loading / empty / error / success.
7. **Navigation:** flip `live: true` in `src/lib/navigation.ts` (nav child + Quick Create item).
8. **AI tool (optional):** `src/lib/ai/tools/<module>.ts` calling the service; classify; register; unit test.
9. **Unit tests** for the service and schema.

## Activity logging pattern

Log in the **database**, not the app:

```sql
create or replace function app_private.audit_<module>()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.organisation_id, '<entity>_created', '<entity>', new.id,
      jsonb_build_object('name', new.name));            -- small, non-secret summary only
  elsif tg_op = 'UPDATE' then
    -- compute changed column NAMES (not values) like audit_tasks
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.organisations o where o.id = old.organisation_id) then
      perform app_private.log_activity(old.organisation_id, '<entity>_deleted', '<entity>', old.id, '{}');
    end if;
  end if;
  return coalesce(new, old);
end $$;
```

Rules: action names `snake_case` `<entity>_<verb>`; metadata holds identifiers and short labels, **never** secrets, tokens, full message bodies or bank details; add a sentence to `src/domain/activity/describe.ts`.
