-- Explicit recovery when a crashed tab left a call active. This is only
-- invoked by a participant tapping the recovery action; it may end a real call.
create or replace function public.end_open_call(p_conversation uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); target uuid;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  select c.id into target from public.calls c
   where c.conversation_id = p_conversation and me in (c.caller,c.callee) and c.status in ('ringing','active')
   order by c.started_at desc limit 1 for update;
  if target is null then return false; end if;
  perform public.end_call(target);
  return true;
end;
$$;
revoke all on function public.end_open_call(uuid) from public, anon;
grant execute on function public.end_open_call(uuid) to authenticated;
