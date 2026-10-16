-- =============================================================================
-- Phase 003 · Migration 6: follow-up engine, Today summary, global search
--   All deterministic SQL, SECURITY INVOKER: RLS decides what each person sees
--   (a field agent's Today only contains their own jobs; no invoices for roles
--   without invoices.read). No AI call is needed to know what is overdue.
-- =============================================================================

create or replace function public.today_summary(p_organisation_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  tz        text;
  fs        public.organisation_financial_settings;
  v_today   date;
  v_start   timestamptz;
  v_end     timestamptz;
  r         jsonb := '{}'::jsonb;
begin
  if not app_private.is_active_member(p_organisation_id, auth.uid()) then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  select timezone into tz from public.organisations where id = p_organisation_id;
  tz := coalesce(tz, 'Africa/Johannesburg');
  select * into fs from public.organisation_financial_settings where organisation_id = p_organisation_id;
  v_today := (now() at time zone tz)::date;
  v_start := (v_today::timestamp) at time zone tz;
  v_end := ((v_today + 1)::timestamp) at time zone tz;
  r := r || jsonb_build_object('today', v_today, 'timezone', tz);

  -- Money
  if app_private.has_permission(p_organisation_id, 'invoices.read') then
    r := r || jsonb_build_object(
      'money_outstanding', (select coalesce(sum(amount_due), 0) from public.invoices
                             where organisation_id = p_organisation_id and status in ('issued', 'partially_paid')),
      'overdue_invoices_count', (select count(*) from public.invoices
                                  where organisation_id = p_organisation_id and status in ('issued', 'partially_paid')
                                    and amount_due > 0 and due_date < v_today),
      'overdue_amount', (select coalesce(sum(amount_due), 0) from public.invoices
                          where organisation_id = p_organisation_id and status in ('issued', 'partially_paid')
                            and amount_due > 0 and due_date < v_today),
      'due_soon_count', (select count(*) from public.invoices
                          where organisation_id = p_organisation_id and status in ('issued', 'partially_paid') and amount_due > 0
                            and due_date between v_today and v_today + coalesce(fs.invoice_due_soon_days, 3)),
      'overdue_invoices', (select coalesce(jsonb_agg(x order by x.days_overdue desc), '[]'::jsonb) from (
          select i.id, i.invoice_number, coalesce(i.customer_name_snapshot, c.display_name) as customer_name,
                 i.amount_due, i.due_date, (v_today - i.due_date) as days_overdue
          from public.invoices i join public.customers c on c.id = i.customer_id
          where i.organisation_id = p_organisation_id and i.status in ('issued', 'partially_paid')
            and i.amount_due > 0 and i.due_date < v_today
          order by i.due_date limit 5) x));
  end if;

  -- Leads
  if app_private.has_permission(p_organisation_id, 'leads.read') then
    r := r || jsonb_build_object(
      'new_leads_count', (select count(*) from public.leads
                           where organisation_id = p_organisation_id and archived_at is null and status = 'new'),
      'leads_followup', (select coalesce(jsonb_agg(x order by x.due_at), '[]'::jsonb) from (
          select l.id, l.title, coalesce(l.company_name, l.person_name) as name, l.status, l.source,
                 coalesce(l.next_follow_up_at, l.last_activity_at + make_interval(days => coalesce(fs.lead_followup_days, 2))) as due_at,
                 case when l.next_follow_up_at is not null then 'scheduled' else 'no_response' end as reason
          from public.leads l
          where l.organisation_id = p_organisation_id and l.archived_at is null
            and l.status in ('new', 'contacted', 'qualified', 'quote_needed')
            and ((l.next_follow_up_at is not null and l.next_follow_up_at < v_end)
              or (l.next_follow_up_at is null
                  and l.last_activity_at < now() - make_interval(days => coalesce(fs.lead_followup_days, 2))))
          order by 6 limit 5) x),
      'leads_followup_count', (select count(*) from public.leads l
          where l.organisation_id = p_organisation_id and l.archived_at is null
            and l.status in ('new', 'contacted', 'qualified', 'quote_needed')
            and ((l.next_follow_up_at is not null and l.next_follow_up_at < v_end)
              or (l.next_follow_up_at is null
                  and l.last_activity_at < now() - make_interval(days => coalesce(fs.lead_followup_days, 2))))));
  end if;

  -- Quotes needing follow-up: sent/viewed, not expired, no answer after N days
  if app_private.has_permission(p_organisation_id, 'quotes.read') then
    r := r || jsonb_build_object(
      'quotes_followup', (select coalesce(jsonb_agg(x order by x.issued_at), '[]'::jsonb) from (
          select q.id, q.quote_number, coalesce(q.customer_name_snapshot, c.display_name) as customer_name, q.total, q.issued_at,
                 (v_today - (q.issued_at at time zone tz)::date) as days_waiting, q.expiry_date
          from public.quotes q join public.customers c on c.id = q.customer_id
          where q.organisation_id = p_organisation_id and q.status in ('sent', 'viewed')
            and (q.expiry_date is null or q.expiry_date >= v_today)
            and q.issued_at < now() - make_interval(days => coalesce(fs.quote_followup_days, 3))
          order by q.issued_at limit 5) x),
      'quotes_followup_count', (select count(*) from public.quotes q
          where q.organisation_id = p_organisation_id and q.status in ('sent', 'viewed')
            and (q.expiry_date is null or q.expiry_date >= v_today)
            and q.issued_at < now() - make_interval(days => coalesce(fs.quote_followup_days, 3))),
      'quotes_expiring_count', (select count(*) from public.quotes q
          where q.organisation_id = p_organisation_id and q.status in ('sent', 'viewed')
            and q.expiry_date between v_today and v_today + 3));
  end if;

  -- Jobs (RLS: field agents only see their own)
  if app_private.has_permission(p_organisation_id, 'jobs.read_all') or app_private.has_permission(p_organisation_id, 'jobs.read_assigned') then
    r := r || jsonb_build_object(
      'jobs_today', (select coalesce(jsonb_agg(x order by x.scheduled_start), '[]'::jsonb) from (
          select j.id, j.job_number, j.title, j.status, j.scheduled_start, j.scheduled_end,
                 (select count(*) from public.job_assignments a where a.job_id = j.id) as team_size
          from public.jobs j
          where j.organisation_id = p_organisation_id and j.status in ('scheduled', 'in_progress', 'completed')
            and j.scheduled_start >= v_start and j.scheduled_start < v_end
          order by j.scheduled_start limit 20) x),
      'jobs_in_progress_count', (select count(*) from public.jobs j
          where j.organisation_id = p_organisation_id and j.status = 'in_progress'),
      'unassigned_upcoming', (select coalesce(jsonb_agg(x order by x.scheduled_start), '[]'::jsonb) from (
          select j.id, j.job_number, j.title, j.scheduled_start
          from public.jobs j
          where j.organisation_id = p_organisation_id and j.status = 'scheduled'
            and j.scheduled_start >= v_start and j.scheduled_start < v_start + interval '7 days'
            and not exists (select 1 from public.job_assignments a where a.job_id = j.id)
          order by j.scheduled_start limit 5) x),
      'unscheduled_count', (select count(*) from public.jobs j
          where j.organisation_id = p_organisation_id and j.status = 'unscheduled'),
      'completed_not_invoiced_count', case when app_private.has_permission(p_organisation_id, 'invoices.read') then
          (select count(*) from public.jobs j where j.organisation_id = p_organisation_id and j.status = 'completed'
             and not exists (select 1 from public.invoices i where i.job_id = j.id and i.status <> 'void')
             and not (j.quote_id is not null and exists (select 1 from public.invoices i where i.quote_id = j.quote_id and i.status <> 'void')))
          else null end);
  end if;

  -- Tasks (tasks RLS applies)
  r := r || jsonb_build_object(
    'tasks_overdue_count', (select count(*) from public.tasks t where t.organisation_id = p_organisation_id
                              and t.status in ('open', 'in_progress') and t.due_at < v_start),
    'tasks_due_today_count', (select count(*) from public.tasks t where t.organisation_id = p_organisation_id
                                and t.status in ('open', 'in_progress') and t.due_at >= v_start and t.due_at < v_end));

  -- Inbox
  if app_private.has_permission(p_organisation_id, 'inbox.read') then
    r := r || jsonb_build_object(
      'conversations_attention_count', (select count(*) from public.conversations c
         where c.organisation_id = p_organisation_id and c.status = 'open' and c.needs_attention));
  end if;
  return r;
end;
$$;

-- Global search across the lifecycle. Invoker: RLS filters per role.
create or replace function public.global_search(p_organisation_id uuid, p_query text, p_limit integer default 6)
returns table (entity_type text, id uuid, title text, subtitle text, status text, rank real)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  q      text := trim(coalesce(p_query, ''));
  pat    text;
  digits text;
  lim    integer := least(greatest(coalesce(p_limit, 6), 1), 20);
begin
  if char_length(q) < 2 then
    return;
  end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  digits := regexp_replace(q, '[^0-9]', '', 'g');

  return query
  (select 'customer'::text, c.id, c.display_name, concat_ws(' · ', c.email, c.phone), c.status,
          extensions.similarity(c.display_name, q)
     from public.customers c
    where c.organisation_id = p_organisation_id
      and (c.display_name ilike pat or c.email ilike pat
           or (char_length(digits) >= 4 and c.phone_normalized like '%' || digits || '%'))
    order by 6 desc limit lim)
  union all
  (select 'contact'::text, ct.customer_id, concat_ws(' ', ct.first_name, ct.last_name), concat_ws(' · ', cu.display_name, ct.phone, ct.email), null::text,
          extensions.similarity(concat_ws(' ', ct.first_name, ct.last_name), q)
     from public.customer_contacts ct join public.customers cu on cu.id = ct.customer_id
    where ct.organisation_id = p_organisation_id
      and (concat_ws(' ', ct.first_name, ct.last_name) ilike pat or ct.email ilike pat
           or (char_length(digits) >= 4 and regexp_replace(coalesce(ct.phone, ''), '[^0-9]', '', 'g') like '%' || digits || '%'))
    order by 6 desc limit lim)
  union all
  (select 'lead'::text, l.id, l.title, concat_ws(' · ', coalesce(l.company_name, l.person_name), l.service_summary), l.status,
          greatest(extensions.similarity(l.title, q), extensions.similarity(coalesce(l.company_name, l.person_name, ''), q))
     from public.leads l
    where l.organisation_id = p_organisation_id and l.archived_at is null
      and (l.title ilike pat or l.company_name ilike pat or l.person_name ilike pat or l.email ilike pat
           or (char_length(digits) >= 4 and l.phone_normalized like '%' || digits || '%'))
    order by 6 desc limit lim)
  union all
  (select 'quote'::text, qu.id, qu.quote_number, concat_ws(' · ', coalesce(qu.customer_name_snapshot, c.display_name), qu.title), qu.status,
          case when qu.quote_number ilike q then 1 else extensions.similarity(c.display_name, q) end
     from public.quotes qu join public.customers c on c.id = qu.customer_id
    where qu.organisation_id = p_organisation_id
      and (qu.quote_number ilike pat or c.display_name ilike pat or qu.title ilike pat)
    order by 6 desc limit lim)
  union all
  (select 'job'::text, j.id, j.job_number || ' · ' || j.title, c.display_name, j.status,
          case when j.job_number ilike q then 1 else greatest(extensions.similarity(j.title, q), coalesce(extensions.similarity(c.display_name, q), 0)) end
     from public.jobs j left join public.customers c on c.id = j.customer_id   -- field agents can't read customers
    where j.organisation_id = p_organisation_id
      and (j.job_number ilike pat or j.title ilike pat or c.display_name ilike pat)
    order by 6 desc limit lim)
  union all
  (select 'invoice'::text, i.id, coalesce(i.invoice_number, 'Draft invoice'), concat_ws(' · ', coalesce(i.customer_name_snapshot, c.display_name), i.title), i.status,
          case when i.invoice_number ilike q then 1 else extensions.similarity(c.display_name, q) end
     from public.invoices i join public.customers c on c.id = i.customer_id
    where i.organisation_id = p_organisation_id
      and (i.invoice_number ilike pat or c.display_name ilike pat or i.title ilike pat)
    order by 6 desc limit lim);
end;
$$;

revoke execute on function public.today_summary(uuid), public.global_search(uuid, text, integer) from public, anon;
grant execute on function public.today_summary(uuid), public.global_search(uuid, text, integer) to authenticated;
revoke execute on all functions in schema app_private from anon, public;
