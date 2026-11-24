begin;
-- A shared timeline referencing a chat audio message; no audio is copied.
create table if not exists public.shared_listening (
 conversation_id uuid primary key references public.conversations(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 playing boolean not null default false,
 position double precision not null default 0 check(position>=0 and position<=86400),
 changed_at timestamptz not null default clock_timestamp(),
 changed_by uuid not null references public.profiles(id)
);
alter table public.shared_listening enable row level security;
revoke all on public.shared_listening from public,anon,authenticated;
grant select on public.shared_listening to authenticated;
grant all on public.shared_listening to service_role;
drop policy if exists shared_listening_read on public.shared_listening;
create policy shared_listening_read on public.shared_listening for select to authenticated using(private.is_member(conversation_id));
create or replace function public.control_listening(p_conversation uuid,p_action text,p_message uuid default null,p_position double precision default null) returns public.shared_listening language plpgsql security definer set search_path='' as $$
declare r public.shared_listening; me uuid:=auth.uid();
begin
 if me is null or not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id=p_conversation and kind='direct') then raise exception 'Listening unavailable.'; end if;
 if p_action='start' then
  if not exists(select 1 from public.messages m where m.id=p_message and m.conversation_id=p_conversation and m.media_kind='audio' and m.media_url is not null and m.created_at>clock_timestamp()-interval '24 hours' and m.created_at>private.visible_after(p_conversation)) then raise exception 'Audio unavailable.'; end if;
  insert into public.shared_listening as s(conversation_id,message_id,playing,position,changed_at,changed_by) values(p_conversation,p_message,false,0,clock_timestamp(),me)
  on conflict(conversation_id) do update set message_id=excluded.message_id,playing=false,position=0,changed_at=excluded.changed_at,changed_by=me returning * into r;
  perform public.open_activity(p_conversation,'listen');
 elsif p_action in ('play','pause') then
  select * into r from public.shared_listening where conversation_id=p_conversation for update;
  if r.message_id is null or r.message_id is distinct from p_message then raise exception 'Audio changed. Rejoin the session.'; end if;
  if not exists(select 1 from public.messages m where m.id=r.message_id and m.conversation_id=p_conversation and m.media_kind='audio' and m.media_url is not null and m.created_at>clock_timestamp()-interval '24 hours' and m.created_at>private.visible_after(p_conversation)) then raise exception 'Audio unavailable.'; end if;
  if p_position is null or p_position<0 or p_position>86400 or p_position::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid position.'; end if;
  update public.shared_listening set playing=(p_action='play'),position=p_position,changed_at=clock_timestamp(),changed_by=me where conversation_id=p_conversation returning * into r;
 else raise exception 'Unknown action.'; end if;
 return r;
end $$;
revoke all on function public.control_listening(uuid,text,uuid,double precision) from public,anon;
grant execute on function public.control_listening(uuid,text,uuid,double precision) to authenticated;
do $$ begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shared_listening') then alter publication supabase_realtime add table public.shared_listening; end if; end $$;

notify pgrst,'reload schema';
commit;
