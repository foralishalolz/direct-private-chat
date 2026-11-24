begin;
-- Pet is shared per direct conversation; no time decay or punitive streaks.
create table if not exists public.couple_pet (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  species text not null check (species in ('cat','dog','bunny')),
  feeds integer not null default 0 check (feeds between 0 and 1000000),
  plays integer not null default 0 check (plays between 0 and 1000000),
  cuddles integer not null default 0 check (cuddles between 0 and 1000000),
  last_action text not null default 'adopt' check (last_action in ('adopt','feed','play','cuddle','rename')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.couple_pet enable row level security;
revoke all on public.couple_pet from public, anon, authenticated;
grant select on public.couple_pet to authenticated;
grant all on public.couple_pet to service_role;
drop policy if exists couple_pet_read on public.couple_pet;
create policy couple_pet_read on public.couple_pet for select to authenticated using(private.is_member(conversation_id));

create or replace function public.care_couple_pet(p_conversation uuid, p_action text, p_name text default null, p_species text default null)
returns public.couple_pet language plpgsql security definer set search_path = '' as $$
declare result public.couple_pet; me uuid := auth.uid();
begin
  if me is null or not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id=p_conversation and kind='direct') then raise exception 'Pet unavailable.'; end if;
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
revoke all on function public.care_couple_pet(uuid,text,text,text) from public,anon;
grant execute on function public.care_couple_pet(uuid,text,text,text) to authenticated;

create table if not exists public.future_names (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 name text not null check (char_length(name) between 1 and 40),
 created_by uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index if not exists future_names_conversation_idx on public.future_names(conversation_id,created_at);
alter table public.future_names enable row level security;
revoke all on public.future_names from public,anon,authenticated;
grant select on public.future_names to authenticated;
grant all on public.future_names to service_role;
drop policy if exists future_names_read on public.future_names;
create policy future_names_read on public.future_names for select to authenticated using(private.is_member(conversation_id));
create or replace function public.change_future_name(p_conversation uuid,p_name text default null,p_remove uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id=p_conversation and kind='direct') then raise exception 'List unavailable.'; end if;
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
revoke all on function public.change_future_name(uuid,text,uuid) from public,anon;
grant execute on function public.change_future_name(uuid,text,uuid) to authenticated;

alter table public.shared_activity drop constraint if exists shared_activity_kind_check;
alter table public.shared_activity add constraint shared_activity_kind_check check(kind in ('makeout','game','draw','wyr','kiss','pet'));
create or replace function public.open_activity(p_conversation uuid, p_kind text, p_ref uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); row public.shared_activity;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if p_kind is null or p_kind not in ('makeout','game','draw','wyr','kiss','pet') then raise exception 'Unknown activity.'; end if;
  insert into public.shared_activity as a(conversation_id,kind,ref_id,opened_by,opened_at,closed_at,updated_at)
  values(p_conversation,p_kind,p_ref,me,now(),null,now())
  on conflict(conversation_id) do update set kind=excluded.kind,ref_id=excluded.ref_id,opened_by=excluded.opened_by,opened_at=excluded.opened_at,closed_at=null,updated_at=now()
  returning * into row;
  return to_jsonb(row);
end $$;
revoke all on function public.open_activity(uuid,text,uuid) from public,anon;
grant execute on function public.open_activity(uuid,text,uuid) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='couple_pet') then alter publication supabase_realtime add table public.couple_pet; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='future_names') then alter publication supabase_realtime add table public.future_names; end if;
end $$;
notify pgrst, 'reload schema';
commit;
