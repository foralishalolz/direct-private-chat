-- Private Web Push devices and a bounded, coalescing delivery queue.
-- Browser keys are public encryption keys; VAPID signing keys stay inside Vault.
begin;
create table private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check(length(endpoint) <= 2048),
  p256dh text not null,
  auth_secret text not null,
  updated_at timestamptz not null default clock_timestamp()
);
create index push_subscriptions_user on private.push_subscriptions(user_id);
create table private.push_jobs (
  subscription_id uuid not null references private.push_subscriptions(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  next_attempt timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  lease uuid,
  lease_until timestamptz,
  primary key(subscription_id, conversation_id)
);
create index push_jobs_due on private.push_jobs(next_attempt);
create index push_jobs_conversation on private.push_jobs(conversation_id);
create index push_jobs_message on private.push_jobs(message_id);
create table private.push_dispatch (
  id boolean primary key default true check(id),
  last_wake timestamptz not null default '-infinity'
);
insert into private.push_dispatch(id) values(true);
alter table private.push_subscriptions enable row level security;
alter table private.push_jobs enable row level security;
alter table private.push_dispatch enable row level security;
revoke all on private.push_subscriptions, private.push_jobs, private.push_dispatch from public, anon, authenticated, service_role;

create function private.push_endpoint_valid(p_endpoint text)
returns boolean language sql immutable set search_path = '' as $$
  select p_endpoint is not null and length(p_endpoint) between 20 and 2048
    and p_endpoint ~ '^https://(fcm[.]googleapis[.]com|([a-z0-9-]+[.])*push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|([a-z0-9-]+[.])+notify[.]windows[.]com)/[A-Za-z0-9_/?=&%+.:~-]+$';
$$;
revoke all on function private.push_endpoint_valid(text) from public, anon, authenticated;

create function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); existing private.push_subscriptions;
begin
  if me is null or not private.push_endpoint_valid(p_endpoint)
    or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$'
    or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$'
    or get_byte(decode(translate(p_p256dh, '-_', '+/') || '=', 'base64'), 0) <> 4
    then raise exception 'Notification subscription unavailable.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text, 27));
  delete from private.push_subscriptions where user_id = me and updated_at < now() - interval '180 days';
  select * into existing from private.push_subscriptions where endpoint = p_endpoint for update;
  if existing.id is not null and existing.user_id <> me then
    raise exception 'This device needs a new notification subscription.' using errcode = '42501';
  end if;
  if existing.id is null and (select count(*) from private.push_subscriptions where user_id = me) >= 10 then
    raise exception 'Notification device limit reached.'; end if;
  insert into private.push_subscriptions(user_id, endpoint, p256dh, auth_secret)
  values(me, p_endpoint, p_p256dh, p_auth)
  on conflict(endpoint) do update set p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, updated_at = clock_timestamp()
  where push_subscriptions.user_id = me;
end;
$$;
create function public.unregister_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from private.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
create function public.push_public_key()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'bitchat_push_public_key' and auth.uid() is not null;
$$;
revoke all on function public.register_push_subscription(text,text,text), public.unregister_push_subscription(text), public.push_public_key() from public, anon;
grant execute on function public.register_push_subscription(text,text,text), public.unregister_push_subscription(text), public.push_public_key() to authenticated;

do $$ begin
  if not exists(select 1 from vault.secrets where name = 'bitchat_push_worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'bitchat_push_worker_secret');
  end if;
end $$;
create function private.push_authorized(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select length(p_secret) = 64 and exists(select 1 from vault.decrypted_secrets where name = 'bitchat_push_worker_secret' and decrypted_secret = p_secret);
$$;
create function public.push_server_config(p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.push_authorized(p_secret), false) then return null; end if;
  return jsonb_build_object(
    'publicKey', (select decrypted_secret from vault.decrypted_secrets where name = 'bitchat_push_public_key'),
    'privateKey', (select decrypted_secret from vault.decrypted_secrets where name = 'bitchat_push_private_key'),
    'subject', 'https://bitchwyat.vercel.app');
end;
$$;
create function public.store_push_vapid(p_secret text, p_public text, p_private text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.push_authorized(p_secret), false) then return null; end if;
  if p_public is null or p_public !~ '^[A-Za-z0-9_-]{87}$' or p_private is null or p_private !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'Invalid VAPID keys.'; end if;
  perform pg_advisory_xact_lock(1162, 27);
  if not exists(select 1 from vault.secrets where name = 'bitchat_push_public_key') then
    perform vault.create_secret(p_public, 'bitchat_push_public_key');
    perform vault.create_secret(p_private, 'bitchat_push_private_key');
  end if;
  return public.push_server_config(p_secret);
end;
$$;

create function private.push_eligible(p_user uuid, p_conversation uuid, p_message uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
    left join public.chat_preferences cp on cp.user_id = p_user and cp.conversation_id = c.id
    left join private.read_markers r on r.user_id = p_user and r.conversation_id = c.id
    where m.id = p_message and c.id = p_conversation and m.user_id <> p_user
      and m.created_at > now() - interval '1 hour'
      and m.created_at > coalesce(cp.cleared_before, '-infinity')
      and m.created_at > coalesce(r.seen_at, '-infinity')
      and not coalesce(cp.archived, false) and not private.blocked(p_user, m.user_id)
      and ((c.kind = 'direct' and p_user in (c.member_a, c.member_b)) or
        (c.kind = 'group' and exists(select 1 from public.conversation_members cm
          where cm.user_id = p_user and cm.conversation_id = c.id and cm.joined_at <= m.created_at)))
  );
$$;

create function private.wake_push_worker(p_force boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare project_url text; worker_secret text; request_id bigint;
begin
  -- At most ten immediate wake-ups per second; Cron retries undelivered jobs.
  if not p_force and not exists(select 1 from private.push_jobs) then return null; end if;
  if p_force and not exists(select 1 from private.push_jobs) and exists(select 1 from vault.secrets where name = 'bitchat_push_public_key') then return null; end if;
  update private.push_dispatch set last_wake = clock_timestamp()
    where id and (p_force or last_wake < clock_timestamp() - interval '100 milliseconds');
  if not found then return null; end if;
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'bitchat_project_url';
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name = 'bitchat_push_worker_secret';
  if project_url is null or worker_secret is null then return null; end if;
  select net.http_post(url := project_url || '/functions/v1/push-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', worker_secret),
    body := '{}'::jsonb, timeout_milliseconds := 10000) into request_id;
  return request_id;
end;
$$;
create function private.enqueue_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.push_jobs(subscription_id, conversation_id, message_id)
  select s.id, new.conversation_id, new.id from private.push_subscriptions s join (
    select c.member_a as user_id from public.conversations c where c.id = new.conversation_id and c.kind = 'direct'
    union select c.member_b from public.conversations c where c.id = new.conversation_id and c.kind = 'direct'
    union select cm.user_id from public.conversation_members cm where cm.conversation_id = new.conversation_id
  ) recipients on recipients.user_id = s.user_id
  where s.user_id <> new.user_id and s.updated_at > now() - interval '180 days'
    and private.push_eligible(s.user_id, new.conversation_id, new.id)
  on conflict(subscription_id, conversation_id) do update set
    message_id = excluded.message_id, created_at = clock_timestamp(), next_attempt = clock_timestamp(), attempts = 0, lease = null, lease_until = null;
  if found then
    -- A delivery failure must never roll back a successful chat message.
    begin perform private.wake_push_worker(); exception when others then null; end;
  end if;
  return new;
end;
$$;
create trigger bitchat_enqueue_push after insert on public.messages for each row execute function private.enqueue_push();

create function public.claim_push_jobs(p_secret text)
returns table(subscription_id uuid, conversation_id uuid, message_id uuid, user_id uuid, endpoint text, p256dh text, auth_secret text, lease uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.push_authorized(p_secret), false) then raise exception 'Unauthorized.' using errcode = '42501'; end if;
  delete from private.push_subscriptions where updated_at < now() - interval '180 days';
  delete from private.push_jobs j using private.push_subscriptions s
    where s.id = j.subscription_id and (j.created_at < now() - interval '1 hour' or j.attempts >= 4 or not private.push_eligible(s.user_id, j.conversation_id, j.message_id));
  return query with due as (
    select j.subscription_id, j.conversation_id from private.push_jobs j
    where j.next_attempt <= clock_timestamp() and (j.lease_until is null or j.lease_until < clock_timestamp())
    order by j.next_attempt limit 40 for update skip locked
  ), claimed as (
    update private.push_jobs j set attempts = j.attempts + 1, lease = gen_random_uuid(), lease_until = clock_timestamp() + interval '90 seconds'
    from due d where j.subscription_id = d.subscription_id and j.conversation_id = d.conversation_id
    returning j.*
  ) select j.subscription_id, j.conversation_id, j.message_id, s.user_id, s.endpoint, s.p256dh, s.auth_secret, j.lease
    from claimed j join private.push_subscriptions s on s.id = j.subscription_id;
end;
$$;
create function public.finish_push_job(p_secret text, p_subscription uuid, p_conversation uuid, p_message uuid, p_lease uuid, p_status integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.push_authorized(p_secret), false) then raise exception 'Unauthorized.' using errcode = '42501'; end if;
  if p_status in (404, 410) then
    delete from private.push_subscriptions s where s.id = p_subscription and exists(
      select 1 from private.push_jobs j where j.subscription_id = s.id and j.conversation_id = p_conversation and j.message_id = p_message and j.lease = p_lease);
  elsif p_status between 200 and 299 or p_status in (400, 401, 403, 413) then
    delete from private.push_jobs j where j.subscription_id = p_subscription and j.conversation_id = p_conversation and j.message_id = p_message and j.lease = p_lease;
  else
    update private.push_jobs j set lease = null, lease_until = null, next_attempt = clock_timestamp() + (power(2, j.attempts) * interval '15 seconds')
      where j.subscription_id = p_subscription and j.conversation_id = p_conversation and j.message_id = p_message and j.lease = p_lease;
  end if;
end;
$$;
revoke all on function private.push_authorized(text), private.push_eligible(uuid,uuid,uuid), private.wake_push_worker(boolean), private.enqueue_push() from public, anon, authenticated, service_role;
revoke all on function public.push_server_config(text), public.store_push_vapid(text,text,text), public.claim_push_jobs(text), public.finish_push_job(text,uuid,uuid,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.push_server_config(text), public.store_push_vapid(text,text,text), public.claim_push_jobs(text), public.finish_push_job(text,uuid,uuid,uuid,uuid,integer) to service_role;
select cron.schedule('bitchat-push-retry', '* * * * *', 'select private.wake_push_worker(true);');
commit;
