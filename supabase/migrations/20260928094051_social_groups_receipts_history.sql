-- BitchAt 2.2: additive upgrade. Existing accounts, messages and media are preserved.
begin;

create table if not exists public.chat_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  cleared_before timestamptz not null,
  hidden_at timestamptz not null,
  primary key(user_id,conversation_id)
);
create index if not exists chat_preferences_conversation on public.chat_preferences(conversation_id);
alter table public.chat_preferences enable row level security;
create policy preferences_read on public.chat_preferences for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.chat_preferences from public,anon,authenticated;
grant select on public.chat_preferences to authenticated;
grant all on public.chat_preferences to service_role;

create or replace function private.visible_after(p_conversation uuid)
returns timestamptz language sql stable security definer set search_path='' as $$
  select coalesce((select cleared_before from public.chat_preferences where user_id=auth.uid() and conversation_id=p_conversation),'-infinity'::timestamptz);
$$;
revoke all on function private.visible_after(uuid) from public,anon;
grant execute on function private.visible_after(uuid) to authenticated;
create policy messages_clear_gate on public.messages as restrictive for select to authenticated
using(created_at>private.visible_after(conversation_id));

create or replace function public.clear_chat(p_conversation uuid)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
  if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  insert into public.chat_preferences(user_id,conversation_id,cleared_before,hidden_at)
  values(auth.uid(),p_conversation,stamp,stamp) on conflict(user_id,conversation_id)
  do update set cleared_before=excluded.cleared_before,hidden_at=excluded.hidden_at;
  return stamp;
end;
$$;

create table if not exists private.group_invites (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles(id) on delete cascade
);
create index if not exists group_invites_creator on private.group_invites(created_by);
alter table private.group_invites enable row level security;
revoke all on private.group_invites from public,anon,authenticated;

create or replace function public.group_invite(p_conversation uuid,p_revoke boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare code text;
begin
  perform 1 from public.conversations where id=p_conversation and kind='group'
    and private.is_member(id) and (created_by=auth.uid() or private.is_pro()) for update;
  if not found then raise exception 'Only a group admin can do that.'; end if;
  delete from private.group_invites where conversation_id=p_conversation;
  if p_revoke then return null; end if;
  code:=encode(extensions.gen_random_bytes(16),'hex');
  insert into private.group_invites(conversation_id,code_hash,expires_at,created_by)
  values(p_conversation,encode(extensions.digest(code,'sha256'),'hex'),clock_timestamp()+interval '7 days',auth.uid());
  return code;
end;
$$;

create or replace function public.join_group(p_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid; owner_id uuid;
begin
  if auth.uid() is null or p_code is null or btrim(p_code)!~'^[a-f0-9]{32}$' then raise exception 'Invite unavailable.'; end if;
  select i.conversation_id into cid from private.group_invites i
  where i.code_hash=encode(extensions.digest(btrim(p_code),'sha256'),'hex') and i.expires_at>clock_timestamp();
  if cid is null then raise exception 'Invite unavailable.'; end if;
  select c.created_by into owner_id from public.conversations c where c.id=cid and c.kind='group' for update;
  -- Recheck after taking the same lock used by revoke/leave.
  if not exists(select 1 from private.group_invites where conversation_id=cid
    and code_hash=encode(extensions.digest(btrim(p_code),'sha256'),'hex') and expires_at>clock_timestamp())
    or owner_id is null or private.blocked(auth.uid(),owner_id) then raise exception 'Invite unavailable.'; end if;
  if exists(select 1 from public.conversation_members where conversation_id=cid and user_id=auth.uid()) then return cid; end if;
  if (select count(*) from public.conversation_members where conversation_id=cid)>=32 then raise exception 'This group is full.'; end if;
  insert into public.conversation_members(conversation_id,user_id) values(cid,auth.uid());
  update public.conversations set last_activity=clock_timestamp() where id=cid;
  return cid;
end;
$$;

create or replace function public.leave_group(p_conversation uuid)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid; next_owner uuid;
begin
  select c.created_by into owner_id from public.conversations c
  where c.id=p_conversation and c.kind='group' and private.is_member(c.id) for update;
  if not found then raise exception 'Group unavailable.'; end if;
  delete from public.conversation_members where conversation_id=p_conversation and user_id=auth.uid();
  if owner_id=auth.uid() then
    select user_id into next_owner from public.conversation_members where conversation_id=p_conversation order by joined_at,user_id limit 1;
    update public.conversations set created_by=next_owner where id=p_conversation;
    delete from private.group_invites where conversation_id=p_conversation;
  end if;
end;
$$;

create or replace function public.rename_group(p_conversation uuid,p_title text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 60 then raise exception 'Add a group name.'; end if;
  update public.conversations set title=btrim(p_title) where id=p_conversation and kind='group'
  and private.is_member(id) and (created_by=auth.uid() or private.is_pro());
  if not found then raise exception 'Only a group admin can do that.'; end if;
end;
$$;

create or replace function public.mark_read_through(p_conversation uuid,p_message uuid)
returns void language plpgsql security definer set search_path='' as $$
declare stamp timestamptz;
begin
  if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  select created_at into stamp from public.messages where id=p_message and conversation_id=p_conversation;
  if stamp is null then return; end if;
  update public.conversation_members set last_read_at=greatest(last_read_at,stamp)
    where conversation_id=p_conversation and user_id=auth.uid() and (last_read_at is null or last_read_at<stamp);
  update public.conversations set read_a=case when member_a=auth.uid() then greatest(read_a,stamp) else read_a end,
    read_b=case when member_b=auth.uid() then greatest(read_b,stamp) else read_b end
    where id=p_conversation and kind='direct' and ((member_a=auth.uid() and (read_a is null or read_a<stamp)) or (member_b=auth.uid() and (read_b is null or read_b<stamp)));
end;
$$;

create or replace function public.message_receipts(p_message uuid)
returns table(user_id uuid,username text,display_name text,avatar_url text,read_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare m public.messages;
begin
  select * into m from public.messages where id=p_message and user_id=auth.uid() and private.is_member(conversation_id)
    and created_at>private.visible_after(conversation_id);
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

create table if not exists private.message_edits (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  username text not null,
  before_content text not null,
  after_content text not null,
  created_at timestamptz not null,
  event_at timestamptz not null default clock_timestamp()
);
create index if not exists message_edits_cursor on private.message_edits(conversation_id,event_at desc,id desc);
create index if not exists message_edits_user on private.message_edits(user_id);
alter table private.message_edits enable row level security;
revoke all on private.message_edits from public,anon,authenticated;
alter table private.deleted_messages add column if not exists media_url text;
alter table private.deleted_messages add column if not exists media_kind text;

create or replace function private.archive_edit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.content is distinct from new.content and old.kind<>'instant' then
    insert into private.message_edits(message_id,conversation_id,user_id,username,before_content,after_content,created_at)
    values(old.id,old.conversation_id,old.user_id,(select username from public.profiles where id=old.user_id),old.content,new.content,old.created_at);
  end if;
  return new;
end;
$$;
create trigger bitchat_archive_edit after update of content on public.messages for each row execute function private.archive_edit();

create or replace function private.archive_deleted()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.message_tombstones(id) values(old.id) on conflict do nothing;
  if auth.uid() is not null and private.is_member(old.conversation_id) and private.is_pro() and old.kind<>'instant' then
    insert into private.deleted_messages(message_id,conversation_id,user_id,username,content,kind,created_at,media_url,media_kind)
    values(old.id,old.conversation_id,old.user_id,(select username from public.profiles where id=old.user_id),old.content,old.kind,old.created_at,old.media_url,old.media_kind) on conflict do nothing;
  end if;
  return old;
end;
$$;

create or replace function public.message_history(p_conversation uuid,p_kind text default 'all',p_before timestamptz default null,p_before_id uuid default null)
returns table(id uuid,message_id uuid,user_id uuid,username text,kind text,before_content text,after_content text,created_at timestamptz,event_at timestamptz,media_url text,media_kind text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_member(p_conversation) or not private.is_pro() then raise exception 'Pro required.'; end if;
  return query select h.* from (
    select e.id,e.message_id,e.user_id,e.username,'edited'::text,e.before_content,e.after_content,e.created_at,e.event_at,null::text,null::text
    from private.message_edits e where e.conversation_id=p_conversation and p_kind in ('all','edited')
    union all select d.message_id,d.message_id,d.user_id,d.username,'deleted'::text,d.content,null::text,d.created_at,d.deleted_at,
      case when d.created_at>now()-interval '24 hours' then d.media_url else null end,d.media_kind
    from private.deleted_messages d where d.conversation_id=p_conversation and p_kind in ('all','deleted')
  ) h where h.created_at>private.visible_after(p_conversation) and (p_before is null or (h.event_at,h.id)<(p_before,p_before_id))
  order by h.event_at desc,h.id desc limit 30;
end;
$$;

-- Replay is opt-in per photo and is never enabled by upgrading the receiver alone.
alter table public.messages add column if not exists allow_replay boolean not null default false;
alter table private.instant_payloads add column if not exists allow_replay boolean not null default false;
create or replace function public.send_instant_v2(p_id uuid,p_conversation uuid,p_media text,p_source text,p_allow_replay boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,7));
  if exists(select 1 from public.messages where id=p_id and user_id=auth.uid() and conversation_id=p_conversation and kind='instant') then return p_id; end if;
  perform public.send_instant(p_id,p_conversation,p_media,p_source);
  update public.messages set allow_replay=coalesce(p_allow_replay,false) where id=p_id;
  update private.instant_payloads set allow_replay=coalesce(p_allow_replay,false) where message_id=p_id;
  return p_id;
end;
$$;

create or replace function public.claim_instant_v2(p_id uuid,p_viewer uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload private.instant_payloads; m public.messages; replay boolean;
begin
  select * into payload from private.instant_payloads where message_id=p_id for update;
  select * into m from public.messages where id=p_id;
  if payload.message_id is null or payload.expires_at<=clock_timestamp() or not exists(
    select 1 from public.conversations c where c.id=m.conversation_id and
    (p_viewer in(c.member_a,c.member_b) or exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=p_viewer))
  ) or m.created_at<=coalesce((select cleared_before from public.chat_preferences where user_id=p_viewer and conversation_id=m.conversation_id),'-infinity'::timestamptz)
  then raise exception 'Instant unavailable.'; end if;
  replay:=payload.allow_replay and exists(select 1 from public.profiles where id=p_viewer and is_pro);
  if not replay and (m.user_id=p_viewer or payload.claimed_at is not null) then raise exception 'Instant unavailable.'; end if;
  -- A sender preview must not consume the receiver's first view.
  if m.user_id<>p_viewer then
    update private.instant_payloads set claimed_at=coalesce(claimed_at,clock_timestamp()) where message_id=p_id;
    update public.messages set instant_viewed=true where id=p_id and not instant_viewed;
  end if;
  return jsonb_build_object('path',payload.media_url,'allow_replay',payload.allow_replay);
end;
$$;

create or replace function private.can_read_media(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when p_bucket='avatars' then auth.uid() is not null
    when p_bucket='chat-media' then exists(select 1 from public.messages m where m.media_url=p_name and private.is_member(m.conversation_id)
      and m.created_at>now()-interval '24 hours' and m.created_at>private.visible_after(m.conversation_id))
      or (private.is_pro() and exists(select 1 from private.deleted_messages d where d.media_url=p_name and private.is_member(d.conversation_id)
      and d.created_at>now()-interval '24 hours' and d.created_at>private.visible_after(d.conversation_id)))
    when p_bucket='capsule-media' then exists(select 1 from private.capsule_payloads p join public.capsules c on c.id=p.capsule_id
      where p.media_url=p_name and private.is_member(c.conversation_id) and c.unlock_at<=now() and c.unlock_at>now()-interval '24 hours')
    else false end;
$$;

create or replace function public.quick_play(p_id uuid,p_conversation uuid,p_kind text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result text;
begin
  if not private.is_member(p_conversation) or p_kind is null or p_kind not in('dice','coin') then raise exception 'Game unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,8));
  if exists(select 1 from public.messages where id=p_id and user_id=auth.uid() and conversation_id=p_conversation) then return p_id; end if;
  if (select count(*) from public.messages where user_id=auth.uid() and created_at>now()-interval '10 seconds')>=20 then raise exception 'Give it a moment.'; end if;
  result:=case when p_kind='dice' then '🎲 '||(1+floor(random()*6))::integer::text else case when random()<0.5 then '🪙 Heads' else '🪙 Tails' end end;
  insert into public.messages(id,conversation_id,user_id,content) values(p_id,p_conversation,auth.uid(),result);
  return p_id;
end;
$$;

create or replace function private.validate_message()
returns trigger language plpgsql security definer set search_path='' as $$
declare mime text;
begin
  new.conversation_id:=coalesce(new.conversation_id,new.group_id);
  if new.group_id is not null and new.group_id<>new.conversation_id then raise exception 'Group mismatch.'; end if;
  if auth.uid() is null or new.user_id<>auth.uid() or not private.is_member(new.conversation_id) then raise exception 'Conversation unavailable.'; end if;
  if exists(select 1 from private.message_tombstones where id=new.id) then raise exception 'Message was removed.'; end if;
  if exists(select 1 from public.messages where id=new.id and user_id=new.user_id and conversation_id=new.conversation_id) then return new; end if;
  new.created_at:=clock_timestamp();
  new.content:=btrim(new.content);
  if new.kind not in ('instant','miss') and new.content='' and new.media_url is null then raise exception 'Write a message or choose a photo.'; end if;
  if new.reply_to is not null and not exists(select 1 from public.messages where id=new.reply_to and conversation_id=new.conversation_id) then raise exception 'Reply unavailable.'; end if;
  if new.media_url is not null then
    if not private.owns_upload('chat-media',new.media_url,new.conversation_id) then raise exception 'Upload unavailable.'; end if;
    select metadata->>'mimetype' into mime from storage.objects where bucket_id='chat-media' and name=new.media_url;
    new.media_kind:=case when mime like 'video/%' then 'video' when mime like 'audio/%' then 'audio' else 'image' end;
  else new.media_kind:=null; end if;
  return new;
end;
$$;

create or replace function public.get_media_cleanup_batch()
returns table(bucket_id text,object_path text) language plpgsql security definer set search_path='' as $$
begin
  insert into private.media_cleanup_jobs(bucket_id,object_path)
  select o.bucket_id,o.name from storage.objects o where
    (o.bucket_id='chat-media' and o.created_at<now()-interval '24 hours') or
    (o.bucket_id='instant-media' and (o.created_at<now()-interval '24 hours' or exists(select 1 from private.instant_payloads p where p.media_url=o.name and p.claimed_at is not null and not p.allow_replay))) or
    (o.bucket_id='capsule-media' and (
      exists(select 1 from private.capsule_payloads p join public.capsules c on c.id=p.capsule_id where p.media_url=o.name and c.unlock_at<now()-interval '24 hours') or
      (o.created_at<now()-interval '24 hours' and not exists(select 1 from private.capsule_payloads p where p.media_url=o.name))
    )) or (o.bucket_id='avatars' and o.created_at<now()-interval '24 hours' and not exists(select 1 from public.profiles p where p.avatar_url=o.name))
  limit 1000 on conflict do nothing;
  return query select j.bucket_id,j.object_path from private.media_cleanup_jobs j order by j.attempts,j.created_at limit 100;
end;
$$;

create or replace function public.search_messages(p_conversation uuid,p_query text,p_before timestamptz default null,p_before_id uuid default null)
returns setof public.messages language plpgsql stable security definer set search_path='' as $$
declare term text:=replace(replace(replace(btrim(p_query),'\','\\'),'%','\%'),'_','\_');
begin
  if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if p_query is null or length(btrim(p_query)) not between 2 and 100 then return; end if;
  return query select m.* from public.messages m where m.conversation_id=p_conversation and m.kind<>'instant' and m.created_at>private.visible_after(p_conversation)
    and m.content ilike '%'||term||'%' escape '\' and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
    order by m.created_at desc,m.id desc limit 30;
end;
$$;

create or replace function public.deleted_history(p_conversation uuid,p_before timestamptz default null,p_before_id uuid default null)
returns setof private.deleted_messages language plpgsql security definer set search_path='' as $$
begin
  if not private.is_member(p_conversation) or not private.is_pro() then raise exception 'Pro required.'; end if;
  return query select * from private.deleted_messages where conversation_id=p_conversation and created_at>private.visible_after(p_conversation) and (p_before is null or (deleted_at,message_id)<(p_before,p_before_id)) order by deleted_at desc,message_id desc limit 30;
end;
$$;

create or replace function public.inbox_page(p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(item order by activity desc, cid desc),'[]'::jsonb) from (
 select c.id cid,c.last_activity activity,to_jsonb(c)||jsonb_build_object(
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'mood',p.mood,'is_pro',false)),'[]'::jsonb) from public.profiles p where p.id in (c.member_a,c.member_b) or exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=p.id)),
 'preview',(select case when m.kind='instant' then 'Photo' when m.kind='miss' then '🤍' when m.kind='sticker' then 'Sticker' when m.content<>'' then left(m.content,120) when m.media_kind='image' then 'Photo' when m.media_kind='video' then 'Video' when m.media_kind='audio' then 'Voice note' else '' end from public.messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1),
 'member_reads',(select coalesce(jsonb_agg(jsonb_build_object('user_id',cm.user_id,'read_at',cm.last_read_at)),'[]'::jsonb) from public.conversation_members cm where cm.conversation_id=c.id),
 'read_at',case when c.kind='direct' then case when c.member_a=auth.uid() then c.read_a else c.read_b end else (select cm.last_read_at from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=auth.uid()) end
 ) as item
 from public.conversations c left join public.chat_preferences cp on cp.conversation_id=c.id and cp.user_id=auth.uid() where auth.uid() is not null and (cp.hidden_at is null or c.last_activity>cp.hidden_at) and (p_before is null or (c.last_activity,c.id)<(p_before,p_before_id))
 order by c.last_activity desc,c.id desc limit 60
 ) page;
$$;

revoke all on function private.archive_edit() from public,anon,authenticated;
revoke all on function public.clear_chat(uuid),public.group_invite(uuid,boolean),public.join_group(text),public.leave_group(uuid),public.rename_group(uuid,text),public.mark_read_through(uuid,uuid),public.message_receipts(uuid),public.message_history(uuid,text,timestamptz,uuid),public.send_instant_v2(uuid,uuid,text,text,boolean),public.quick_play(uuid,uuid,text) from public,anon;
grant execute on function public.clear_chat(uuid),public.group_invite(uuid,boolean),public.join_group(text),public.leave_group(uuid),public.rename_group(uuid,text),public.mark_read_through(uuid,uuid),public.message_receipts(uuid),public.message_history(uuid,text,timestamptz,uuid),public.send_instant_v2(uuid,uuid,text,text,boolean),public.quick_play(uuid,uuid,text) to authenticated;
revoke all on function public.claim_instant_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_instant_v2(uuid,uuid) to service_role;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_preferences') then
    alter publication supabase_realtime add table public.chat_preferences;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
