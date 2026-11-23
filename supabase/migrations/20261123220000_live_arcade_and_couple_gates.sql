begin;
create or replace function private.is_couple(p_conversation uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_member(p_conversation) and exists(select 1 from public.conversations c where c.id=p_conversation and c.kind='direct' and c.couple_a and c.couple_b);
$$;
revoke all on function private.is_couple(uuid) from public,anon;
grant execute on function private.is_couple(uuid) to authenticated;
drop policy if exists couple_pet_read on public.couple_pet;
create policy couple_pet_read on public.couple_pet for select to authenticated using(private.is_couple(conversation_id));
drop policy if exists future_names_read on public.future_names;
create policy future_names_read on public.future_names for select to authenticated using(private.is_couple(conversation_id));
create or replace function public.care_couple_pet(p_conversation uuid, p_action text, p_name text default null, p_species text default null)
returns public.couple_pet language plpgsql security definer set search_path = '' as $$
declare result public.couple_pet; me uuid := auth.uid();
begin
  if me is null or not private.is_couple(p_conversation) then raise exception 'Pet unavailable.'; end if;
  if p_action is null or p_action not in ('adopt','feed','play','cuddle','rename') then raise exception 'Unknown action.'; end if;
  if p_action in ('adopt','rename') and (p_name is null or char_length(btrim(p_name)) not between 1 and 24) then raise exception 'Choose a name between 1 and 24 characters.'; end if;
  if p_action='adopt' then
    if p_species is null or p_species not in ('cat','dog','bunny') then raise exception 'Choose a pet.'; end if;
    insert into public.couple_pet(conversation_id,name,species,updated_by) values(p_conversation,btrim(p_name),p_species,me) on conflict(conversation_id) do nothing;
  else
    update public.couple_pet set name=case when p_action='rename' then btrim(p_name) else name end,
      feeds=case when p_action='feed' then least(feeds+1,1000000) else feeds end,
      plays=case when p_action='play' then least(plays+1,1000000) else plays end,
      cuddles=case when p_action='cuddle' then least(cuddles+1,1000000) else cuddles end,
      last_action=p_action,updated_by=me,updated_at=clock_timestamp()
      where conversation_id=p_conversation;
  end if;
  select * into result from public.couple_pet where conversation_id=p_conversation;
  if result.conversation_id is null then raise exception 'Adopt a pet first.'; end if;
  return result;
end $$;
create or replace function public.change_future_name(p_conversation uuid,p_name text default null,p_remove uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_couple(p_conversation) then raise exception 'List unavailable.'; end if;
  perform 1 from public.conversations where id=p_conversation for update;
  if p_remove is not null then delete from public.future_names where id=p_remove and conversation_id=p_conversation;
  else
    if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then raise exception 'Enter a name of up to 40 characters.'; end if;
    if (select count(*) from public.future_names where conversation_id=p_conversation)>=40 then raise exception 'The list is full.'; end if;
    if not exists(select 1 from public.future_names where conversation_id=p_conversation and lower(name)=lower(btrim(p_name))) then
      insert into public.future_names(conversation_id,name,created_by) values(p_conversation,btrim(p_name),auth.uid());
    end if;
  end if;
end $$;
drop policy if exists bitchat_kiss_read on public.kiss_meter;
create policy bitchat_kiss_read on public.kiss_meter for select to authenticated using(private.is_couple(conversation_id));
create or replace function public.kiss(p_conversation uuid, p_count integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  taps integer := greatest(1, least(coalesce(p_count, 1), 12));
  is_a boolean;
  row public.kiss_meter;
begin
  if me is null or not private.is_couple(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  select c.member_a = me into is_a from public.conversations c where c.id = p_conversation and c.kind = 'direct';
  if is_a is null then raise exception 'Makeout needs a one-to-one chat.'; end if;
  insert into public.kiss_meter as k(conversation_id, taps_a, taps_b)
  values(p_conversation, case when is_a then taps else 0 end, case when is_a then 0 else taps end)
  on conflict(conversation_id) do update set
    taps_a = k.taps_a + case when is_a then taps else 0 end,
    taps_b = k.taps_b + case when is_a then 0 else taps end,
    last_at = now()
  returning * into row;
  return jsonb_build_object('taps_a', row.taps_a, 'taps_b', row.taps_b, 'last_at', row.last_at);
end;
$$;

alter table public.shared_activity drop constraint if exists shared_activity_kind_check;
alter table public.shared_activity add constraint shared_activity_kind_check check(kind in ('makeout','game','draw','wyr','kiss','pet','arcade','listen'));
create or replace function public.open_activity(p_conversation uuid,p_kind text,p_ref uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); row public.shared_activity;
begin
 if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
 if p_kind is null or p_kind not in ('makeout','game','draw','wyr','kiss','pet','arcade','listen') then raise exception 'Unknown activity.'; end if;
 if p_kind in ('makeout','kiss','pet') and not private.is_couple(p_conversation) then raise exception 'Both people must enable couple mode.'; end if;
 insert into public.shared_activity as a(conversation_id,kind,ref_id,opened_by,opened_at,closed_at,updated_at) values(p_conversation,p_kind,p_ref,me,clock_timestamp(),null,clock_timestamp())
 on conflict(conversation_id) do update set kind=excluded.kind,ref_id=excluded.ref_id,opened_by=excluded.opened_by,opened_at=excluded.opened_at,closed_at=null,updated_at=excluded.updated_at returning * into row;
 return to_jsonb(row);
end $$;

notify pgrst,'reload schema';
commit;
