-- =============================================================================
-- Phase 001 · Migration 5: Harden function privileges
-- Finding (Supabase hosted): platform-wide default privileges grant EXECUTE on new
-- functions to anon/authenticated in every schema. anon has no USAGE on app_private
-- so this was not exploitable, but we remove it for defence in depth.
-- Trigger functions do not need EXECUTE grants (checked at CREATE TRIGGER time).
-- =============================================================================

revoke execute on all functions in schema app_private from anon, authenticated, public;

-- Only the helpers referenced inside RLS policies / guard triggers need EXECUTE for the API role.
grant execute on function
  app_private.my_org_ids(),
  app_private.org_ids_with_permission(text),
  app_private.has_permission(uuid, text),
  app_private.is_active_member(uuid, uuid),
  app_private.visible_profile_ids(),
  app_private.active_owner_count(uuid),
  app_private.is_client_role()
to authenticated;

-- member_role() is unused by policies; keep it server-side only.
revoke execute on function app_private.member_role(uuid) from authenticated;

-- get_my_permissions only reads rows the caller can already see → no need for SECURITY DEFINER.
alter function public.get_my_permissions(uuid) security invoker;
