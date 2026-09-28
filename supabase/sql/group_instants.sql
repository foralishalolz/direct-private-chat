-- One strict view per recipient, including group conversations.
begin;
alter table public.messages add column if not exists per_recipient boolean not null default false;
alter table private.instant_payloads add column if not exists per_recipient boolean not null default false;
create table public.instant_receipts (
 message_id uuid not null references public.messages(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 opened_at timestamptz not null default clock_timestamp(),
 primary key(message_id,user_id)
);
create index instant_receipts_user on public.instant_receipts(user_id,message_id);
alter table public.instant_receipts enable row level security;
create policy instant_receipt_read on public.instant_receipts for select to authenticated
 using(user_id=(select auth.uid()) and exists(select 1 from public.messages m where m.id=message_id));
revoke all on public.instant_receipts from public,anon,authenticated;
grant select on public.instant_receipts to authenticated;
grant all on public.instant_receipts to service_role;

create or replace function public.send_instant_v2(p_id uuid,p_conversation uuid,p_media text,p_source text,p_allow_replay boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,7));
 if exists(select 1 from public.messages where id=p_id and user_id=auth.uid() and conversation_id=p_conversation and kind='instant') then return p_id; end if;
 perform public.send_instant(p_id,p_conversation,p_media,p_source);
 update public.messages set allow_replay=coalesce(p_allow_replay,false),per_recipient=true where id=p_id;
 update private.instant_payloads set allow_replay=coalesce(p_allow_replay,false),per_recipient=true where message_id=p_id;
 return p_id;
end;
$$;

create or replace function public.claim_instant_v2(p_id uuid,p_viewer uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload private.instant_payloads; m public.messages; replay boolean; complete boolean:=true;
begin
 select * into payload from private.instant_payloads where message_id=p_id for update;
 select * into m from public.messages where id=p_id;
 if payload.message_id is null or payload.expires_at<=clock_timestamp() or not exists(
  select 1 from public.conversations c where c.id=m.conversation_id and
  (p_viewer in(c.member_a,c.member_b) or exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=p_viewer))
 ) or m.created_at<=coalesce((select cleared_before from public.chat_preferences where user_id=p_viewer and conversation_id=m.conversation_id),'-infinity'::timestamptz)
 then raise exception 'Instant unavailable.'; end if;
 replay:=payload.allow_replay and exists(select 1 from public.profiles where id=p_viewer and is_pro);
 if not replay and (m.user_id=p_viewer or
   (not payload.per_recipient and payload.claimed_at is not null) or
   (payload.per_recipient and exists(select 1 from public.instant_receipts where message_id=p_id and user_id=p_viewer)))
 then raise exception 'Instant unavailable.'; end if;
 if m.user_id<>p_viewer then
  if payload.per_recipient then
   insert into public.instant_receipts(message_id,user_id) values(p_id,p_viewer) on conflict do nothing;
   select not exists(
    select 1 from public.conversations c cross join lateral (
     select c.member_a uid where c.kind='direct'
     union all select c.member_b where c.kind='direct'
     union all select cm.user_id from public.conversation_members cm where cm.conversation_id=c.id and c.kind='group'
    ) r where c.id=m.conversation_id and r.uid<>m.user_id and not exists(
     select 1 from public.instant_receipts v where v.message_id=p_id and v.user_id=r.uid)
   ) into complete;
  end if;
  if complete then
   update private.instant_payloads set claimed_at=coalesce(claimed_at,clock_timestamp()) where message_id=p_id;
   update public.messages set instant_viewed=true where id=p_id and not instant_viewed;
  end if;
 else complete:=false;
 end if;
 return jsonb_build_object('path',payload.media_url,'allow_replay',payload.allow_replay,'delete_now',not payload.allow_replay and complete);
end;
$$;
revoke all on function public.send_instant_v2(uuid,uuid,text,text,boolean) from public,anon;
grant execute on function public.send_instant_v2(uuid,uuid,text,text,boolean) to authenticated;
revoke all on function public.claim_instant_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_instant_v2(uuid,uuid) to service_role;
alter publication supabase_realtime add table public.instant_receipts;
notify pgrst,'reload schema';
commit;
