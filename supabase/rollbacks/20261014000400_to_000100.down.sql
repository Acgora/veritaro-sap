-- Rolls back ALL Phase 001 migrations (000100–000400). DESTROYS DATA.
-- Only for development resets. Production rollbacks must be forward-fix migrations.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.create_organisation(text, text, text, text, text, text, text, text);
drop function if exists public.get_my_permissions(uuid);
drop function if exists public.mark_notifications_read(uuid, uuid[]);
drop table if exists public.tasks, public.notifications, public.activity_log,
  public.organisation_settings, public.organisation_members, public.organisations,
  public.role_permissions, public.permissions, public.roles, public.profiles cascade;
drop schema if exists app_private cascade;
