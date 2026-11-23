begin;
create table if not exists public.couple_reels (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 added_by uuid not null references public.profiles(id) on delete cascade,
 url text not null check (char_length(url)<=2048),
 created_at timestamptz not null default now()
);
create index if not exists couple_reels_order on public.couple_reels(conversation_id,created_at desc,id desc);
alter table public.couple_reels enable row level security;
revoke all on public.couple_reels from public,anon,authenticated;
grant select on public.couple_reels to authenticated;
grant all on public.couple_reels to service_role;
drop policy if exists couple_reels_read on public.couple_reels;
create policy couple_reels_read on public.couple_reels for select to authenticated using(private.is_couple(conversation_id));
create or replace function public.add_couple_reel(p_conversation uuid,p_url text) returns public.couple_reels language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); value text:=btrim(coalesce(p_url,'')); host text; r public.couple_reels;
begin
 if me is null or not private.is_couple(p_conversation) then raise exception 'Reels unavailable.'; end if;
 if not exists(select 1 from public.profiles where id=me and is_pro) then raise exception 'Pro is required to add links.'; end if;
 if char_length(value)>2048 or value !~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(/[^[:space:]<>]*)?$' then raise exception 'Use a valid HTTPS link.'; end if;
 host:=lower(split_part(split_part(value,'/',3),'?',1));
 if host !~ '^[a-z0-9-]+([.][a-z0-9-]+)+$' or host ~ '^[0-9.]+$' or host ~ '(^|[.])(localhost|local|internal)$' then raise exception 'Use a public website address.'; end if;
 perform 1 from public.conversations where id=p_conversation for update;
 if not private.is_couple(p_conversation) then raise exception 'Reels unavailable.'; end if;
 if (select count(*) from public.couple_reels where conversation_id=p_conversation)>=100 then raise exception 'Remove a link to add more.'; end if;
 insert into public.couple_reels(conversation_id,added_by,url) values(p_conversation,me,value) returning * into r;
 return r;
end $$;
create or replace function public.remove_couple_reel(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare conversation uuid;
begin
 select conversation_id into conversation from public.couple_reels where id=p_id;
 if conversation is null then raise exception 'Reel unavailable.'; end if;
 perform 1 from public.conversations where id=conversation for update;
 if not private.is_couple(conversation) then raise exception 'Reel unavailable.'; end if;
 delete from public.couple_reels where id=p_id and conversation_id=conversation;
end $$;
revoke all on function public.add_couple_reel(uuid,text), public.remove_couple_reel(uuid) from public,anon;
grant execute on function public.add_couple_reel(uuid,text), public.remove_couple_reel(uuid) to authenticated;
do $$ begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='couple_reels') then alter publication supabase_realtime add table public.couple_reels; end if; end $$;
notify pgrst,'reload schema';
commit;
