-- Call push registration and enqueueing must coexist with message pushes.
-- A single browser endpoint can have both kinds, but never belong to two users.
alter table private.push_subscriptions drop constraint if exists push_subscriptions_endpoint_key;
create unique index if not exists push_subscriptions_endpoint_kind_global on private.push_subscriptions(endpoint, kind);

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
  perform pg_advisory_xact_lock(hashtextextended(p_endpoint, 28));
  delete from private.push_subscriptions where user_id = me and updated_at < now() - interval '180 days';
  if exists(select 1 from private.push_subscriptions where endpoint = p_endpoint and user_id <> me) then
    raise exception 'This device needs a new notification subscription.' using errcode = '42501';
  end if;
  select * into existing from private.push_subscriptions where endpoint = p_endpoint and kind = wanted for update;
  if existing.id is null and not exists(select 1 from private.push_subscriptions where user_id = me and endpoint = p_endpoint)
     and (select count(distinct endpoint) from private.push_subscriptions where user_id = me) >= 10 then
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
-- Retain the original API for older clients, without relying on endpoint-only uniqueness.
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language sql security definer set search_path = '' as $$
  select public.register_push_subscription(p_endpoint, p_p256dh, p_auth, 'message');
$$;

create or replace function private.enqueue_call_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.push_jobs(subscription_id, conversation_id, message_id, call_id, kind)
  select s.id, new.conversation_id, null::uuid, new.id, 'call'
  from private.push_subscriptions s
  where s.user_id = new.callee and s.kind = 'call'
    and s.updated_at > now() - interval '180 days'
    and not private.blocked(new.callee, new.caller)
  on conflict(subscription_id, conversation_id) do update set
    message_id = null, kind = 'call', call_id = excluded.call_id,
    created_at = clock_timestamp(), next_attempt = clock_timestamp(), attempts = 0, lease = null, lease_until = null;
  if found then
    begin perform private.wake_push_worker(); exception when others then null; end;
  end if;
  return new;
end;
$$;

-- Call jobs have no associated message; identify the lease with NULL-safe equality.
create or replace function public.finish_push_job(p_secret text, p_subscription uuid, p_conversation uuid, p_message uuid, p_lease uuid, p_status integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.push_authorized(p_secret), false) then raise exception 'Unauthorized.' using errcode = '42501'; end if;
  if p_status in (404, 410) then
    delete from private.push_subscriptions s where s.id = p_subscription and exists(
      select 1 from private.push_jobs j where j.subscription_id = s.id and j.conversation_id = p_conversation and j.message_id is not distinct from p_message and j.lease = p_lease);
  elsif p_status between 200 and 299 or p_status in (400, 401, 403, 413) then
    delete from private.push_jobs j where j.subscription_id = p_subscription and j.conversation_id = p_conversation and j.message_id is not distinct from p_message and j.lease = p_lease;
  else
    update private.push_jobs j set lease = null, lease_until = null, next_attempt = clock_timestamp() + (power(2, j.attempts) * interval '15 seconds')
      where j.subscription_id = p_subscription and j.conversation_id = p_conversation and j.message_id is not distinct from p_message and j.lease = p_lease;
  end if;
end;
$$;

-- Cancel jobs waiting to be dispatched when the call is no longer ringing.
create or replace function private.cancel_call_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from private.push_jobs where kind = 'call' and call_id = new.id;
  return new;
end;
$$;
drop trigger if exists bitchat_cancel_call_push on public.calls;
create trigger bitchat_cancel_call_push after update of status on public.calls
for each row when (old.status = 'ringing' and new.status <> 'ringing') execute function private.cancel_call_push();
notify pgrst, 'reload schema';
