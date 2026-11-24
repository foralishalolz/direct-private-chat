-- Couple-themed 3D arcade: two-player, server-authoritative rounds.
-- High-frequency movement travels over a private Realtime broadcast topic;
-- only round creation, item collection and scoring write to the database.

create or replace function private.valid_couple3d_items(items jsonb) returns boolean
language sql immutable set search_path='' as $$
  select jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) = 6
    and not exists (
      select 1 from jsonb_array_elements(items) with ordinality as t(value,ord)
      where jsonb_typeof(t.value) <> 'object'
         or t.value->>'id' !~ '^[a-z0-9-]{1,24}$'
         or jsonb_typeof(t.value->'x') is distinct from 'number'
         or jsonb_typeof(t.value->'y') is distinct from 'number'
         or jsonb_typeof(t.value->'z') is distinct from 'number'
         or (t.value->>'x')::float8 not between -12 and 12
         or (t.value->>'y')::float8 not between 0 and 8
         or (t.value->>'z')::float8 not between -12 and 12
         or (t.value->>'collected_by' is not null and t.value->>'collected_by' not in ('a','b'))
    );
$$;

create or replace function private.couple3d_items(p_mode text) returns jsonb
language sql immutable set search_path='' as $$
  select case p_mode
    when 'orbit' then jsonb_build_array(
      jsonb_build_object('id','h1','x',-7,'y',2,'z',-5,'collected_by',null),
      jsonb_build_object('id','h2','x',-2,'y',4,'z',-8,'collected_by',null),
      jsonb_build_object('id','h3','x',4,'y',3,'z',-7,'collected_by',null),
      jsonb_build_object('id','h4','x',8,'y',2,'z',-1,'collected_by',null),
      jsonb_build_object('id','h5','x',2,'y',5,'z',6,'collected_by',null),
      jsonb_build_object('id','h6','x',-6,'y',3,'z',7,'collected_by',null)
    )
    when 'garden' then jsonb_build_array(
      jsonb_build_object('id','h1','x',-8,'y',1,'z',-6,'collected_by',null),
      jsonb_build_object('id','h2','x',-3,'y',2,'z',-2,'collected_by',null),
      jsonb_build_object('id','h3','x',3,'y',1,'z',-7,'collected_by',null),
      jsonb_build_object('id','h4','x',8,'y',2,'z',2,'collected_by',null),
      jsonb_build_object('id','h5','x',1,'y',3,'z',7,'collected_by',null),
      jsonb_build_object('id','h6','x',-7,'y',2,'z',5,'collected_by',null)
    )
    else jsonb_build_array(
      jsonb_build_object('id','h1','x',-9,'y',3,'z',0,'collected_by',null),
      jsonb_build_object('id','h2','x',-4,'y',5,'z',-6,'collected_by',null),
      jsonb_build_object('id','h3','x',0,'y',2,'z',-9,'collected_by',null),
      jsonb_build_object('id','h4','x',5,'y',4,'z',-5,'collected_by',null),
      jsonb_build_object('id','h5','x',9,'y',3,'z',2,'collected_by',null),
      jsonb_build_object('id','h6','x',-2,'y',5,'z',8,'collected_by',null)
    )
  end;
$$;

create table if not exists public.couple_3d_match (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  round_id uuid not null default gen_random_uuid(),
  mode text not null check (mode in ('orbit','garden','rally')),
  items jsonb not null check (private.valid_couple3d_items(items)),
  score_a integer not null default 0 check (score_a between 0 and 6),
  score_b integer not null default 0 check (score_b between 0 and 6),
  winner uuid references public.profiles(id),
  finished boolean not null default false,
  started_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.couple_3d_match enable row level security;
revoke all on public.couple_3d_match from public, anon, authenticated;
grant select on public.couple_3d_match to authenticated;
grant all on public.couple_3d_match to service_role;
drop policy if exists couple_3d_match_read on public.couple_3d_match;
create policy couple_3d_match_read on public.couple_3d_match for select to authenticated
  using (private.is_member(conversation_id));

-- Allow the new activity kind in the shared activity dock.
alter table public.shared_activity drop constraint if exists shared_activity_kind_check;
alter table public.shared_activity add constraint shared_activity_kind_check
  check (kind in ('makeout','game','draw','wyr','kiss','pet','arcade','listen','arcade3d'));
create or replace function public.open_activity(p_conversation uuid,p_kind text,p_ref uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); row public.shared_activity;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if p_kind is null or p_kind not in ('makeout','game','draw','wyr','kiss','pet','arcade','listen','arcade3d') then raise exception 'Unknown activity.'; end if;
  if p_kind in ('makeout','kiss','pet') and not private.is_couple(p_conversation) then raise exception 'Both people must enable couple mode.'; end if;
  insert into public.shared_activity as a(conversation_id,kind,ref_id,opened_by,opened_at,closed_at,updated_at)
  values(p_conversation,p_kind,p_ref,me,clock_timestamp(),null,clock_timestamp())
  on conflict(conversation_id) do update set kind=excluded.kind,ref_id=excluded.ref_id,opened_by=excluded.opened_by,opened_at=excluded.opened_at,closed_at=null,updated_at=excluded.updated_at
  returning * into row;
  return to_jsonb(row);
end $$;

create or replace function public.start_couple_3d(p_conversation uuid,p_mode text)
returns public.couple_3d_match language plpgsql security definer set search_path='' as $$
declare r public.couple_3d_match; me uuid:=auth.uid(); a uuid; b uuid;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Game unavailable.'; end if;
  select member_a,member_b into a,b from public.conversations where id=p_conversation and kind='direct';
  if a is null or b is null or (me is distinct from a and me is distinct from b) then raise exception 'Game unavailable.'; end if;
  if p_mode is null or p_mode not in ('orbit','garden','rally') then raise exception 'Unknown game.'; end if;
  perform 1 from public.conversations where id=p_conversation for update;
  select * into r from public.couple_3d_match where conversation_id=p_conversation;
  if r.conversation_id is not null and not r.finished then raise exception 'Finish the current 3D round first.'; end if;
  insert into public.couple_3d_match as m(conversation_id,round_id,mode,items,score_a,score_b,winner,finished,started_by,updated_at)
  values(p_conversation,gen_random_uuid(),p_mode,private.couple3d_items(p_mode),0,0,null,false,me,clock_timestamp())
  on conflict(conversation_id) do update set round_id=excluded.round_id,mode=excluded.mode,items=excluded.items,score_a=0,score_b=0,winner=null,finished=false,started_by=excluded.started_by,updated_at=excluded.updated_at
  returning * into r;
  perform public.open_activity(p_conversation,'arcade3d');
  return r;
end $$;

create or replace function public.submit_couple_3d(p_conversation uuid,p_round uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns public.couple_3d_match language plpgsql security definer set search_path='' as $$
declare r public.couple_3d_match; me uuid:=auth.uid(); a uuid; b uuid; side text;
  item_id text; expected text; next_items jsonb; new_a integer; new_b integer; done boolean; champ uuid;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Game unavailable.'; end if;
  select member_a,member_b into a,b from public.conversations where id=p_conversation and kind='direct';
  if a is null or b is null or (me is distinct from a and me is distinct from b) then raise exception 'Game unavailable.'; end if;
  select * into r from public.couple_3d_match where conversation_id=p_conversation for update;
  if r.conversation_id is null or r.finished or r.round_id is distinct from p_round then raise exception 'Round is over.'; end if;
  if p_action = 'end' then
    update public.couple_3d_match set finished=true,updated_at=clock_timestamp() where conversation_id=p_conversation returning * into r;
    return r;
  end if;
  if p_action is distinct from 'collect' or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>256 then raise exception 'Invalid move.'; end if;
  item_id:=p_payload->>'item';
  if item_id is null or item_id !~ '^[a-z0-9-]{1,24}$' then raise exception 'Invalid item.'; end if;
  if not exists(select 1 from jsonb_array_elements(r.items) as t(value) where t.value->>'id'=item_id and t.value->>'collected_by' is null) then raise exception 'Already collected.'; end if;
  if r.mode='rally' then
    select t.value->>'id' into expected from jsonb_array_elements(r.items) with ordinality as t(value,ord)
      where t.value->>'collected_by' is null order by t.ord limit 1;
    if item_id is distinct from expected then raise exception 'Follow the constellation.'; end if;
  end if;
  side:=case when me=a then 'a' else 'b' end;
  select coalesce(jsonb_agg(case when t.value->>'id'=item_id then jsonb_set(t.value,'{collected_by}',to_jsonb(side),false) else t.value end order by t.ord),'[]'::jsonb)
    into next_items from jsonb_array_elements(r.items) with ordinality as t(value,ord);
  new_a:=r.score_a+case when side='a' then 1 else 0 end;
  new_b:=r.score_b+case when side='b' then 1 else 0 end;
  done:=not exists(select 1 from jsonb_array_elements(next_items) as t(value) where t.value->>'collected_by' is null)
    or (r.mode='rally' and (new_a>=4 or new_b>=4));
  champ:=case when not done or r.mode='garden' then null when new_a>new_b then a when new_b>new_a then b else null end;
  update public.couple_3d_match set items=next_items,score_a=new_a,score_b=new_b,finished=done,winner=champ,updated_at=clock_timestamp()
    where conversation_id=p_conversation returning * into r;
  return r;
end $$;

revoke all on function public.start_couple_3d(uuid,text), public.submit_couple_3d(uuid,uuid,text,jsonb) from public, anon;
grant execute on function public.start_couple_3d(uuid,text), public.submit_couple_3d(uuid,uuid,text,jsonb) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='couple_3d_match') then
    alter publication supabase_realtime add table public.couple_3d_match;
  end if;
end $$;

-- A dedicated broadcast topic keeps 10 Hz position updates out of the database.
drop policy if exists bitchat_couple3d_read on realtime.messages;
create policy bitchat_couple3d_read on realtime.messages for select to authenticated using (
  extension='broadcast'
  and topic ~ '^couple3d:[0-9a-f-]{36}$'
  and private.is_member(case when topic ~ '^couple3d:[0-9a-f-]{36}$' then (substring(topic from 10))::uuid else null end)
);
drop policy if exists bitchat_couple3d_write on realtime.messages;
create policy bitchat_couple3d_write on realtime.messages for insert to authenticated with check (
  extension='broadcast'
  and topic ~ '^couple3d:[0-9a-f-]{36}$'
  and private.is_member(case when topic ~ '^couple3d:[0-9a-f-]{36}$' then (substring(topic from 10))::uuid else null end)
  and jsonb_typeof(payload)='object'
  and octet_length(payload::text)<=512
  and payload->>'userId'=auth.uid()::text
  and coalesce(payload->>'roundId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and payload->>'type' in ('move','sync','collect')
  and (payload->>'type' is distinct from 'move' or (
    jsonb_typeof(payload->'x')='number' and jsonb_typeof(payload->'y')='number' and jsonb_typeof(payload->'z')='number'
    and (payload->>'x')::float8 between -12 and 12
    and (payload->>'y')::float8 between 0 and 8
    and (payload->>'z')::float8 between -12 and 12
    and jsonb_typeof(payload->'yaw')='number'
    and (payload->>'yaw')::float8 between -6.3 and 6.3
  ))
  and (payload->>'type' is distinct from 'collect' or payload->>'item' ~ '^[a-z0-9-]{1,24}$')
);

comment on table public.couple_3d_match is 'Two-player couple-themed 3D arcade rounds; positions are ephemeral Realtime broadcasts.';
notify pgrst, 'reload schema';
