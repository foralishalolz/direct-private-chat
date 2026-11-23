-- BitchAt 2.12 — calling, pinned messages, native app plumbing.
-- Additive only: new tables, new functions, no dropping of user data.
-- Every statement is idempotent so this can be replayed from the SQL editor.
begin;

-- ---------------------------------------------------------------------------
-- 1. Pinned messages. One row per pinned message; capped per conversation.
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_pins (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(conversation_id, message_id)
);
create index if not exists conversation_pins_recent on public.conversation_pins(conversation_id, created_at desc);
alter table public.conversation_pins enable row level security;
revoke all on public.conversation_pins from public, anon, authenticated;
grant select on public.conversation_pins to authenticated;
grant all on public.conversation_pins to service_role;
drop policy if exists bitchat_pins_read on public.conversation_pins;
create policy bitchat_pins_read on public.conversation_pins for select to authenticated
  using(private.is_member(conversation_id));

create or replace function public.pin_message(p_message uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); row public.messages; conversation uuid; total integer;
begin
  select * into row from public.messages where id = p_message;
  if row.id is null or me is null or not private.is_member(row.conversation_id) then
    raise exception 'Message unavailable.';
  end if;
  conversation := row.conversation_id;
  if row.kind not in ('message','sticker','miss') then raise exception 'This message cannot be pinned.'; end if;
  select count(*) into total from public.conversation_pins where conversation_id = conversation;
  if total >= 25 and not exists(select 1 from public.conversation_pins where conversation_id = conversation and message_id = p_message) then
    raise exception 'Unpin something first — 25 pins is the limit.';
  end if;
  insert into public.conversation_pins(conversation_id, message_id, pinned_by)
  values(conversation, p_message, me)
  on conflict(conversation_id, message_id) do update set pinned_by = excluded.pinned_by, created_at = now();
  perform realtime.send(jsonb_build_object('conversation_id', conversation, 'message_id', p_message, 'pinned', true), 'pins', 'room:'||conversation::text, true);
  return jsonb_build_object('ok', true, 'message_id', p_message);
end;
$$;

create or replace function public.unpin_message(p_message uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); conversation uuid;
begin
  select conversation_id into conversation from public.messages where id = p_message;
  if conversation is null or me is null or not private.is_member(conversation) then
    raise exception 'Message unavailable.';
  end if;
  delete from public.conversation_pins where conversation_id = conversation and message_id = p_message;
  perform realtime.send(jsonb_build_object('conversation_id', conversation, 'message_id', p_message, 'pinned', false), 'pins', 'room:'||conversation::text, true);
  return jsonb_build_object('ok', true, 'message_id', p_message);
end;
$$;

-- One round trip for the pin tray: newest 25 pins with their message bodies.
create or replace function public.conversation_pins_list(p_conversation uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(item order by pinned_at desc), '[]'::jsonb) from (
    select p.created_at pinned_at, jsonb_build_object(
      'message_id', m.id,
      'user_id', m.user_id,
      'content', m.content,
      'media_url', m.media_url,
      'media_kind', m.media_kind,
      'kind', m.kind,
      'created_at', m.created_at,
      'pinned_by', p.pinned_by,
      'pinned_at', p.created_at,
      'author', (select jsonb_build_object('id', pr.id, 'username', pr.username, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url)
                 from public.profiles pr where pr.id = m.user_id)
    ) as item
    from public.conversation_pins p
    join public.messages m on m.id = p.message_id
    where p.conversation_id = p_conversation and private.is_member(p_conversation)
    order by p.created_at desc
    limit 25
  ) rows;
$$;

revoke all on function public.pin_message(uuid), public.unpin_message(uuid), public.conversation_pins_list(uuid) from public, anon;
grant execute on function public.pin_message(uuid), public.unpin_message(uuid), public.conversation_pins_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Calls. State lives here; SDP/ICE travel over a private broadcast topic.
-- ---------------------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller uuid not null references public.profiles(id) on delete cascade,
  callee uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('audio','video')),
  status text not null default 'ringing' check (status in ('ringing','active','declined','missed','ended','failed')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null
);
create index if not exists calls_conversation on public.calls(conversation_id, started_at desc);
create index if not exists calls_callee_ringing on public.calls(callee, started_at desc) where status = 'ringing';
alter table public.calls enable row level security;
revoke all on public.calls from public, anon, authenticated;
grant select on public.calls to authenticated;
grant all on public.calls to service_role;
drop policy if exists bitchat_calls_read on public.calls;
create policy bitchat_calls_read on public.calls for select to authenticated
  using(caller = (select auth.uid()) or callee = (select auth.uid()) or private.is_member(conversation_id));
alter publication supabase_realtime add table public.calls;

create or replace function public.start_call(p_conversation uuid, p_kind text default 'audio')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); c public.conversations; other uuid; created public.calls;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if p_kind is null or p_kind not in ('audio','video') then raise exception 'Choose a call type.'; end if;
  select * into c from public.conversations where id = p_conversation;
  if c.id is null or c.kind <> 'direct' then raise exception 'Calls are for one-to-one chats.'; end if;
  other := case when c.member_a = me then c.member_b else c.member_a end;
  if other is null then raise exception 'Conversation unavailable.'; end if;
  -- Anything still ringing for more than 90 seconds is a missed call.
  update public.calls set status = 'missed', ended_at = now()
   where conversation_id = p_conversation and status = 'ringing' and started_at < now() - interval '90 seconds';
  if exists(select 1 from public.calls where conversation_id = p_conversation and status in ('ringing','active')) then
    raise exception 'A call is already in progress here.';
  end if;
  insert into public.calls(conversation_id, caller, callee, kind)
  values(p_conversation, me, other, p_kind)
  returning * into created;
  perform realtime.send(
    jsonb_build_object('call_id', created.id, 'conversation_id', p_conversation, 'caller', me, 'callee', other, 'kind', p_kind, 'status', 'ringing', 'started_at', created.started_at),
    'call', 'call:'||p_conversation::text, true);
  return to_jsonb(created);
end;
$$;

create or replace function public.answer_call(p_call uuid, p_accept boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); row public.calls;
begin
  select * into row from public.calls where id = p_call for update;
  if row.id is null or me is null or row.callee <> me then raise exception 'Call unavailable.'; end if;
  if row.status <> 'ringing' then raise exception 'This call already ended.'; end if;
  if row.started_at < now() - interval '90 seconds' then
    update public.calls set status = 'missed', ended_at = now() where id = p_call;
    raise exception 'This call already ended.';
  end if;
  if coalesce(p_accept, true) then
    update public.calls set status = 'active', answered_at = now() where id = p_call returning * into row;
  else
    update public.calls set status = 'declined', ended_at = now(), ended_by = me where id = p_call returning * into row;
  end if;
  perform realtime.send(jsonb_build_object('call_id', row.id, 'conversation_id', row.conversation_id, 'status', row.status, 'by', me), 'call', 'call:'||row.conversation_id::text, true);
  return to_jsonb(row);
end;
$$;

create or replace function public.end_call(p_call uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); row public.calls; final text;
begin
  select * into row from public.calls where id = p_call for update;
  if row.id is null or me is null or me not in (row.caller, row.callee) then raise exception 'Call unavailable.'; end if;
  if row.status in ('ended','declined','missed','failed') then return to_jsonb(row); end if;
  final := case when row.status = 'ringing' then 'missed' else 'ended' end;
  update public.calls set status = final, ended_at = now(), ended_by = me where id = p_call returning * into row;
  perform realtime.send(jsonb_build_object('call_id', row.id, 'conversation_id', row.conversation_id, 'status', final, 'by', me), 'call', 'call:'||row.conversation_id::text, true);
  return to_jsonb(row);
end;
$$;

-- SDP and ICE candidates are relayed server-side so clients cannot spoof a peer.
create or replace function public.call_signal(p_call uuid, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); row public.calls;
begin
  select * into row from public.calls where id = p_call;
  if row.id is null or me is null or me not in (row.caller, row.callee) then raise exception 'Call unavailable.'; end if;
  if row.status not in ('ringing','active') then return false; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 16000 then
    raise exception 'Call signal too large.';
  end if;
  perform realtime.send(p_payload, 'signal', 'call:'||row.conversation_id::text, true);
  return true;
end;
$$;

create or replace function public.call_history(p_conversation uuid, p_limit integer default 40)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.started_at desc), '[]'::jsonb) from (
    select id, conversation_id, caller, callee, kind, status, started_at, answered_at, ended_at,
           greatest(0, coalesce(extract(epoch from (coalesce(ended_at, now()) - coalesce(answered_at, started_at))), 0))::integer as seconds
    from public.calls
    where conversation_id = p_conversation and private.is_member(p_conversation)
    order by started_at desc
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  ) c;
$$;

revoke all on function public.start_call(uuid,text), public.answer_call(uuid,boolean), public.end_call(uuid), public.call_signal(uuid,jsonb), public.call_history(uuid,integer) from public, anon;
grant execute on function public.start_call(uuid,text), public.answer_call(uuid,boolean), public.end_call(uuid), public.call_signal(uuid,jsonb), public.call_history(uuid,integer) to authenticated;

-- Private broadcast topics for call signaling. The restrictive write gate in
-- schema.sql only covers room: topics, and clients never insert here: every
-- frame is relayed by call_signal(). Reads must be allowed for members.
drop policy if exists bitchat_call_read on realtime.messages;
create policy bitchat_call_read on realtime.messages for select to authenticated using(
  extension = 'broadcast' and topic ~ '^call:[0-9a-f-]{36}$'
  and private.is_member(case when topic ~ '^call:[0-9a-f-]{36}$' then substring(topic from 6)::uuid else null end));

-- ---------------------------------------------------------------------------
-- 3. Ringing calls wake the partner's phone.
-- ---------------------------------------------------------------------------
-- Calls reuse the chat push queue: same worker secret, VAPID keys and delivery
-- function, with a `kind` flag so the worker sends a ringing payload instead of
-- a new-message one. Ringing jobs expire after 45 seconds.
-- One job row per ringing call, flagged so the worker builds a call payload.
alter table private.push_jobs alter column message_id drop not null;
alter table private.push_jobs add column if not exists call_id uuid references public.calls(id) on delete cascade;
alter table private.push_jobs add column if not exists kind text not null default 'message';
-- Subscriptions are per endpoint and kind so a phone can opt out of chat pushes
-- while still ringing for calls, or the other way round.
alter table private.push_subscriptions add column if not exists kind text not null default 'message';
create unique index if not exists push_subscriptions_endpoint_kind on private.push_subscriptions(user_id, endpoint, kind);

create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_kind text default 'message')
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); existing private.push_subscriptions; wanted text := case when p_kind = 'call' then 'call' else 'message' end;
begin
  if me is null or not private.push_endpoint_valid(p_endpoint)
    or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$'
    or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$'
    or get_byte(decode(translate(p_p256dh, '-_', '+/') || '=', 'base64'), 0) <> 4
    then raise exception 'Notification subscription unavailable.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text, 27));
  delete from private.push_subscriptions where user_id = me and updated_at < now() - interval '180 days';
  select * into existing from private.push_subscriptions where endpoint = p_endpoint and kind = wanted for update;
  if existing.id is not null and existing.user_id <> me then
    raise exception 'This device needs a new notification subscription.' using errcode = '42501';
  end if;
  if existing.id is null and (select count(*) from private.push_subscriptions where user_id = me) >= 10 then
    raise exception 'Notification device limit reached.'; end if;
  if existing.id is null then
    insert into private.push_subscriptions(user_id, endpoint, p256dh, auth_secret, kind)
    values(me, p_endpoint, p_p256dh, p_auth, wanted);
  else
    update private.push_subscriptions set p256dh = p_p256dh, auth_secret = p_auth, updated_at = clock_timestamp()
     where id = existing.id and user_id = me;
  end if;
end;
$$;
revoke all on function public.register_push_subscription(text,text,text,text) from public, anon;
grant execute on function public.register_push_subscription(text,text,text,text) to authenticated;

create or replace function private.enqueue_call_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.push_jobs(subscription_id, conversation_id, message_id, call_id, kind)
  select s.id, new.conversation_id, gen_random_uuid(), null::uuid, new.id, 'call'
  from private.push_subscriptions s
  where s.user_id = new.callee and s.kind = 'call'
    and s.updated_at > now() - interval '180 days'
    and not private.blocked(new.callee, new.caller)
  on conflict(subscription_id, conversation_id) do update set
    message_id = excluded.message_id, kind = 'call', call_id = excluded.call_id,
    created_at = clock_timestamp(), next_attempt = clock_timestamp(), attempts = 0, lease = null, lease_until = null;
  if found then
    begin perform private.wake_push_worker(); exception when others then null; end;
  end if;
  return new;
end;
$$;
drop trigger if exists bitchat_enqueue_call_push on public.calls;
create trigger bitchat_enqueue_call_push after insert on public.calls for each row execute function private.enqueue_call_push();

-- Chat pushes keep going to message subscriptions only.
-- Existing message subscriptions register with kind='message'; the client passes
-- 'call' to add a second, call-only subscription on the same endpoint.
create or replace function private.enqueue_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.push_jobs(subscription_id, conversation_id, message_id, call_id, kind)
  select s.id, new.conversation_id, new.id::uuid, null::uuid, 'message' from private.push_subscriptions s join (
    select c.member_a as user_id from public.conversations c where c.id = new.conversation_id and c.kind = 'direct'
    union select c.member_b from public.conversations c where c.id = new.conversation_id and c.kind = 'direct'
    union select cm.user_id from public.conversation_members cm where cm.conversation_id = new.conversation_id
  ) recipients on recipients.user_id = s.user_id
  where s.user_id <> new.user_id and s.updated_at > now() - interval '180 days' and s.kind = 'message'
    and private.push_eligible(s.user_id, new.conversation_id, new.id)
  on conflict(subscription_id, conversation_id) do update set
    message_id = excluded.message_id, kind = 'message', call_id = null, created_at = clock_timestamp(),
    next_attempt = clock_timestamp(), attempts = 0, lease = null, lease_until = null;
  if found then
    begin perform private.wake_push_worker(); exception when others then null; end;
  end if;
  return new;
end;
$$;

drop function if exists public.claim_push_jobs(text);

create function public.claim_push_jobs(p_secret text)
returns table(subscription_id uuid, conversation_id uuid, message_id uuid, call_id uuid, user_id uuid, endpoint text, p256dh text, auth_secret text, lease uuid, kind text)
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.push_authorized(p_secret), false) then raise exception 'Unauthorized.' using errcode = '42501'; end if;
  delete from private.push_subscriptions where updated_at < now() - interval '180 days';
  -- A ringing call is only worth waking for ~45 seconds.
  delete from private.push_jobs j where j.kind = 'call' and j.created_at < now() - interval '45 seconds';
  delete from private.push_jobs j using private.push_subscriptions s
    where s.id = j.subscription_id and (j.attempts >= 4 or (j.kind = 'message' and not private.push_eligible(s.user_id, j.conversation_id, j.message_id)));
  delete from private.push_jobs j where j.created_at < now() - interval '1 hour';
  return query with due as (
    select j.subscription_id, j.conversation_id from private.push_jobs j
    where j.next_attempt <= clock_timestamp() and (j.lease_until is null or j.lease_until < clock_timestamp())
    order by j.next_attempt limit 40 for update skip locked
  ), claimed as (
    update private.push_jobs j set attempts = j.attempts + 1, lease = gen_random_uuid(), lease_until = clock_timestamp() + interval '90 seconds'
    from due d where j.subscription_id = d.subscription_id and j.conversation_id = d.conversation_id
    returning j.*
  ) select j.subscription_id, j.conversation_id, j.message_id, j.call_id, s.user_id, s.endpoint, s.p256dh, s.auth_secret, j.lease, j.kind
    from claimed j join private.push_subscriptions s on s.id = j.subscription_id;
end;
$$;
revoke all on function public.claim_push_jobs(text) from public, anon, authenticated;
grant execute on function public.claim_push_jobs(text) to service_role;

notify pgrst, 'reload schema';
commit;
