begin;
alter table public.live_arcade drop constraint if exists live_arcade_mode_check;
alter table public.live_arcade add constraint live_arcade_mode_check check(mode in ('four','garden','race','grid'));
create or replace function public.start_live_arcade(p_conversation uuid,p_mode text) returns public.live_arcade language plpgsql security definer set search_path='' as $$
declare r public.live_arcade; me uuid:=auth.uid();
begin
 if me is null or not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id=p_conversation and kind='direct' and member_a is not null and member_b is not null) or p_mode is null or p_mode not in ('four','garden','race','grid') then raise exception 'Game unavailable.'; end if;
 perform 1 from public.conversations where id=p_conversation for update;
 select * into r from public.live_arcade where conversation_id=p_conversation;
 if r.conversation_id is not null and not r.finished then raise exception 'End the current game first.'; end if;
 insert into public.live_arcade as a(conversation_id,round_id,mode,board,started_by,next_player,last_player,winner,finished,ready_a,ready_b,ready_at,updated_at)
 values(p_conversation,gen_random_uuid(),p_mode,repeat('-',case when p_mode='four' then 42 when p_mode='garden' then 16 when p_mode='grid' then 25 else 1 end),me,case when p_mode='race' then null else me end,null,null,false,false,false,null,clock_timestamp())
 on conflict(conversation_id) do update set round_id=excluded.round_id,mode=excluded.mode,board=excluded.board,started_by=excluded.started_by,next_player=excluded.next_player,last_player=null,winner=null,finished=false,ready_a=false,ready_b=false,ready_at=null,updated_at=excluded.updated_at returning * into r;
 perform public.open_activity(p_conversation,'arcade');
 return r;
end $$;
create or replace function public.play_live_arcade(p_conversation uuid,p_round uuid,p_action text,p_cell integer default null) returns public.live_arcade language plpgsql security definer set search_path='' as $$
declare r public.live_arcade; me uuid:=auth.uid(); a uuid; b uuid; other uuid; token text; pos integer; rr integer; cc integer; dr integer; dc integer; k integer; win boolean:=false; line boolean;
begin
 if me is null or not private.is_member(p_conversation) then raise exception 'Game unavailable.'; end if;
 select member_a,member_b into a,b from public.conversations where id=p_conversation and kind='direct';
 if me is distinct from a and me is distinct from b then raise exception 'Game unavailable.'; end if;
 other:=case when me=a then b else a end; token:=case when me=a then 'A' else 'B' end;
 select * into r from public.live_arcade where conversation_id=p_conversation for update;
 if r.conversation_id is null or r.finished or r.round_id is distinct from p_round then raise exception 'Game is over.'; end if;
 if p_action='end' then r.finished:=true;
 elsif r.mode='race' and p_action='ready' then
  if me=a then r.ready_a:=true; else r.ready_b:=true; end if;
  if r.ready_a and r.ready_b and r.ready_at is null then r.ready_at:=clock_timestamp()+interval '3 seconds'; end if;
 elsif r.mode='race' and p_action='tap' then
  if r.ready_at is null or clock_timestamp()<r.ready_at then raise exception 'Wait for GO.'; end if;
  r.winner:=me; r.finished:=true; r.last_player:=me;
 elsif r.mode='four' and p_action='move' then
  if r.next_player<>me then raise exception 'Wait for your turn.'; end if;
  if p_cell is null or p_cell<0 or p_cell>6 then raise exception 'Choose a column.'; end if;
  pos:=null;
  for rr in reverse 5..0 loop if substring(r.board from rr*7+p_cell+1 for 1)='-' then pos:=rr*7+p_cell+1; exit; end if; end loop;
  if pos is null then raise exception 'Column is full.'; end if;
  r.board:=overlay(r.board placing token from pos for 1); r.last_player:=me; r.next_player:=other;
  for rr in 0..5 loop for cc in 0..6 loop
   for dr in -1..1 loop for dc in 0..1 loop
    if (dr<>0 or dc<>0) and rr+3*dr between 0 and 5 and cc+3*dc between 0 and 6 then
     line:=true; for k in 0..3 loop if substring(r.board from (rr+k*dr)*7+cc+k*dc+1 for 1)<>token then line:=false; exit; end if; end loop;
     if line then win:=true; end if;
    end if;
   end loop; end loop;
  end loop; end loop;
  if win then r.finished:=true; r.winner:=me; elsif position('-' in r.board)=0 then r.finished:=true; end if;
 elsif r.mode='grid' and p_action='move' then
  if r.next_player<>me then raise exception 'Wait for your turn.'; end if;
  if p_cell is null or p_cell<0 or p_cell>24 or substring(r.board from p_cell+1 for 1)<>'-' then raise exception 'Choose an empty spot.'; end if;
  r.board:=overlay(r.board placing token from p_cell+1 for 1);r.last_player:=me;r.next_player:=other;
  for rr in 0..4 loop for cc in 0..4 loop
   for dr in -1..1 loop for dc in 0..1 loop
    if (dr<>0 or dc<>0) and rr+3*dr between 0 and 4 and cc+3*dc between 0 and 4 then
     line:=true; for k in 0..3 loop if substring(r.board from (rr+k*dr)*5+cc+k*dc+1 for 1)<>token then line:=false; exit; end if; end loop;
     if line then win:=true; end if;
    end if;
   end loop; end loop;
  end loop; end loop;
  if win then r.finished:=true;r.winner:=me; elsif position('-' in r.board)=0 then r.finished:=true; end if;
 elsif r.mode='garden' and p_action='move' then
  if r.next_player<>me then raise exception 'Wait for your turn.'; end if;
  if p_cell is null or p_cell<0 or p_cell>15 or substring(r.board from p_cell+1 for 1)<>'-' then raise exception 'Choose an empty spot.'; end if;
  r.board:=overlay(r.board placing token from p_cell+1 for 1);r.last_player:=me;r.next_player:=other;
  if position('-' in r.board)=0 then r.finished:=true; end if;
 else raise exception 'Unknown move.'; end if;
 update public.live_arcade set board=r.board,next_player=r.next_player,last_player=r.last_player,winner=r.winner,finished=r.finished,ready_a=r.ready_a,ready_b=r.ready_b,ready_at=r.ready_at,updated_at=clock_timestamp() where conversation_id=p_conversation returning * into r;
 return r;
end $$;
revoke all on function public.start_live_arcade(uuid,text),public.play_live_arcade(uuid,uuid,text,integer) from public,anon;
grant execute on function public.start_live_arcade(uuid,text),public.play_live_arcade(uuid,uuid,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
