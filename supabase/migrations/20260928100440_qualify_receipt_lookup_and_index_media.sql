begin;
create or replace function public.message_receipts(p_message uuid)
returns table(user_id uuid,username text,display_name text,avatar_url text,read_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare m public.messages;
begin
  select target.* into m from public.messages target where target.id=p_message and target.user_id=auth.uid() and private.is_member(target.conversation_id)
    and target.created_at>private.visible_after(target.conversation_id);
  if m.id is null then raise exception 'Message unavailable.'; end if;
  return query select p.id,p.username,p.display_name,p.avatar_url,
    case when r.stamp>=m.created_at then r.stamp else null end
  from public.conversations c cross join lateral (
    select c.member_a uid,c.read_a stamp where c.kind='direct'
    union all select c.member_b,c.read_b where c.kind='direct'
    union all select cm.user_id,cm.last_read_at from public.conversation_members cm where cm.conversation_id=c.id and c.kind='group'
  ) r join public.profiles p on p.id=r.uid where c.id=m.conversation_id and p.id<>auth.uid() order by r.stamp desc nulls last,p.username;
end;
$$;
create index if not exists deleted_media_lookup on private.deleted_messages(media_url) where media_url is not null;
notify pgrst,'reload schema';
commit;
