-- Replace a pending ring with a privacy-preserving missed-call notification.
-- A call subscription is separate from a message subscription, so this never
-- consumes a chat message job. The existing queue lease prevents an old send
-- from completing a newer job.
create or replace function private.cancel_call_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from private.push_jobs where kind = 'call' and call_id = new.id;
  if new.status = 'missed' and new.callee is not null and not private.blocked(new.callee, new.caller) then
    insert into private.push_jobs(subscription_id, conversation_id, message_id, call_id, kind)
    select s.id, new.conversation_id, null::uuid, new.id, 'missed_call'
      from private.push_subscriptions s
     where s.user_id = new.callee and s.kind = 'call' and s.updated_at > now() - interval '180 days'
    on conflict(subscription_id, conversation_id) do update set
      message_id = null, call_id = excluded.call_id, kind = excluded.kind,
      created_at = clock_timestamp(), next_attempt = clock_timestamp(), attempts = 0, lease = null, lease_until = null;
    if found then
      begin perform private.wake_push_worker(); exception when others then null; end;
    end if;
  end if;
  return new;
end;
$$;

-- A caller's tab can disappear without sending hangup. Expire abandoned
-- ringing calls server-side so the callee still gets a missed-call record.
create or replace function private.expire_ringing_calls()
returns void language sql security definer set search_path = '' as $$
  update public.calls set status = 'missed', ended_at = clock_timestamp()
   where status = 'ringing' and started_at < clock_timestamp() - interval '90 seconds';
$$;
revoke all on function private.expire_ringing_calls() from public, anon, authenticated;
select cron.schedule('bitchat-expire-calls', '* * * * *', 'select private.expire_ringing_calls();');
