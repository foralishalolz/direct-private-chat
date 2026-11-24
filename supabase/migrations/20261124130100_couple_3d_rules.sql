begin;
create or replace function public.submit_couple_3d(p_conversation uuid,p_round uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns public.couple_3d_match language plpgsql security definer set search_path='' as $$
declare r public.couple_3d_match; me uuid:=auth.uid(); a uuid; b uuid; side text;
  item_id text; expected text; next_items jsonb; new_a integer; new_b integer; done boolean; champ uuid;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Game unavailable.'; end if;
  select member_a,member_b into a,b from public.conversations where id=p_conversation and kind='direct';
  if a is null or b is null or (me is distinct from a and me is distinct from b) then raise exception 'Game unavailable.'; end if;
  select * into r from public.couple_3d_match where conversation_id=p_conversation for update;
  if r.conversation_id is null or r.finished or r.round_id is distinct from p_round then raise exception 'Round is over.'; end if;
  if p_action = 'end' then
    update public.couple_3d_match set finished=true,updated_at=clock_timestamp() where conversation_id=p_conversation returning * into r;
    return r;
  end if;
  if p_action is distinct from 'collect' or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>256 then raise exception 'Invalid move.'; end if;
  item_id:=p_payload->>'item';
  if item_id is null or item_id !~ '^[a-z0-9-]{1,24}$' then raise exception 'Invalid item.'; end if;
  if not exists(select 1 from jsonb_array_elements(r.items) as t(value) where t.value->>'id'=item_id and t.value->>'collected_by' is null) then raise exception 'Already collected.'; end if;
  if r.mode='rally' then
    select t.value->>'id' into expected from jsonb_array_elements(r.items) with ordinality as t(value,ord)
      where t.value->>'collected_by' is null order by t.ord limit 1;
    if item_id is distinct from expected then raise exception 'Follow the constellation.'; end if;
  end if;
  side:=case when me=a then 'a' else 'b' end;
  select coalesce(jsonb_agg(case when t.value->>'id'=item_id then jsonb_set(t.value,'{collected_by}',to_jsonb(side),false) else t.value end order by t.ord),'[]'::jsonb)
    into next_items from jsonb_array_elements(r.items) with ordinality as t(value,ord);
  new_a:=r.score_a+case when side='a' then 1 else 0 end;
  new_b:=r.score_b+case when side='b' then 1 else 0 end;
  done:=not exists(select 1 from jsonb_array_elements(next_items) as t(value) where t.value->>'collected_by' is null)
    or (r.mode='rally' and (new_a>=4 or new_b>=4));
  champ:=case when not done or r.mode='garden' then null when new_a>new_b then a when new_b>new_a then b else null end;
  update public.couple_3d_match set items=next_items,score_a=new_a,score_b=new_b,finished=done,winner=champ,updated_at=clock_timestamp()
    where conversation_id=p_conversation returning * into r;
  return r;
end $$;

revoke all on function public.submit_couple_3d(uuid,uuid,text,jsonb) from public, anon;
grant execute on function public.submit_couple_3d(uuid,uuid,text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
