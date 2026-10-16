-- =============================================================================
-- Phase 003 · Migration 2: leads + communications foundation
--   leads: pipeline (new → contacted → qualified → quote_needed → quote_sent → won/lost)
--   conversations / conversation_participants / messages: provider-independent;
--   no email/WhatsApp provider is integrated — only manual + system messages are
--   created in this phase. Nothing pretends to be sent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- leads
-- -----------------------------------------------------------------------------
create table public.leads (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  title              text not null check (char_length(trim(title)) between 1 and 200),
  customer_id        uuid,
  contact_id         uuid,
  person_name        text check (char_length(person_name) <= 200),
  company_name       text check (char_length(company_name) <= 200),
  email              text check (char_length(email) <= 320),
  phone              text check (char_length(phone) <= 40),
  site_address_id    uuid,
  site_address_text  text check (char_length(site_address_text) <= 500),
  source             text not null default 'manual'
                       check (source in ('manual', 'whatsapp', 'email', 'website', 'phone', 'referral', 'other')),
  status             text not null default 'new'
                       check (status in ('new', 'contacted', 'qualified', 'quote_needed', 'quote_sent', 'won', 'lost')),
  estimated_value    numeric(14, 2) check (estimated_value >= 0),
  service_summary    text check (char_length(service_summary) <= 1000),
  requested_date     date,
  notes              text check (char_length(notes) <= 5000),
  assigned_to        uuid references public.profiles (id) on delete set null,
  next_follow_up_at  timestamptz,
  last_activity_at   timestamptz not null default now(),
  won_at             timestamptz,
  lost_at            timestamptz,
  lost_reason        text check (char_length(lost_reason) <= 500),
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz,
  email_normalized   text generated always as (nullif(lower(trim(email)), '')) stored,
  phone_normalized   text generated always as (nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')) stored,
  constraint leads_id_org_key unique (id, organisation_id),
  constraint leads_customer_fk foreign key (customer_id, organisation_id)
    references public.customers (id, organisation_id),
  constraint leads_won_consistency check ((status = 'won') = (won_at is not null)),
  constraint leads_lost_consistency check ((status = 'lost') = (lost_at is not null)),
  constraint leads_has_identity check (coalesce(person_name, company_name, email, phone, title) is not null)
);
create index leads_org_status_idx on public.leads (organisation_id, status) where archived_at is null;
create index leads_org_created_idx on public.leads (organisation_id, created_at desc);
create index leads_org_followup_idx on public.leads (organisation_id, next_follow_up_at) where archived_at is null;
create index leads_customer_idx on public.leads (customer_id);
create index leads_assigned_idx on public.leads (assigned_to);
create index leads_created_by_idx on public.leads (created_by);
create index leads_email_idx on public.leads (organisation_id, email_normalized);
create index leads_phone_idx on public.leads (organisation_id, phone_normalized);

create trigger leads_set_updated_at before update on public.leads
  for each row execute function app_private.set_updated_at();

-- Guard: tenancy, contact/site belong to the linked customer, status timestamps, assignee.
create or replace function app_private.guard_leads()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organisation_id <> old.organisation_id then
    raise exception 'A lead cannot move between organisations' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  if new.contact_id is not null and not exists (
       select 1 from public.customer_contacts c where c.id = new.contact_id and c.customer_id = new.customer_id) then
    raise exception 'Contact does not belong to the linked customer' using errcode = '23503';
  end if;
  if new.site_address_id is not null and not exists (
       select 1 from public.customer_addresses a where a.id = new.site_address_id and a.customer_id = new.customer_id) then
    raise exception 'Site does not belong to the linked customer' using errcode = '23503';
  end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not app_private.is_active_member(new.organisation_id, new.assigned_to) then
    raise exception 'Assignee is not an active member of this organisation' using errcode = '23503';
  end if;
  -- Status timestamps are derived, never client-supplied.
  if new.status = 'won' and (tg_op = 'INSERT' or old.status <> 'won') then new.won_at := now(); end if;
  if new.status <> 'won' then new.won_at := null; end if;
  if new.status = 'lost' and (tg_op = 'INSERT' or old.status <> 'lost') then new.lost_at := now(); end if;
  if new.status <> 'lost' then new.lost_at := null; new.lost_reason := null; end if;
  if tg_op = 'UPDATE' and (new.status is distinct from old.status or new.notes is distinct from old.notes) then
    new.last_activity_at := now();
  end if;
  return new;
end;
$$;
create trigger leads_guard before insert or update on public.leads
  for each row execute function app_private.guard_leads();

create or replace function app_private.audit_leads()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app_private.log_activity(new.organisation_id, 'lead_created', 'lead', new.id,
      jsonb_build_object('title', new.title, 'source', new.source));
  elsif new.status is distinct from old.status then
    perform app_private.log_activity(new.organisation_id, 'lead_status_changed', 'lead', new.id,
      jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status));
  elsif new.archived_at is not null and old.archived_at is null then
    perform app_private.log_activity(new.organisation_id, 'lead_archived', 'lead', new.id, jsonb_build_object('title', new.title));
  elsif new.customer_id is distinct from old.customer_id and new.customer_id is not null then
    perform app_private.log_activity(new.organisation_id, 'lead_converted', 'lead', new.id,
      jsonb_build_object('title', new.title, 'customer_id', new.customer_id));
  end if;
  return null;
end;
$$;
create trigger leads_audit after insert or update on public.leads
  for each row execute function app_private.audit_leads();

-- Convert/link a lead to a customer (atomic). Existing customer: link. Otherwise create
-- customer + primary contact (+ site text as an address) from the lead's details.
-- Duplicate detection runs first; creation is refused when likely duplicates exist
-- unless p_allow_duplicate is true. The lead is never deleted.
create or replace function public.convert_lead_to_customer(
  p_lead_id uuid,
  p_existing_customer_id uuid default null,
  p_allow_duplicate boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead      public.leads;
  v_cust      uuid;
  v_contact   uuid;
  v_site      uuid;
  v_dupes     jsonb;
  v_name      text;
  v_first     text;
  v_last      text;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;
  if v_lead.id is null then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;
  if v_lead.customer_id is not null then
    return jsonb_build_object('customer_id', v_lead.customer_id, 'created', false, 'already_linked', true);
  end if;

  if p_existing_customer_id is not null then
    if not exists (select 1 from public.customers c where c.id = p_existing_customer_id and c.organisation_id = v_lead.organisation_id) then
      raise exception 'Customer not found in this organisation' using errcode = '23503';
    end if;
    v_cust := p_existing_customer_id;
    select id into v_contact from public.customer_contacts
     where customer_id = v_cust
       and ((v_lead.email_normalized is not null and lower(trim(email)) = v_lead.email_normalized)
         or (v_lead.phone_normalized is not null
             and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9) = right(v_lead.phone_normalized, 9)))
     limit 1;
    if v_contact is null and v_lead.person_name is not null then
      v_first := split_part(trim(v_lead.person_name), ' ', 1);
      v_last := nullif(trim(substr(trim(v_lead.person_name), char_length(v_first) + 1)), '');
      insert into public.customer_contacts (organisation_id, customer_id, first_name, last_name, email, phone, is_primary)
      values (v_lead.organisation_id, v_cust, v_first, v_last, v_lead.email, v_lead.phone,
              not exists (select 1 from public.customer_contacts where customer_id = v_cust and is_primary))
      returning id into v_contact;
    end if;
    update public.leads set customer_id = v_cust, contact_id = v_contact where id = v_lead.id;
    return jsonb_build_object('customer_id', v_cust, 'contact_id', v_contact, 'created', false);
  end if;

  v_name := coalesce(nullif(trim(v_lead.company_name), ''), nullif(trim(v_lead.person_name), ''), v_lead.title);
  if not p_allow_duplicate then
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into v_dupes
    from public.find_customer_duplicates(v_lead.organisation_id, v_name, v_lead.email, v_lead.phone, null, null) d;
    if jsonb_array_length(v_dupes) > 0 then
      return jsonb_build_object('created', false, 'possible_duplicates', v_dupes);
    end if;
  end if;

  v_first := split_part(trim(coalesce(v_lead.person_name, '')), ' ', 1);
  v_last := nullif(trim(substr(trim(coalesce(v_lead.person_name, '')), char_length(v_first) + 1)), '');
  v_cust := public.create_customer(
    v_lead.organisation_id,
    jsonb_build_object(
      'type', case when v_lead.company_name is not null then 'business' else 'individual' end,
      'display_name', v_name,
      'email', v_lead.email,
      'phone', v_lead.phone,
      'notes', v_lead.service_summary),
    case when nullif(v_first, '') is not null
      then jsonb_build_object('first_name', v_first, 'last_name', v_last, 'email', v_lead.email, 'phone', v_lead.phone)
      else null end,
    case when v_lead.site_address_text is not null
      then jsonb_build_object('kind', 'site', 'line1', left(v_lead.site_address_text, 200))
      else null end);
  select id into v_contact from public.customer_contacts where customer_id = v_cust and is_primary limit 1;
  select id into v_site from public.customer_addresses where customer_id = v_cust and kind = 'site' limit 1;
  update public.leads set customer_id = v_cust, contact_id = v_contact, site_address_id = v_site where id = v_lead.id;
  return jsonb_build_object('customer_id', v_cust, 'contact_id', v_contact, 'site_address_id', v_site, 'created', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Communications
-- -----------------------------------------------------------------------------
create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  subject           text check (char_length(subject) <= 300),
  primary_channel   text not null default 'manual' check (primary_channel in ('email', 'whatsapp', 'web', 'manual', 'system')),
  status            text not null default 'open' check (status in ('open', 'closed')),
  needs_attention   boolean not null default false,
  customer_id       uuid,
  contact_id        uuid,
  lead_id           uuid,
  quote_id          uuid,
  job_id            uuid,
  invoice_id        uuid,
  assigned_to       uuid references public.profiles (id) on delete set null,
  last_message_at   timestamptz,
  last_message_preview text check (char_length(last_message_preview) <= 300),
  ai_summary        text check (char_length(ai_summary) <= 2000),
  ai_summary_at     timestamptz,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint conversations_id_org_key unique (id, organisation_id),
  constraint conversations_customer_fk foreign key (customer_id, organisation_id) references public.customers (id, organisation_id),
  constraint conversations_lead_fk foreign key (lead_id, organisation_id) references public.leads (id, organisation_id)
);
create index conversations_org_last_idx on public.conversations (organisation_id, last_message_at desc nulls last);
create index conversations_customer_idx on public.conversations (customer_id);
create index conversations_lead_idx on public.conversations (lead_id);
create index conversations_quote_idx on public.conversations (quote_id);
create index conversations_job_idx on public.conversations (job_id);
create index conversations_invoice_idx on public.conversations (invoice_id);
create index conversations_assigned_idx on public.conversations (assigned_to);
create index conversations_created_by_idx on public.conversations (created_by);
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function app_private.set_updated_at();

create table public.conversation_participants (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  conversation_id   uuid not null,
  kind              text not null check (kind in ('contact', 'member', 'external')),
  contact_id        uuid,
  user_id           uuid references public.profiles (id) on delete cascade,
  display_name      text check (char_length(display_name) <= 200),
  address           text check (char_length(address) <= 320),
  created_at        timestamptz not null default now(),
  constraint participants_conversation_fk foreign key (conversation_id, organisation_id)
    references public.conversations (id, organisation_id) on delete cascade
);
create index participants_conversation_idx on public.conversation_participants (conversation_id, organisation_id);
create index participants_user_idx on public.conversation_participants (user_id);

create table public.messages (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  conversation_id   uuid not null,
  channel           text not null check (channel in ('email', 'whatsapp', 'web', 'manual', 'system')),
  kind              text not null default 'note' check (kind in ('note', 'call', 'meeting', 'message', 'email', 'event')),
  direction         text not null check (direction in ('inbound', 'outbound', 'internal')),
  status            text not null default 'received'
                      check (status in ('draft', 'queued', 'sent', 'delivered', 'read', 'failed', 'received', 'logged')),
  body              text not null check (char_length(trim(body)) between 1 and 20000),
  sender_name       text check (char_length(sender_name) <= 200),
  sender_address    text check (char_length(sender_address) <= 320),
  author_user_id    uuid references public.profiles (id) on delete set null,
  provider          text check (char_length(provider) <= 40),
  external_id       text check (char_length(external_id) <= 300),
  is_ai_draft       boolean not null default false,
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  metadata          jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  constraint messages_conversation_fk foreign key (conversation_id, organisation_id)
    references public.conversations (id, organisation_id) on delete cascade,
  -- Integrity: with no provider integrated, outbound email/WhatsApp can only be a draft.
  constraint messages_no_fake_sending check (
    not (channel in ('email', 'whatsapp', 'web') and direction = 'outbound' and status in ('queued', 'sent', 'delivered', 'read') and provider is null)
  )
);
create unique index messages_external_idx on public.messages (organisation_id, provider, external_id) where external_id is not null;
create index messages_conversation_idx on public.messages (conversation_id, organisation_id, occurred_at);
create index messages_org_created_idx on public.messages (organisation_id, created_at desc);
create index messages_author_idx on public.messages (author_user_id);

-- Per-user read state (unread filter).
create table public.conversation_reads (
  conversation_id   uuid not null references public.conversations (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  last_read_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_reads_user_idx on public.conversation_reads (user_id, organisation_id);

create or replace function app_private.guard_conversations()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organisation_id <> old.organisation_id then
    raise exception 'A conversation cannot move between organisations' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); else new.created_by := old.created_by; end if;
  return new;
end;
$$;
create trigger conversations_guard before insert or update on public.conversations
  for each row execute function app_private.guard_conversations();

create or replace function app_private.guard_messages()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Clients may only create manual records or drafts. Provider ingestion (future) runs as service_role.
    if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
       and current_user <> 'service_role' then
      new.author_user_id := auth.uid();
      new.provider := null;
      new.external_id := null;
      if new.channel in ('email', 'whatsapp', 'web') and new.direction <> 'outbound' then
        raise exception 'Inbound channel messages can only come from a connected integration' using errcode = '42501';
      end if;
      if new.channel in ('email', 'whatsapp', 'web') then
        new.status := 'draft';
      elsif new.channel = 'manual' then
        new.status := 'logged';
      end if;
    end if;
    return new;
  end if;
  -- UPDATE: messages are immutable except a draft's body/status edits by its author.
  if old.status <> 'draft' or old.author_user_id is distinct from auth.uid() then
    raise exception 'Messages cannot be changed' using errcode = '42501';
  end if;
  if new.conversation_id <> old.conversation_id or new.organisation_id <> old.organisation_id
     or new.channel <> old.channel or new.direction <> old.direction or new.status <> 'draft' then
    raise exception 'Only a draft''s text can be edited' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger messages_guard before insert or update on public.messages
  for each row execute function app_private.guard_messages();

-- Keep conversation summary fields + lead activity in sync; log communications.
create or replace function app_private.after_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversations;
begin
  if new.status = 'draft' then
    return null;
  end if;
  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, new.occurred_at), new.occurred_at),
         last_message_preview = left(new.body, 300),
         needs_attention = case when new.direction = 'inbound' then true
                                when new.direction = 'outbound' then false
                                else needs_attention end
   where id = new.conversation_id
  returning * into v_conv;
  if v_conv.lead_id is not null then
    update public.leads set last_activity_at = now(),
           status = case when status = 'new' and new.direction in ('outbound', 'internal') and new.kind in ('call', 'meeting', 'message', 'email')
                         then 'contacted' else status end
     where id = v_conv.lead_id;
  end if;
  perform app_private.log_activity(new.organisation_id, 'communication_logged', 'conversation', new.conversation_id,
    jsonb_build_object('channel', new.channel, 'kind', new.kind, 'direction', new.direction,
                       'lead_id', v_conv.lead_id, 'customer_id', v_conv.customer_id));
  return null;
end;
$$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function app_private.after_message();

-- Atomic "log a communication": find/create the conversation for the linked record,
-- add the message. Used by Inbox, lead/customer screens and AI.
create or replace function public.log_communication(
  p_organisation_id uuid,
  p_body            text,
  p_kind            text default 'note',
  p_direction       text default 'internal',
  p_customer_id     uuid default null,
  p_lead_id         uuid default null,
  p_job_id          uuid default null,
  p_quote_id        uuid default null,
  p_invoice_id      uuid default null,
  p_conversation_id uuid default null,
  p_occurred_at     timestamptz default null,
  p_subject         text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conv uuid := p_conversation_id;
  v_msg  uuid;
begin
  if v_conv is null then
    select id into v_conv from public.conversations
     where organisation_id = p_organisation_id and status = 'open'
       and ((p_lead_id is not null and lead_id = p_lead_id)
         or (p_lead_id is null and p_customer_id is not null and customer_id = p_customer_id and lead_id is null))
     order by last_message_at desc nulls last
     limit 1;
  end if;
  if v_conv is null then
    insert into public.conversations (organisation_id, subject, primary_channel, customer_id, lead_id, job_id, quote_id, invoice_id)
    values (p_organisation_id, nullif(trim(coalesce(p_subject, '')), ''), 'manual', p_customer_id, p_lead_id, p_job_id, p_quote_id, p_invoice_id)
    returning id into v_conv;
  end if;
  insert into public.messages (organisation_id, conversation_id, channel, kind, direction, body, occurred_at)
  values (p_organisation_id, v_conv, 'manual', coalesce(p_kind, 'note'), coalesce(p_direction, 'internal'), trim(p_body),
          coalesce(p_occurred_at, now()))
  returning id into v_msg;
  insert into public.conversation_reads (conversation_id, user_id, organisation_id, last_read_at)
  values (v_conv, auth.uid(), p_organisation_id, now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  return jsonb_build_object('conversation_id', v_conv, 'message_id', v_msg);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants + RLS
-- -----------------------------------------------------------------------------
revoke all on public.leads, public.conversations, public.conversation_participants, public.messages, public.conversation_reads
  from anon, authenticated;
grant select, insert, update on public.leads to authenticated;                 -- archive, never delete
grant select, insert, update on public.conversations to authenticated;
grant select, insert on public.conversation_participants to authenticated;
grant select, insert, update on public.messages to authenticated;
grant select, insert, update on public.conversation_reads to authenticated;

alter table public.leads enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;

create policy leads_select on public.leads for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('leads.read')));
create policy leads_insert on public.leads for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('leads.write')));
create policy leads_update on public.leads for update to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('leads.write')))
  with check (organisation_id in (select app_private.org_ids_with_permission('leads.write')));

create policy conversations_select on public.conversations for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('inbox.read')));
create policy conversations_insert on public.conversations for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('inbox.write')));
create policy conversations_update on public.conversations for update to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('inbox.write')))
  with check (organisation_id in (select app_private.org_ids_with_permission('inbox.write')));

create policy participants_select on public.conversation_participants for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('inbox.read')));
create policy participants_insert on public.conversation_participants for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('inbox.write')));

create policy messages_select on public.messages for select to authenticated
  using (organisation_id in (select app_private.org_ids_with_permission('inbox.read'))
         and (status <> 'draft' or author_user_id = (select auth.uid())));
create policy messages_insert on public.messages for insert to authenticated
  with check (organisation_id in (select app_private.org_ids_with_permission('inbox.write')));
create policy messages_update on public.messages for update to authenticated
  using (author_user_id = (select auth.uid()) and status = 'draft')
  with check (organisation_id in (select app_private.org_ids_with_permission('inbox.write')));

create policy conversation_reads_own on public.conversation_reads for all to authenticated
  using (user_id = (select auth.uid()) and organisation_id in (select app_private.org_ids_with_permission('inbox.read')))
  with check (user_id = (select auth.uid()) and organisation_id in (select app_private.org_ids_with_permission('inbox.read')));

-- Tasks may now link to leads (customers already supported).
create or replace function app_private.validate_task_relation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.related_entity_type is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.related_entity_type is not distinct from old.related_entity_type
     and new.related_entity_id is not distinct from old.related_entity_id then
    return new;
  end if;
  if new.related_entity_type = 'customer' and exists (
       select 1 from public.customers c where c.id = new.related_entity_id and c.organisation_id = new.organisation_id) then
    return new;
  elsif new.related_entity_type = 'lead' and exists (
       select 1 from public.leads l where l.id = new.related_entity_id and l.organisation_id = new.organisation_id) then
    return new;
  elsif new.related_entity_type = 'quote' and exists (
       select 1 from public.quotes q where q.id = new.related_entity_id and q.organisation_id = new.organisation_id) then
    return new;
  elsif new.related_entity_type = 'job' and exists (
       select 1 from public.jobs j where j.id = new.related_entity_id and j.organisation_id = new.organisation_id) then
    return new;
  elsif new.related_entity_type = 'invoice' and exists (
       select 1 from public.invoices i where i.id = new.related_entity_id and i.organisation_id = new.organisation_id) then
    return new;
  elsif new.related_entity_type in ('customer', 'lead', 'quote', 'job', 'invoice') then
    raise exception 'Linked record not found in this organisation' using errcode = '23503';
  end if;
  raise exception 'Unsupported related entity type: %', new.related_entity_type using errcode = '23514';
end;
$$;

revoke execute on function public.convert_lead_to_customer(uuid, uuid, boolean) from public, anon;
grant execute on function public.convert_lead_to_customer(uuid, uuid, boolean) to authenticated;
revoke execute on function public.log_communication(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.log_communication(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text) to authenticated;
revoke execute on all functions in schema app_private from anon, public;
