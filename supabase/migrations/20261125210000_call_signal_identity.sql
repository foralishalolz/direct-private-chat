-- Bind every broadcast to its actual authenticated sender and call. The old
-- clients ignore callId, so this is backward-compatible with deployed builds.
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
  perform realtime.send((p_payload - 'from' - 'callId') || jsonb_build_object('from', me, 'callId', row.id), 'signal', 'call:'||row.conversation_id::text, true);
  return true;
end;
$$;
