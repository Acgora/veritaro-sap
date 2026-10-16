-- =============================================================================
-- Phase 003 · Migration 4: jobs, assignments, notes, photos, scheduling
--   * Job numbers J-0001 from the row-locked sequence
--   * Field agents (jobs.read_assigned) see ONLY jobs assigned to them, and get
--     customer/site/contact fields through get_field_job()/list_my_jobs() — never
--     the customer tables, quotes, invoices or other sites (RLS still final).
--   * One active job per accepted quote (idempotent create_job_from_quote)
--   * Conflict detection is deterministic (overlapping assignments)
--   * No money columns on jobs: commercial data stays on quotes/invoices.
-- =============================================================================

create table public.jobs (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  job_number        text not null check (char_length(job_number) between 1 and 40),
  customer_id       uuid not null,
  contact_id        uuid,
  site_address_id   uuid,
  quote_id          uuid,
  lead_id           uuid,
  title             text not null check (char_length(trim(title)) between 1 and 200),
  description       text check (char_length(description) <= 5000),
  status            text not null default 'unscheduled'
                      check (status in ('unscheduled', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  priority          text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  scheduled_start   timestamptz,
  scheduled_end     timestamptz,
  actual_start      timestamptz,
  actual_end        timestamptz,
  internal_notes    text check (char_length(internal_notes) <= 5000),
  completion_notes  text check (char_length(completion_notes) <= 5000),
  cancel_reason     text check (char_length(cancel_reason) <= 500),
  created_by        uuid references public.profiles (id) on delete set null,
  completed_by      uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  archived_at       timestamptz,
  constraint jobs_id_org_key unique (id, organisation_id),
  constraint jobs_number_unique unique (organisation_id, job_number),
  constraint jobs_customer_fk foreign key (customer_id, organisation_id) references public.customers (id, organisation_id),
  constraint jobs_quote_fk foreign key (quote_id, organisation_id) references public.quotes (id, organisation_id),
  constraint jobs_lead_fk foreign key (lead_id, organisation_id) references public.leads (id, organisation_id),
  constraint jobs_schedule_order check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start),
  constraint jobs_scheduled_has_start check (status <> 'scheduled' or scheduled_start is not null),
  constraint jobs_completed_consistency check ((status = 'completed') = (completed_at is not null))
);
create unique index jobs_one_active_per_quote_idx on public.jobs (quote_id) where quote_id is not null and status <> 'cancelled';
create index jobs_org_status_idx on public.jobs (organisation_id, status);
create index jobs_org_start_idx on public.jobs (organisation_id, scheduled_start);
create index jobs_org_created_idx on public.jobs (organisation_id, created_at desc);
create index jobs_customer_idx on public.jobs (customer_id);
create index jobs_lead_idx on public.jobs (lead_id);
create index jobs_created_by_idx on public.jobs (created_by);
create index jobs_completed_by_idx on public.jobs (completed_by);
create index jobs_number_trgm_idx on public.jobs using gin (job_number extensions.gin_trgm_ops);

create table public.job_assignments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  job_id           uuid not null,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             text not null default 'worker' check (role in ('lead', 'worker')),
  assigned_by      uuid references public.profiles (id) on delete set null,
  assigned_at      timestamptz not null default now(),
  constraint job_assignments_job_fk foreign key (job_id, organisation_id) references public.jobs (id, organisation_id) on delete cascade,
  unique (job_id, user_id)
);
create index job_assignments_user_idx on public.job_assignments (user_id, organisation_id);
create index job_assignments_job_idx on public.job_assignments (job_id, organisation_id);
create index job_assignments_assigned_by_idx on public.job_assignments (assigned_by);

create table public.job_notes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  job_id           uuid not null,
  body             text not null check (char_length(trim(body)) between 1 and 5000),
  author_id        uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint job_notes_job_fk foreign key (job_id, organisation_id) references public.jobs (id, organisation_id) on delete cascade
);
create index job_notes_job_idx on public.job_notes (job_id, organisation_id, created_at);
create index job_notes_author_idx on public.job_notes (author_id);

create table public.job_photos (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  job_id           uuid not null,
  storage_path     text not null check (char_length(storage_path) <= 500),
  caption          text check (char_length(caption) <= 500),
  category         text not null default 'other' check (category in ('before', 'during', 'after', 'receipt', 'evidence', 'other')),
  width            integer check (width > 0),
  height           integer check (height > 0),
  byte_size        integer check (byte_size > 0 and byte_size <= 8388608),
  taken_at         timestamptz,
  uploaded_by      uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint job_photos_job_fk foreign key (job_id, organisation_id) references public.jobs (id, organisation_id) on delete cascade,
  constraint job_photos_path_scoped check (storage_path like organisation_id::text || '/jobs/' || job_id::text || '/%')
);
create index job_photos_job_idx on public.job_photos (job_id, organisation_id, created_at);
create index job_photos_uploaded_by_idx on public.job_photos (uploaded_by);

create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function app_private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function app_private.my_assigned_job_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.job_id
  from public.job_assignments a
  join public.organisation_members m on m.organisation_id = a.organisation_id and m.user_id = auth.uid() and m.status = 'active'
  where a.user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
create or replace function app_private.guard_jobs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_rpc boolean := coalesce(current_setting('app.job_transition', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.job_number := app_private.next_document_number(new.organisation_id, 'job');
    new.status := case when new.scheduled_start is not null then 'scheduled' else 'unscheduled' end;
    new.completed_at := null; new.completed_by := null; new.actual_start := null; new.actual_end := null; new.cancelled_at := null;
  else
    if new.organisation_id <> old.organisation_id or new.job_number <> old.job_number then
      raise exception 'Job number and organisation cannot be changed' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    if new.quote_id is distinct from old.quote_id then
      raise exception 'A job''s quote cannot be changed' using errcode = '42501';
    end if;
    if old.status in ('completed', 'cancelled') and not v_rpc then
      raise exception 'This job is closed and can no longer be edited' using errcode = '42501';
    end if;
    if not v_rpc then
      if new.status is distinct from old.status
         and not (old.status in ('unscheduled', 'scheduled') and new.status in ('unscheduled', 'scheduled')) then
        raise exception 'Use the job actions to start, complete or cancel a job' using errcode = '42501';
      end if;
      new.completed_at := old.completed_at; new.completed_by := old.completed_by;
      new.actual_start := old.actual_start; new.actual_end := old.actual_end; new.cancelled_at := old.cancelled_at;
      -- Scheduling keeps status consistent while the job hasn't started.
      if old.status in ('unscheduled', 'scheduled') then
        new.status := case when new.scheduled_start is not null then 'scheduled' else 'unscheduled' end;
      end if;
    end if;
  end if;
  if new.contact_id is not null and not exists (
       select 1 from public.customer_contacts c where c.id = new.contact_id and c.customer_id = new.customer_id) then
    raise exception 'Contact does not belong to this customer' using errcode = '23503';
  end if;
  if new.site_address_id is not null and not exists (
       select 1 from public.customer_addresses a where a.id = new.site_address_id and a.customer_id = new.customer_id) then
    raise exception 'Site does not belong to this customer' using errcode = '23503';
  end if;
  if new.quote_id is not null and tg_op = 'INSERT' and not exists (
       select 1 from public.quotes q where q.id = new.quote_id and q.customer_id = new.customer_id and q.status = 'accepted') then
    raise exception 'A job can only be created from an accepted quote for the same customer' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger jobs_guard before insert or update on public.jobs
  for each row execute function app_private.guard_jobs();

create or replace function app_private.guard_job_children()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'job_assignments' then
    if not app_private.is_active_member(new.organisation_id, new.user_id) then
      raise exception 'Assignee is not an active member of this organisation' using errcode = '23503';
    end if;
    new.assigned_by := auth.uid();
  elsif tg_table_name = 'job_notes' then
    new.author_id := auth.uid();
  elsif tg_table_name = 'job_photos' then
    new.uploaded_by := auth.uid();
  end if;
  if exists (select 1 from public.jobs j where j.id = new.job_id and j.status = 'cancelled') then
    raise exception 'This job is cancelled' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger job_assignments_guard before insert on public.job_assignments
  for each row execute function app_private.guard_job_children();
create trigger job_notes_guard before insert on public.job_notes
  for each row execute function app_private.guard_job_children();
create trigger job_photos_guard before insert on public.job_photos
  for each row execute function app_private.guard_job_children();

create or replace function app_private.audit_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := jsonb_build_object('job_number', new.job_number, 'title', new.title, 'customer_id', new.customer_id);
begin
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.organisation_id, 'job_created', 'job', new.id, v_meta || jsonb_build_object('quote_id', new.quote_id));
    if new.scheduled_start is not null then
      perform app_private.log_activity(new.organisation_id, 'job_scheduled', 'job', new.id, v_meta || jsonb_build_object('start', new.scheduled_start));
    end if;
    return null;
  end if;
  if new.status is distinct from old.status and new.status in ('in_progress', 'completed', 'cancelled') then
    perform app_private.log_activity(new.organisation_id,
      case new.status when 'in_progress' then 'job_started' when 'completed' then 'job_completed' else 'job_cancelled' end,
      'job', new.id, v_meta);
  elsif new.scheduled_start is distinct from old.scheduled_start and new.scheduled_start is not null then
    perform app_private.log_activity(new.organisation_id, 'job_scheduled', 'job', new.id,
      v_meta || jsonb_build_object('start', new.scheduled_start, 'previous', old.scheduled_start));
  end if;
  return null;
end;
$$;
create trigger jobs_audit after insert or update on public.jobs
  for each row execute function app_private.audit_jobs();

create or replace function app_private.audit_job_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_num text;
begin
  select job_number into v_num from public.jobs where id = coalesce(new.job_id, old.job_id);
  if tg_table_name = 'job_assignments' then
    if tg_op = 'INSERT' then
      perform app_private.log_activity(new.organisation_id, 'job_assigned', 'job', new.job_id,
        jsonb_build_object('job_number', v_num, 'user_id', new.user_id));
      -- Tell the assignee.
      if new.user_id is distinct from auth.uid() then
        insert into public.notifications (organisation_id, user_id, type, title, message, entity_type, entity_id)
        values (new.organisation_id, new.user_id, 'job.assigned', 'New job assigned', 'You have been assigned job ' || v_num || '.', 'job', new.job_id);
      end if;
    else
      perform app_private.log_activity(old.organisation_id, 'job_unassigned', 'job', old.job_id,
        jsonb_build_object('job_number', v_num, 'user_id', old.user_id));
    end if;
  elsif tg_table_name = 'job_notes' then
    perform app_private.log_activity(new.organisation_id, 'job_note_added', 'job', new.job_id, jsonb_build_object('job_number', v_num));
  elsif tg_table_name = 'job_photos' then
    perform app_private.log_activity(new.organisation_id, 'job_photo_added', 'job', new.job_id,
      jsonb_build_object('job_number', v_num, 'category', new.category));
  end if;
  return null;
end;
$$;
create trigger job_assignments_audit after insert or delete on public.job_assignments
  for each row execute function app_private.audit_job_children();
create trigger job_notes_audit after insert on public.job_notes
  for each row execute function app_private.audit_job_children();
create trigger job_photos_audit after insert on public.job_photos
  for each row execute function app_private.audit_job_children();

-- -----------------------------------------------------------------------------
-- Lifecycle RPCs
-- -----------------------------------------------------------------------------
-- Accepted quote → job. Idempotent: returns the existing active job for that quote.
create or replace function public.create_job_from_quote(
  p_quote_id        uuid,
  p_scheduled_start timestamptz default null,
  p_scheduled_end   timestamptz default null,
  p_title           text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  q       public.quotes;
  v_job   uuid;
  v_scope text;
begin
  select * into q from public.quotes where id = p_quote_id;
  if q.id is null then
    raise exception 'Quote not found' using errcode = 'P0002';
  end if;
  select id into v_job from public.jobs where quote_id = q.id and status <> 'cancelled' limit 1;
  if v_job is not null then
    return jsonb_build_object('job_id', v_job, 'created', false);
  end if;
  if q.status <> 'accepted' then
    raise exception 'Only an accepted quote can become a job' using errcode = '22023';
  end if;
  select string_agg('• ' || description || case when quantity <> 1 then ' × ' || trim(to_char(quantity, 'FM999999990.###')) || coalesce(' ' || unit, '') else '' end,
                    E'\n' order by sort_order)
    into v_scope from public.quote_items where quote_id = q.id;
  insert into public.jobs (organisation_id, customer_id, contact_id, site_address_id, quote_id, lead_id, title, description,
                           scheduled_start, scheduled_end)
  values (q.organisation_id, q.customer_id, q.contact_id, q.site_address_id, q.id, q.lead_id,
          coalesce(nullif(trim(p_title), ''), nullif(q.title, ''), 'Job for ' || q.quote_number),
          concat_ws(E'\n\n', v_scope, nullif(q.notes, '')),
          p_scheduled_start, coalesce(p_scheduled_end, case when p_scheduled_start is not null then p_scheduled_start + interval '2 hours' end))
  returning id into v_job;
  return jsonb_build_object('job_id', v_job, 'created', true);
exception when unique_violation then
  select id into v_job from public.jobs where quote_id = p_quote_id and status <> 'cancelled' limit 1;
  return jsonb_build_object('job_id', v_job, 'created', false);
end;
$$;

create or replace function public.set_job_status(p_job_id uuid, p_action text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j       public.jobs;
  v_perm  boolean;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if j.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  -- Who may act: jobs.write (office) on any job; jobs.work on jobs assigned to me.
  v_perm := app_private.has_permission(j.organisation_id, 'jobs.write')
         or (app_private.has_permission(j.organisation_id, 'jobs.work')
             and (app_private.has_permission(j.organisation_id, 'jobs.read_all') or j.id in (select app_private.my_assigned_job_ids())));
  if not v_perm then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if p_action = 'cancel' and not app_private.has_permission(j.organisation_id, 'jobs.write') then
    raise exception 'You do not have permission to do that' using errcode = '42501';
  end if;

  perform set_config('app.job_transition', 'on', true);
  if p_action = 'start' then
    if j.status = 'in_progress' then return jsonb_build_object('id', j.id, 'status', j.status, 'already', true); end if;
    if j.status not in ('unscheduled', 'scheduled') then
      raise exception 'Only a scheduled or unscheduled job can be started' using errcode = '22023';
    end if;
    update public.jobs set status = 'in_progress', actual_start = now() where id = j.id;
  elsif p_action = 'complete' then
    if j.status = 'completed' then return jsonb_build_object('id', j.id, 'status', j.status, 'already', true); end if;
    if j.status not in ('unscheduled', 'scheduled', 'in_progress') then
      raise exception 'This job cannot be completed' using errcode = '22023';
    end if;
    update public.jobs set status = 'completed', completed_at = now(), completed_by = auth.uid(),
           actual_start = coalesce(actual_start, now()), actual_end = now(),
           completion_notes = coalesce(nullif(trim(p_notes), ''), completion_notes)
     where id = j.id;
  elsif p_action = 'cancel' then
    if j.status = 'cancelled' then return jsonb_build_object('id', j.id, 'status', j.status, 'already', true); end if;
    if j.status = 'completed' then
      raise exception 'A completed job cannot be cancelled' using errcode = '22023';
    end if;
    update public.jobs set status = 'cancelled', cancelled_at = now(), cancel_reason = left(p_notes, 500) where id = j.id;
  elsif p_action = 'reopen' then
    if not app_private.has_permission(j.organisation_id, 'jobs.write') then
      raise exception 'You do not have permission to do that' using errcode = '42501';
    end if;
    if j.status <> 'completed' then
      raise exception 'Only a completed job can be reopened' using errcode = '22023';
    end if;
    if exists (select 1 from public.invoices i where i.job_id = j.id and i.status <> 'void') then
      raise exception 'This job has been invoiced and cannot be reopened' using errcode = '22023';
    end if;
    update public.jobs set status = 'in_progress', completed_at = null, completed_by = null, actual_end = null where id = j.id;
  else
    raise exception 'Invalid job action' using errcode = '22023';
  end if;
  perform set_config('app.job_transition', 'off', true);
  select * into j from public.jobs where id = j.id;
  return jsonb_build_object('id', j.id, 'status', j.status);
end;
$$;

-- Deterministic conflicts: other active jobs overlapping [start, end) for any of the given people.
create or replace function public.find_schedule_conflicts(
  p_organisation_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_user_ids uuid[],
  p_exclude_job_id uuid default null
)
returns table (job_id uuid, job_number text, title text, user_id uuid, scheduled_start timestamptz, scheduled_end timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select j.id, j.job_number, j.title, a.user_id, j.scheduled_start, coalesce(j.scheduled_end, j.scheduled_start + interval '2 hours')
  from public.jobs j
  join public.job_assignments a on a.job_id = j.id
  where j.organisation_id = p_organisation_id
    and j.status in ('scheduled', 'in_progress')
    and j.scheduled_start is not null
    and (p_exclude_job_id is null or j.id <> p_exclude_job_id)
    and a.user_id = any(p_user_ids)
    and j.scheduled_start < p_end
    and coalesce(j.scheduled_end, j.scheduled_start + interval '2 hours') > p_start
  order by j.scheduled_start
  limit 20;
$$;

-- Field view: minimum customer information for an assigned job (or any job for office roles).
create or replace function public.get_field_job(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j  public.jobs;
  c  public.customers;
  ct public.customer_contacts;
  st public.customer_addresses;
begin
  select * into j from public.jobs where id = p_job_id;
  if j.id is null
     or not (app_private.has_permission(j.organisation_id, 'jobs.read_all')
             or (app_private.has_permission(j.organisation_id, 'jobs.read_assigned') and j.id in (select app_private.my_assigned_job_ids()))) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  select * into c from public.customers where id = j.customer_id;
  select * into ct from public.customer_contacts where id = j.contact_id;
  if ct.id is null then select * into ct from public.customer_contacts where customer_id = j.customer_id and is_primary limit 1; end if;
  select * into st from public.customer_addresses where id = j.site_address_id;
  return jsonb_build_object(
    'id', j.id, 'job_number', j.job_number, 'title', j.title, 'description', j.description, 'status', j.status,
    'priority', j.priority, 'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
    'actual_start', j.actual_start, 'actual_end', j.actual_end, 'completed_at', j.completed_at,
    'completion_notes', j.completion_notes,
    'customer_name', c.display_name,
    'contact_name', nullif(trim(concat_ws(' ', ct.first_name, ct.last_name)), ''),
    'contact_phone', coalesce(ct.phone, c.phone),
    'site_label', st.label,
    'site_address', app_private.format_address(st.line1, st.line2, st.suburb, st.city, st.province, st.postal_code),
    'site_notes', st.notes);
end;
$$;

create or replace function public.list_my_jobs(p_organisation_id uuid, p_from timestamptz default null, p_to timestamptz default null)
returns table (id uuid, job_number text, title text, status text, scheduled_start timestamptz, scheduled_end timestamptz,
               customer_name text, site_address text)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.job_number, j.title, j.status, j.scheduled_start, j.scheduled_end, c.display_name,
         app_private.format_address(st.line1, st.line2, st.suburb, st.city, st.province, st.postal_code)
  from public.jobs j
  join public.customers c on c.id = j.customer_id
  left join public.customer_addresses st on st.id = j.site_address_id
  where j.organisation_id = p_organisation_id
    and j.id in (select app_private.my_assigned_job_ids())
    and (app_private.has_permission(p_organisation_id, 'jobs.read_assigned')
         or app_private.has_permission(p_organisation_id, 'jobs.read_all'))
    and j.status in ('unscheduled', 'scheduled', 'in_progress', 'completed')
    and (p_from is null or j.scheduled_start is null or j.scheduled_start >= p_from)
    and (p_to is null or j.scheduled_start is null or j.scheduled_start < p_to)
  order by j.scheduled_start nulls last
  limit 200;
$$;

-- -----------------------------------------------------------------------------
-- Storage: job photos (<org>/jobs/<job_id>/<file>)
-- -----------------------------------------------------------------------------
create or replace function app_private.can_access_job(p_job_id uuid, p_write boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job_id
      and (
        (not p_write and app_private.has_permission(j.organisation_id, 'jobs.read_all'))
        or (p_write and app_private.has_permission(j.organisation_id, 'jobs.write'))
        or (app_private.has_permission(j.organisation_id, case when p_write then 'jobs.work' else 'jobs.read_assigned' end)
            and j.id in (select app_private.my_assigned_job_ids()))
        or (p_write and app_private.has_permission(j.organisation_id, 'jobs.work') and app_private.has_permission(j.organisation_id, 'jobs.read_all'))
      )
  );
$$;

create policy job_photos_bucket_read on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and split_part(name, '/', 2) = 'jobs'
         and app_private.storage_org_id(name) is not null
         and app_private.can_access_job(app_private.storage_entity_id(name), false));
create policy job_photos_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and split_part(name, '/', 2) = 'jobs'
              and app_private.storage_org_id(name) is not null
              and app_private.can_access_job(app_private.storage_entity_id(name), true)
              and exists (select 1 from public.jobs j where j.id = app_private.storage_entity_id(name)
                          and j.organisation_id = app_private.storage_org_id(name)));

-- -----------------------------------------------------------------------------
-- Grants + RLS
-- -----------------------------------------------------------------------------
revoke all on public.jobs, public.job_assignments, public.job_notes, public.job_photos from anon, authenticated;
grant select, insert, update on public.jobs to authenticated;
grant select, insert, delete on public.job_assignments to authenticated;
grant select, insert on public.job_notes to authenticated;
grant select, insert on public.job_photos to authenticated;

alter table public.jobs enable row level security;
alter table public.job_assignments enable row level security;
alter table public.job_notes enable row level security;
alter table public.job_photos enable row level security;

create policy jobs_select on public.jobs for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('jobs.read_all'))
         or (organisation_id in (select app_private.org_ids_with_permission('jobs.read_assigned'))
             and id in (select app_private.my_assigned_job_ids())));
create policy jobs_insert on public.jobs for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('jobs.write')));
create policy jobs_update on public.jobs for update to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('jobs.write')))
  with check (organisation_id in (select app_private.org_ids_with_permission('jobs.write')));

create policy job_assignments_select on public.job_assignments for select to authenticated
  using (job_id in (select j.id from public.jobs j));
create policy job_assignments_insert on public.job_assignments for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('jobs.write')));
create policy job_assignments_delete on public.job_assignments for delete to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('jobs.write')));

create policy job_notes_select on public.job_notes for select to authenticated
  using (job_id in (select j.id from public.jobs j));
create policy job_notes_insert on public.job_notes for insert to authenticated
  with check (app_private.can_access_job(job_id, true));

create policy job_photos_select on public.job_photos for select to authenticated
  using (job_id in (select j.id from public.jobs j));
create policy job_photos_insert on public.job_photos for insert to authenticated
  with check (app_private.can_access_job(job_id, true));

revoke execute on function public.create_job_from_quote(uuid, timestamptz, timestamptz, text), public.set_job_status(uuid, text, text),
  public.find_schedule_conflicts(uuid, timestamptz, timestamptz, uuid[], uuid), public.get_field_job(uuid),
  public.list_my_jobs(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.create_job_from_quote(uuid, timestamptz, timestamptz, text), public.set_job_status(uuid, text, text),
  public.find_schedule_conflicts(uuid, timestamptz, timestamptz, uuid[], uuid), public.get_field_job(uuid),
  public.list_my_jobs(uuid, timestamptz, timestamptz) to authenticated;
revoke execute on all functions in schema app_private from anon, public;
grant execute on function app_private.my_assigned_job_ids(), app_private.can_access_job(uuid, boolean) to authenticated;
