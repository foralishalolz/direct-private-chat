create or replace function public.inbox_page(p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(item order by activity desc, cid desc),'[]'::jsonb) from (
 select c.id cid,c.last_activity activity,to_jsonb(c)||jsonb_build_object(
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'mood',p.mood,'is_pro',false)),'[]'::jsonb) from public.profiles p where p.id in (c.member_a,c.member_b) or exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=p.id)),
 'preview',(select case when m.kind='instant' then 'Photo' when m.kind='miss' then '🤍' when m.kind='sticker' then 'Sticker' when m.content<>'' then left(m.content,120) when m.media_kind='image' then 'Photo' when m.media_kind='video' then 'Video' when m.media_kind='audio' then 'Voice note' else '' end from public.messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1),
 'read_at',case when c.kind='direct' then case when c.member_a=auth.uid() then c.read_a else c.read_b end else (select cm.last_read_at from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=auth.uid()) end
 ) as item
 from public.conversations c where auth.uid() is not null and (p_before is null or (c.last_activity,c.id)<(p_before,p_before_id))
 order by c.last_activity desc,c.id desc limit 60
 ) page;
$$;
revoke all on function public.inbox_page(timestamptz,uuid) from public,anon;
grant execute on function public.inbox_page(timestamptz,uuid) to authenticated;

