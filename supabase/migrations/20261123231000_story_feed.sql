begin;
-- Expose only the public-facing identity of people with a visible story.
create or replace function public.story_feed() returns table(id uuid,user_id uuid,body text,media_path text,created_at timestamptz,expires_at timestamptz,profiles jsonb) language sql stable security definer set search_path='' as $$
 select s.id,s.user_id,s.body,s.media_path,s.created_at,s.expires_at,jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'mood',p.mood)
 from public.stories s join public.profiles p on p.id=s.user_id
 where auth.uid() is not null and s.deleted_at is null and s.expires_at>now() and (s.user_id=auth.uid() or not private.blocked(auth.uid(),s.user_id))
 order by s.created_at desc,s.id desc limit 100;
$$;
revoke all on function public.story_feed() from public,anon;
grant execute on function public.story_feed() to authenticated;
notify pgrst,'reload schema';
commit;
