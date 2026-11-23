-- BitchAt 2.6: per-account archive state; messages and other members are preserved.
begin;

alter table public.chat_preferences add column if not exists archived boolean not null default false;

create or replace function private.set_chat_archived(p_conversation uuid, p_archived boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_conversation is null or p_archived is null
    or not private.is_member(p_conversation) then
    raise exception 'Conversation unavailable.';
  end if;
  insert into public.chat_preferences(user_id, conversation_id, cleared_before, hidden_at, archived)
  values(auth.uid(), p_conversation, '-infinity'::timestamptz, '-infinity'::timestamptz, p_archived)
  on conflict(user_id, conversation_id) do update set archived = excluded.archived;
  return p_archived;
end;
$$;
revoke all on function private.set_chat_archived(uuid, boolean) from public, anon, authenticated;
grant execute on function private.set_chat_archived(uuid, boolean) to authenticated;

create or replace function public.set_chat_archived(p_conversation uuid, p_archived boolean)
returns boolean language sql security invoker set search_path = '' as $$
  select private.set_chat_archived(p_conversation, p_archived);
$$;
revoke all on function public.set_chat_archived(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_chat_archived(uuid, boolean) to authenticated;

create or replace function public.clear_chat(p_conversation uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare stamp timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  insert into public.chat_preferences(user_id, conversation_id, cleared_before, hidden_at, archived)
  values(auth.uid(), p_conversation, stamp, stamp, false)
  on conflict(user_id, conversation_id)
  do update set cleared_before = excluded.cleared_before, hidden_at = excluded.hidden_at, archived = false;
  return stamp;
end;
$$;

create or replace function public.inbox_page(p_before timestamptz default null, p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(item order by activity desc, cid desc), '[]'::jsonb) from (
    select c.id cid, c.last_activity activity, to_jsonb(c) || jsonb_build_object(
      'archived', coalesce(cp.archived, false),
      'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'mood', p.mood, 'is_pro', false)), '[]'::jsonb) from public.profiles p where p.id in (c.member_a, c.member_b) or exists(select 1 from public.conversation_members cm where cm.conversation_id = c.id and cm.user_id = p.id)),
      'preview', (select case when m.kind = 'instant' then 'Photo' when m.kind = 'miss' then '🤍' when m.kind = 'sticker' then 'Sticker' when m.content <> '' then left(m.content, 120) when m.media_kind = 'image' then 'Photo' when m.media_kind = 'video' then 'Video' when m.media_kind = 'audio' then 'Voice note' else '' end from public.messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1),
      'member_reads', (select coalesce(jsonb_agg(jsonb_build_object('user_id', cm.user_id, 'read_at', cm.last_read_at)), '[]'::jsonb) from public.conversation_members cm where cm.conversation_id = c.id),
      'read_at', private.my_read_at(c.id)
    ) as item
    from public.conversations c
    left join public.chat_preferences cp on cp.conversation_id = c.id and cp.user_id = auth.uid()
    where auth.uid() is not null and (cp.hidden_at is null or c.last_activity > cp.hidden_at)
      and (p_before is null or (c.last_activity, c.id) < (p_before, p_before_id))
    order by c.last_activity desc, c.id desc limit 60
  ) page;
$$;
revoke all on function public.inbox_page(timestamptz, uuid), public.clear_chat(uuid) from public, anon;
grant execute on function public.inbox_page(timestamptz, uuid), public.clear_chat(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
