-- Atomic stroke-level edits prevent unrelated simultaneous edits from being lost.
begin;
create or replace function public.edit_board(p_conversation uuid, p_upserts jsonb, p_remove jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); board public.drawing_board; item jsonb; result jsonb;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if p_upserts is null or p_remove is null or jsonb_typeof(p_upserts) <> 'array' or jsonb_typeof(p_remove) <> 'array'
    or jsonb_array_length(p_upserts) > 400 or jsonb_array_length(p_remove) > 400
    or length(p_upserts::text) > 120000 or length(p_remove::text) > 20000 then raise exception 'Drawing unavailable.'; end if;
  for item in select value from jsonb_array_elements(p_upserts) loop
    if jsonb_typeof(item) <> 'object' or coalesce(item->>'id','') !~ '^[a-zA-Z0-9-]{1,64}$'
      or coalesce(item->>'by','') !~ '^[a-zA-Z0-9-]{1,64}$'
      or coalesce(item->>'color','') !~ '^#[0-9a-fA-F]{6}$'
      or jsonb_typeof(item->'width') is distinct from 'number'
      or jsonb_typeof(item->'points') is distinct from 'array' then raise exception 'Invalid stroke.'; end if;
    if (item->>'width')::numeric not between 1 and 30 or jsonb_array_length(item->'points') not between 1 and 900
      or exists (select 1 from jsonb_array_elements(item->'points') pt where jsonb_typeof(pt) is distinct from 'array'
         or case when jsonb_typeof(pt) = 'array' then jsonb_array_length(pt) <> 2 else true end
         or case when jsonb_typeof(pt) = 'array' and jsonb_array_length(pt) = 2 then
           jsonb_typeof(pt->0) is distinct from 'number' or jsonb_typeof(pt->1) is distinct from 'number'
         else false end)
      then raise exception 'Invalid stroke.'; end if;
    if exists (select 1 from jsonb_array_elements(item->'points') pt where (pt->>0)::numeric not between 0 and 1 or (pt->>1)::numeric not between 0 and 1) then raise exception 'Invalid point.'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_remove) v where jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[a-zA-Z0-9-]{1,64}$') then raise exception 'Invalid stroke ID.'; end if;
  insert into public.drawing_board(conversation_id, strokes, updated_by) values(p_conversation, '[]'::jsonb, me) on conflict (conversation_id) do nothing;
  select * into board from public.drawing_board where conversation_id = p_conversation for update;
  select coalesce(jsonb_agg(s.value order by s.ordinality), '[]'::jsonb) into result
    from jsonb_array_elements(board.strokes) with ordinality s(value, ordinality)
    where not exists(select 1 from jsonb_array_elements(p_remove) r where r #>> '{}' = s.value->>'id')
      and not exists(select 1 from jsonb_array_elements(p_upserts) u where u->>'id' = s.value->>'id');
  result := result || p_upserts;
  if jsonb_array_length(result) > 400 or length(result::text) > 120000 then raise exception 'That drawing is too big.'; end if;
  update public.drawing_board set strokes = result, updated_by = me, updated_at = clock_timestamp(), closed = false
    where conversation_id = p_conversation returning * into board;
  return jsonb_build_object('strokes', board.strokes, 'updated_at', board.updated_at);
end;
$$;
revoke all on function public.edit_board(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.edit_board(uuid,jsonb,jsonb) to authenticated;

-- Either participant can leave an abandoned game and start another.
create or replace function public.end_game(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  select * into g from public.games where id = p_id for update;
  if g.id is null or auth.uid() is null or not private.is_member(g.conversation_id) then raise exception 'Game unavailable.'; end if;
  update public.games set ended_at = now() where id = p_id and ended_at is null;
end;
$$;
revoke all on function public.end_game(uuid) from public, anon;
grant execute on function public.end_game(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
