-- Activity privacy applies to every viewer, including Pro members.
begin;
create table public.privacy_settings (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 share_online boolean not null default true,
 share_last_active boolean not null default true,
 share_typing boolean not null default true,
 share_receipts boolean not null default true
);
alter table public.privacy_settings enable row level security;
create policy privacy_read_self on public.privacy_settings for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.privacy_settings from public,anon,authenticated;
grant select on public.privacy_settings to authenticated;
grant all on public.privacy_settings to service_role;
insert into public.privacy_settings(user_id) select id from public.profiles on conflict do nothing;

create table private.read_markers (
 user_id uuid not null references public.profiles(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 seen_at timestamptz not null,
 primary key(user_id,conversation_id)
);
create index read_markers_conversation on private.read_markers(conversation_id);
insert into private.read_markers(user_id,conversation_id,seen_at)
select member_a,id,read_a from public.conversations where kind='direct' and read_a is not null
union all select member_b,id,read_b from public.conversations where kind='direct' and read_b is not null
union all select user_id,conversation_id,last_read_at from public.conversation_members where last_read_at is not null
on conflict(user_id,conversation_id) do update set seen_at=greatest(private.read_markers.seen_at,excluded.seen_at);
alter table private.read_markers enable row level security;
revoke all on private.read_markers from public,anon,authenticated;

create table private.activity_sessions (
 user_id uuid not null references public.profiles(id) on delete cascade,
 session_id uuid not null,
 expires_at timestamptz not null,
 primary key(user_id,session_id)
);
create table private.activity_state (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 last_active timestamptz not null,
 last_offline timestamptz
);
create table private.typing_windows (
 user_id uuid not null references public.profiles(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 last_ping timestamptz not null,
 primary key(user_id,conversation_id)
);
create index typing_windows_conversation on private.typing_windows(conversation_id);
alter table private.activity_sessions enable row level security;
alter table private.activity_state enable row level security;
alter table private.typing_windows enable row level security;
revoke all on private.activity_sessions,private.activity_state,private.typing_windows from public,anon,authenticated;

create or replace function private.my_read_at(p_conversation uuid)
returns timestamptz language sql stable security definer set search_path='' as $$
 select seen_at from private.read_markers where user_id=auth.uid() and conversation_id=p_conversation;
$$;
create or replace function private.share_activity(p_feature text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce((select case p_feature when 'online' then share_online when 'typing' then share_typing when 'receipts' then share_receipts else false end from public.privacy_settings where user_id=auth.uid()),p_feature in('online','typing','receipts'));
$$;
revoke all on function private.my_read_at(uuid),private.share_activity(text) from public,anon;
grant execute on function private.my_read_at(uuid),private.share_activity(text) to authenticated;

create or replace function public.my_privacy()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.privacy_settings;
begin
 if auth.uid() is null then raise exception 'Sign in again.'; end if;
 insert into public.privacy_settings(user_id) values(auth.uid()) on conflict do nothing;
 select * into result from public.privacy_settings where user_id=auth.uid();
 return to_jsonb(result)-'user_id';
end;
$$;

create or replace function public.set_privacy(p_online boolean,p_last_active boolean,p_typing boolean,p_receipts boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_online is null or p_last_active is null or p_typing is null or p_receipts is null then raise exception 'Invalid settings.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9));
 insert into public.privacy_settings(user_id,share_online,share_last_active,share_typing,share_receipts)
 values(auth.uid(),p_online,p_last_active,p_typing,p_receipts) on conflict(user_id) do update set
 share_online=excluded.share_online,share_last_active=excluded.share_last_active,share_typing=excluded.share_typing,share_receipts=excluded.share_receipts;
 update public.conversations c set
 read_a=case when c.member_a=auth.uid() then case when p_receipts then (select seen_at from private.read_markers where user_id=auth.uid() and conversation_id=c.id) else null end else c.read_a end,
 read_b=case when c.member_b=auth.uid() then case when p_receipts then (select seen_at from private.read_markers where user_id=auth.uid() and conversation_id=c.id) else null end else c.read_b end
 where c.kind='direct' and auth.uid() in(c.member_a,c.member_b);
 update public.conversation_members cm set last_read_at=case when p_receipts then (select seen_at from private.read_markers where user_id=auth.uid() and conversation_id=cm.conversation_id) else null end where cm.user_id=auth.uid();
 if not p_online and not p_last_active then
   delete from private.activity_sessions where user_id=auth.uid();
   delete from private.activity_state where user_id=auth.uid();
 end if;
 return public.my_privacy();
end;
$$;

create or replace function public.mark_read_through(p_conversation uuid,p_message uuid)
returns void language plpgsql security definer set search_path='' as $$
declare stamp timestamptz; visible boolean;
begin
 if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9));
 select created_at into stamp from public.messages where id=p_message and conversation_id=p_conversation;
 if stamp is null then return; end if;
 insert into private.read_markers(user_id,conversation_id,seen_at) values(auth.uid(),p_conversation,stamp)
 on conflict(user_id,conversation_id) do update set seen_at=greatest(private.read_markers.seen_at,excluded.seen_at) returning seen_at into stamp;
 visible:=private.share_activity('receipts');
 update public.conversation_members set last_read_at=case when visible then stamp else null end
 where conversation_id=p_conversation and user_id=auth.uid() and last_read_at is distinct from case when visible then stamp else null end;
 update public.conversations set read_a=case when member_a=auth.uid() then case when visible then stamp else null end else read_a end,
 read_b=case when member_b=auth.uid() then case when visible then stamp else null end else read_b end
 where id=p_conversation and kind='direct' and ((member_a=auth.uid() and read_a is distinct from case when visible then stamp else null end) or (member_b=auth.uid() and read_b is distinct from case when visible then stamp else null end));
end;
$$;
create or replace function public.mark_read(p_conversation uuid)
returns void language plpgsql security definer set search_path='' as $$
declare latest uuid;
begin
 if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
 select id into latest from public.messages where conversation_id=p_conversation order by created_at desc,id desc limit 1;
 if latest is not null then perform public.mark_read_through(p_conversation,latest); end if;
end;
$$;

create or replace function public.touch_activity(p_session uuid,p_active boolean)
returns void language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp(); was_online boolean;
begin
 if auth.uid() is null or p_session is null or p_active is null then raise exception 'Sign in again.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9));
 if exists(select 1 from public.privacy_settings where user_id=auth.uid() and not share_online and not share_last_active) then return; end if;
 delete from private.activity_sessions where user_id=auth.uid() and expires_at<stamp-interval '2 minutes';
 select exists(select 1 from private.activity_sessions where user_id=auth.uid() and expires_at>stamp) into was_online;
 if p_active then
   insert into private.activity_state(user_id,last_active) values(auth.uid(),stamp) on conflict(user_id) do update
    set last_offline=case when not was_online then private.activity_state.last_active else private.activity_state.last_offline end,last_active=stamp;
   insert into private.activity_sessions(user_id,session_id,expires_at) values(auth.uid(),p_session,stamp+interval '75 seconds')
    on conflict(user_id,session_id) do update set expires_at=excluded.expires_at;
 else
   delete from private.activity_sessions where user_id=auth.uid() and session_id=p_session;
   if not exists(select 1 from private.activity_sessions where user_id=auth.uid() and expires_at>stamp) then
    update private.activity_state set last_active=stamp,last_offline=stamp where user_id=auth.uid();
   end if;
 end if;
end;
$$;

create or replace function public.member_activity(p_conversation uuid)
returns table(user_id uuid,online boolean,last_active timestamptz) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
 return query select u.uid,
 coalesce(p.share_online,true) and live.active,
 case when coalesce(p.share_last_active,true) then case when live.active then a.last_offline else a.last_active end else null end
 from public.conversations c cross join lateral (
  select c.member_a uid where c.kind='direct' union all select c.member_b where c.kind='direct'
  union all select cm.user_id from public.conversation_members cm where cm.conversation_id=c.id and c.kind='group'
 ) u left join public.privacy_settings p on p.user_id=u.uid left join private.activity_state a on a.user_id=u.uid
 cross join lateral (select exists(select 1 from private.activity_sessions s where s.user_id=u.uid and s.expires_at>now()) active) live
 where c.id=p_conversation and u.uid<>auth.uid();
end;
$$;

create or replace function public.send_typing(p_conversation uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
 if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
 if not private.share_activity('typing') then return false; end if;
 insert into private.typing_windows(user_id,conversation_id,last_ping) values(auth.uid(),p_conversation,stamp)
 on conflict(user_id,conversation_id) do update set last_ping=excluded.last_ping
 where private.typing_windows.last_ping<stamp-interval '1500 milliseconds';
 if not found then return false; end if;
 perform realtime.send(jsonb_build_object('id',auth.uid()),'typing','room:'||p_conversation::text,true);
 return true;
end;
$$;

-- Receivers can listen; clients cannot forge broadcast sender IDs.
drop policy bitchat_presence_write on realtime.messages;
create policy bitchat_presence_write on realtime.messages for insert to authenticated with check(
 extension='presence' and private.share_activity('online') and topic~'^room:[0-9a-f-]{36}$'
 and private.is_member(case when topic~'^room:[0-9a-f-]{36}$' then substring(topic from 6)::uuid else null end));
create policy bitchat_room_write_gate on realtime.messages as restrictive for insert to authenticated with check(
 topic!~'^room:[0-9a-f-]{36}$' or (extension='presence' and private.share_activity('online')
 and private.is_member(case when topic~'^room:[0-9a-f-]{36}$' then substring(topic from 6)::uuid else null end)));

revoke all on function public.my_privacy(),public.set_privacy(boolean,boolean,boolean,boolean),public.touch_activity(uuid,boolean),public.member_activity(uuid),public.send_typing(uuid) from public,anon;
grant execute on function public.my_privacy(),public.set_privacy(boolean,boolean,boolean,boolean),public.touch_activity(uuid,boolean),public.member_activity(uuid),public.send_typing(uuid) to authenticated;
alter publication supabase_realtime add table public.privacy_settings;
create or replace function public.inbox_page(p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(item order by activity desc, cid desc),'[]'::jsonb) from (
 select c.id cid,c.last_activity activity,to_jsonb(c)||jsonb_build_object(
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,'mood',p.mood,'is_pro',false)),'[]'::jsonb) from public.profiles p where p.id in (c.member_a,c.member_b) or exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=p.id)),
 'preview',(select case when m.kind='instant' then 'Photo' when m.kind='miss' then '🤍' when m.kind='sticker' then 'Sticker' when m.content<>'' then left(m.content,120) when m.media_kind='image' then 'Photo' when m.media_kind='video' then 'Video' when m.media_kind='audio' then 'Voice note' else '' end from public.messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1),
 'member_reads',(select coalesce(jsonb_agg(jsonb_build_object('user_id',cm.user_id,'read_at',cm.last_read_at)),'[]'::jsonb) from public.conversation_members cm where cm.conversation_id=c.id),
 'read_at',private.my_read_at(c.id)
 ) as item
 from public.conversations c left join public.chat_preferences cp on cp.conversation_id=c.id and cp.user_id=auth.uid() where auth.uid() is not null and (cp.hidden_at is null or c.last_activity>cp.hidden_at) and (p_before is null or (c.last_activity,c.id)<(p_before,p_before_id))
 order by c.last_activity desc,c.id desc limit 60
 ) page;
$$;
notify pgrst,'reload schema';
commit;
