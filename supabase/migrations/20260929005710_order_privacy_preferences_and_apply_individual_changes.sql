begin;
alter table public.privacy_settings add column revision bigint not null default 0;
create or replace function public.set_privacy(p_online boolean,p_last_active boolean,p_typing boolean,p_receipts boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_online is null or p_last_active is null or p_typing is null or p_receipts is null then raise exception 'Invalid settings.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9));
 insert into public.privacy_settings(user_id,share_online,share_last_active,share_typing,share_receipts,revision)
 values(auth.uid(),p_online,p_last_active,p_typing,p_receipts,1) on conflict(user_id) do update set
 share_online=excluded.share_online,share_last_active=excluded.share_last_active,share_typing=excluded.share_typing,share_receipts=excluded.share_receipts,revision=public.privacy_settings.revision+1;
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

create or replace function public.set_privacy_option(p_setting text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_settings public.privacy_settings;
begin
 if auth.uid() is null or p_enabled is null or p_setting is null or p_setting not in ('share_online','share_last_active','share_typing','share_receipts') then raise exception 'Invalid settings.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9));
 perform public.my_privacy();
 select * into current_settings from public.privacy_settings where user_id=auth.uid();
 return public.set_privacy(
  case when p_setting='share_online' then p_enabled else current_settings.share_online end,
  case when p_setting='share_last_active' then p_enabled else current_settings.share_last_active end,
  case when p_setting='share_typing' then p_enabled else current_settings.share_typing end,
  case when p_setting='share_receipts' then p_enabled else current_settings.share_receipts end
 );
end;
$$;
revoke all on function public.set_privacy_option(text,boolean) from public,anon;
grant execute on function public.set_privacy_option(text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
