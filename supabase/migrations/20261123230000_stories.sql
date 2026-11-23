begin;
-- Public to signed-in users, except between people who have blocked each other.
create table if not exists public.stories (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 body text not null default '' check(char_length(body)<=280),
 media_path text,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '24 hours'),
 deleted_at timestamptz,
 check(length(btrim(body))>0 or media_path is not null)
);
create index if not exists stories_latest_idx on public.stories(created_at desc) where deleted_at is null;
alter table public.stories enable row level security;
revoke all on public.stories from public,anon,authenticated;
grant select on public.stories to authenticated;
grant all on public.stories to service_role;
drop policy if exists stories_read on public.stories;
create policy stories_read on public.stories for select to authenticated using(deleted_at is null and expires_at>now() and (user_id=auth.uid() or not private.blocked(auth.uid(),user_id)));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('story-media','story-media',false,5242880,array['image/webp','image/jpeg','image/png']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function private.story_media_read(p_name text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.stories s where s.media_path=p_name and s.deleted_at is null and s.expires_at>now() and (s.user_id=auth.uid() or not private.blocked(auth.uid(),s.user_id)));
$$;
revoke all on function private.story_media_read(text) from public,anon;
grant execute on function private.story_media_read(text) to authenticated;
drop policy if exists story_media_read on storage.objects;
create policy story_media_read on storage.objects for select to authenticated using(bucket_id='story-media' and private.story_media_read(name));
drop policy if exists story_media_insert on storage.objects;
create policy story_media_insert on storage.objects for insert to authenticated with check(bucket_id='story-media' and split_part(name,'/',1)=auth.uid()::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$');
drop policy if exists story_media_read_gate on storage.objects;
create policy story_media_read_gate on storage.objects as restrictive for select to authenticated using(bucket_id<>'story-media' or private.story_media_read(name));
drop policy if exists story_media_insert_gate on storage.objects;
create policy story_media_insert_gate on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'story-media' or (split_part(name,'/',1)=auth.uid()::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'));
drop policy if exists story_media_update_gate on storage.objects;
create policy story_media_update_gate on storage.objects as restrictive for update to authenticated using(bucket_id<>'story-media') with check(bucket_id<>'story-media');
drop policy if exists story_media_delete_gate on storage.objects;
create policy story_media_delete_gate on storage.objects as restrictive for delete to authenticated using(bucket_id<>'story-media');
drop policy if exists story_media_anon_gate on storage.objects;
create policy story_media_anon_gate on storage.objects as restrictive for all to anon using(bucket_id<>'story-media') with check(bucket_id<>'story-media');
create or replace function public.post_story(p_body text default '',p_media text default null) returns public.stories language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); r public.stories; clean text:=btrim(coalesce(p_body,''));
begin
 if me is null then raise exception 'Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text,218));
 if char_length(clean)>280 or (clean='' and p_media is null) then raise exception 'Add text or a photo.'; end if;
 if (select count(*) from public.stories where user_id=me and created_at>now()-interval '24 hours')>=20 then raise exception 'Story limit reached for today.'; end if;
 if p_media is not null and not exists(select 1 from storage.objects o where o.bucket_id='story-media' and o.name=p_media and split_part(o.name,'/',1)=me::text and o.created_at>now()-interval '1 hour' and not exists(select 1 from public.stories s where s.media_path=p_media)) then raise exception 'Photo unavailable.'; end if;
 insert into public.stories(user_id,body,media_path) values(me,clean,p_media) returning * into r;
 return r;
end $$;
create or replace function public.delete_story(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.stories set deleted_at=clock_timestamp() where id=p_id and user_id=auth.uid() and deleted_at is null;
 if not found then raise exception 'Story unavailable.'; end if;
end $$;
revoke all on function public.post_story(text,text),public.delete_story(uuid) from public,anon;
grant execute on function public.post_story(text,text),public.delete_story(uuid) to authenticated;
-- Extend the existing storage worker; objects never bypass the Storage API.
create or replace function public.get_media_cleanup_batch()
returns table(bucket_id text,object_path text) language plpgsql security definer set search_path='' as $$
begin
  insert into private.media_cleanup_jobs(bucket_id,object_path)
  select o.bucket_id,o.name from storage.objects o where
    (o.bucket_id='chat-media' and o.created_at<now()-interval '24 hours') or
    (o.bucket_id='instant-media' and (o.created_at<now()-interval '24 hours' or exists(select 1 from private.instant_payloads p where p.media_url=o.name and p.claimed_at is not null and not p.allow_replay))) or
    (o.bucket_id='capsule-media' and (exists(select 1 from private.capsule_payloads p join public.capsules c on c.id=p.capsule_id where p.media_url=o.name and c.unlock_at<now()-interval '24 hours') or (o.created_at<now()-interval '24 hours' and not exists(select 1 from private.capsule_payloads p where p.media_url=o.name)))) or
    (o.bucket_id='avatars' and o.created_at<now()-interval '24 hours' and not exists(select 1 from public.profiles p where p.avatar_url=o.name)) or
    (o.bucket_id='story-media' and (exists(select 1 from public.stories s where s.media_path=o.name and (s.deleted_at is not null or s.expires_at<=now())) or (o.created_at<now()-interval '1 hour' and not exists(select 1 from public.stories s where s.media_path=o.name))))
  limit 1000 on conflict do nothing;
  delete from public.stories where created_at<now()-interval '48 hours';
  return query select j.bucket_id,j.object_path from private.media_cleanup_jobs j order by j.attempts,j.created_at limit 100;
end $$;
notify pgrst,'reload schema';
commit;
