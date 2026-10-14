-- =============================================================================
-- Phase 001 · Migration 3: Role & permission reference data
-- This is REFERENCE data required in every environment (not demo data).
-- Keep src/lib/permissions/keys.ts in sync (enforced by tests/sql/rls.test.sql).
-- =============================================================================

insert into public.roles (key, label, description, rank) values
  ('owner',       'Owner',       'Full organisation access, including ownership-level actions.',                1),
  ('admin',       'Admin',       'Full operational access. Cannot perform ownership-level actions.',            2),
  ('accountant',  'Accountant',  'Financial and accounting access, plus read access to customers/suppliers.',   3),
  ('supervisor',  'Supervisor',  'Jobs, schedules, work-related customers, photos, notes and expenses.',        4),
  ('field_agent', 'Field agent', 'Assigned work, own timesheets, job photos/notes, expense/receipt submission.', 5),
  ('viewer',      'Viewer',      'Read-only access to permitted business information.',                        6);

insert into public.permissions (key, description) values
  -- Organisation
  ('organisation.read',               'View organisation details'),
  ('organisation.update',             'Edit organisation details'),
  ('organisation.delete',             'Delete the organisation'),
  ('organisation.transfer_ownership', 'Grant or remove the owner role'),
  -- Members
  ('members.read',                    'View members and roles'),
  ('members.manage',                  'Add, change role, suspend or remove non-owner members'),
  -- Settings
  ('settings.read',                   'View organisation preferences'),
  ('settings.update',                 'Change organisation preferences'),
  -- Activity
  ('activity.read',                   'View organisation activity history'),
  -- Tasks
  ('tasks.read_all',                  'View all tasks'),
  ('tasks.read_assigned',             'View tasks assigned to or created by me'),
  ('tasks.create',                    'Create tasks'),
  ('tasks.assign',                    'Assign tasks to other members'),
  ('tasks.update_all',                'Edit any task'),
  ('tasks.update_assigned',           'Edit tasks assigned to or created by me'),
  ('tasks.delete',                    'Permanently delete tasks'),
  -- Module access (navigation-level; granular module permissions arrive with each module)
  ('sales.access',                    'Access the Sales module'),
  ('work.access',                     'Access the Work module'),
  ('money.access',                    'Access the Money module'),
  ('team.access',                     'Access the Team module'),
  ('documents.access',                'Access the Documents module'),
  ('business.access',                 'Access the Business module'),
  ('inbox.access',                    'Access the Inbox');

-- Owner: everything.
insert into public.role_permissions (role, permission)
select 'owner', key from public.permissions;

-- Admin: everything except ownership-level actions.
insert into public.role_permissions (role, permission)
select 'admin', key from public.permissions
where key not in ('organisation.delete', 'organisation.transfer_ownership');

insert into public.role_permissions (role, permission) values
  -- Accountant
  ('accountant', 'organisation.read'), ('accountant', 'members.read'), ('accountant', 'settings.read'),
  ('accountant', 'activity.read'),
  ('accountant', 'tasks.read_assigned'), ('accountant', 'tasks.create'), ('accountant', 'tasks.update_assigned'),
  ('accountant', 'sales.access'), ('accountant', 'money.access'), ('accountant', 'documents.access'),
  ('accountant', 'business.access'), ('accountant', 'inbox.access'),
  -- Supervisor
  ('supervisor', 'organisation.read'), ('supervisor', 'members.read'), ('supervisor', 'settings.read'),
  ('supervisor', 'activity.read'),
  ('supervisor', 'tasks.read_all'), ('supervisor', 'tasks.create'), ('supervisor', 'tasks.assign'),
  ('supervisor', 'tasks.update_all'),
  ('supervisor', 'sales.access'), ('supervisor', 'work.access'), ('supervisor', 'team.access'),
  ('supervisor', 'documents.access'), ('supervisor', 'inbox.access'),
  -- Field agent
  ('field_agent', 'organisation.read'),
  ('field_agent', 'tasks.read_assigned'), ('field_agent', 'tasks.create'), ('field_agent', 'tasks.update_assigned'),
  ('field_agent', 'work.access'),
  -- Viewer
  ('viewer', 'organisation.read'), ('viewer', 'members.read'), ('viewer', 'settings.read'),
  ('viewer', 'activity.read'), ('viewer', 'tasks.read_all'),
  ('viewer', 'sales.access'), ('viewer', 'work.access'), ('viewer', 'money.access'), ('viewer', 'team.access'),
  ('viewer', 'documents.access'), ('viewer', 'business.access'), ('viewer', 'inbox.access');
