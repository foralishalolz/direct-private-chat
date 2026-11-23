-- TURN issuance is limited per authenticated call participant, not per edge instance.
create table if not exists private.turn_issuance_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null default now(),
  requests integer not null default 0
);
revoke all on private.turn_issuance_limits from public, anon, authenticated;

create or replace function public.reserve_turn_credential(p_user uuid, p_call uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare count_now integer;
begin
  if p_user is null or not exists (
    select 1 from public.calls c where c.id = p_call and p_user in (c.caller, c.callee)
      and (c.status = 'active' or (c.status = 'ringing' and c.started_at > now() - interval '90 seconds'))
  ) then return false; end if;
  insert into private.turn_issuance_limits (user_id,window_start,requests)
  values (p_user,now(),1)
  on conflict (user_id) do update set
    window_start = case when private.turn_issuance_limits.window_start < now() - interval '1 hour' then now() else private.turn_issuance_limits.window_start end,
    requests = case when private.turn_issuance_limits.window_start < now() - interval '1 hour' then 1 else private.turn_issuance_limits.requests + 1 end
  returning requests into count_now;
  return count_now <= 20;
end;
$$;
revoke all on function public.reserve_turn_credential(uuid,uuid) from public, anon, authenticated;
grant execute on function public.reserve_turn_credential(uuid,uuid) to service_role;
