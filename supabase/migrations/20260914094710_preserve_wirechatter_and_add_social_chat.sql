-- supabase/schema.sql
-- BitchAt. Paste this ENTIRE script into the Supabase SQL Editor as postgres.
-- Re-runnable. Preserves the inspected Wirechatter groups, profiles and text history.
-- No application passwords or privileged Supabase keys belong in browser code.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- Adopt only the inspected Wirechatter group schema. All data moves in this transaction.
-- Unknown schemas and unknown policies still abort instead of being overwritten.
do $$ begin
  if (to_regclass('public.messages') is not null or to_regclass('public.profiles') is not null)
     and to_regclass('private.bitchat_installation') is null then
    if to_regclass('public.groups') is null or to_regclass('public.group_members') is null
       or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='messages' and column_name='group_id' and data_type='uuid')
       or exists(select 1 from information_schema.columns where table_schema='public' and table_name='messages' and column_name='conversation_id') then
      raise exception 'Unrecognized existing schema. No data has been changed.';
    end if;
    if exists(select 1 from public.profiles p join auth.users a on a.id=p.id where p.username !~ '^[a-z0-9_]{3,24}$' or a.email<>p.username||'@chat.local') then
      raise exception 'Existing account names require a separate compatibility migration.';
    end if;
    perform set_config('bitchat.legacy_migration','yes',true);
  end if;
end $$;

create table if not exists private.bitchat_installation(version integer primary key,installed_at timestamptz not null default now());
insert into private.bitchat_installation(version) values(1) on conflict do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '' check (char_length(display_name)<=40),
  avatar_url text,
  mood text check (mood is null or mood in ('🥰','😊','🥺','😴','😔','😤','🤍','🫶')),
  is_pro boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  member_a uuid references public.profiles(id) on delete cascade,
  member_b uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_activity timestamptz not null default now(),
  kind text not null default 'direct' check(kind in ('direct','group')),
  title text not null default '' check(length(title)<=60),
  created_by uuid references public.profiles(id) on delete set null,
  couple_a boolean not null default false,
  couple_b boolean not null default false,
  unique(member_a, member_b), check (member_a < member_b)
);
-- Additive upgrades also work on a previously installed BitchAt schema.
alter table public.profiles add column if not exists display_name text not null default '' check(length(display_name)<=40);
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists mood text check(mood is null or mood in ('🥰','😊','🥺','😴','😔','😤','🤍','🫶'));
alter table public.profiles add column if not exists is_pro boolean not null default false;
alter table public.conversations alter column member_a drop not null;
alter table public.conversations alter column member_b drop not null;
alter table public.conversations add column if not exists kind text not null default 'direct' check(kind in ('direct','group'));
alter table public.conversations add column if not exists title text not null default '' check(length(title)<=60);
alter table public.conversations add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.conversations add column if not exists couple_a boolean not null default false;
alter table public.conversations add column if not exists couple_b boolean not null default false;
alter table public.conversations drop constraint if exists bitchat_conversation_shape;
alter table public.conversations add constraint bitchat_conversation_shape check(
  (kind='direct' and member_a is not null and member_b is not null and member_a<member_b) or
  (kind='group' and member_a is null and member_b is null and length(btrim(title)) between 1 and 60));
create index if not exists conversations_creator on public.conversations(created_by);
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key(conversation_id,user_id)
);
create index if not exists conversation_members_user on public.conversation_members(user_id,conversation_id);

-- Keep original row IDs, text, timestamps, group tables and passwords intact.
do $$ begin
  if current_setting('bitchat.legacy_migration',true)='yes' then
    update public.profiles set display_name=username where display_name='';
    insert into public.conversations(id,kind,title,created_by,created_at,last_activity)
      select g.id,'group',g.name,g.created_by,g.created_at,
        coalesce((select max(m.created_at) from public.messages m where m.group_id=g.id),g.created_at) from public.groups g;
    insert into public.conversation_members(conversation_id,user_id,joined_at)
      select group_id,user_id,added_at from public.group_members;
    alter table public.messages add column conversation_id uuid references public.conversations(id) on delete cascade;
    update public.messages set conversation_id=group_id;
    alter table public.messages alter column conversation_id set not null;
    alter table public.messages alter column group_id drop not null;
    alter table public.messages drop constraint if exists messages_content_length;
    alter table public.messages drop constraint if exists messages_content_not_blank;
    alter table public.messages add constraint bitchat_content_length check(length(content)<=4000);
    alter table public.messages alter column content set default '';
    alter table public.messages alter column user_id set default auth.uid();
    drop trigger if exists on_auth_user_created on auth.users;
    drop policy if exists "Authenticated members can read profiles" on public.profiles;
    drop policy if exists "Authenticated members can read messages" on public.messages;
    drop policy if exists "Members can create their own messages" on public.messages;
    drop policy if exists "Members can edit their own messages" on public.messages;
    drop policy if exists "Members can delete their own messages" on public.messages;
  end if;
end $$;

create index if not exists conversations_a_activity on public.conversations(member_a,last_activity desc);
create index if not exists conversations_b_activity on public.conversations(member_b,last_activity desc);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  content text not null default '' check (char_length(content)<=4000),
  media_url text,
  media_kind text check (media_kind in ('image','video','audio')),
  kind text not null default 'message' check (kind in ('message','instant','sticker','miss')),
  reply_to uuid references public.messages(id) on delete set null,
  instant_viewed boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.messages add column if not exists group_id uuid;
alter table public.messages add column if not exists media_url text;
alter table public.messages add column if not exists media_kind text check(media_kind in ('image','video','audio'));
alter table public.messages add column if not exists kind text not null default 'message' check(kind in ('message','instant','sticker','miss'));
alter table public.messages add column if not exists reply_to uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists instant_viewed boolean not null default false;
create index if not exists messages_reply on public.messages(reply_to);
create index if not exists messages_cursor on public.messages(conversation_id,created_at desc,id desc);
create unique index if not exists messages_media on public.messages(media_url) where media_url is not null;
create index if not exists messages_owner on public.messages(user_id);
create table if not exists public.journals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  mood text check (mood is null or mood in ('🥰','😊','🥺','😴','😔','😤','🤍','🫶')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists journals_cursor on public.journals(user_id,created_at desc,id desc);
create table if not exists public.capsules (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  unlock_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists capsules_conversation on public.capsules(conversation_id,created_at desc,id desc);
create table if not exists private.capsule_payloads (
  capsule_id uuid primary key references public.capsules(id) on delete cascade,
  content text not null default '', media_url text
);
create unique index if not exists capsule_media on private.capsule_payloads(media_url) where media_url is not null;
create table if not exists private.instant_payloads (
  message_id uuid primary key references public.messages(id) on delete cascade,
  media_url text not null unique,
  claimed_at timestamptz,
  expires_at timestamptz not null default now()+interval '24 hours'
);
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  prompt text not null,
  available_at timestamptz not null,
  completed_a timestamptz,
  completed_b timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists goals_conversation on public.goals(conversation_id,created_at desc);
create unique index if not exists goals_one_pending on public.goals(conversation_id) where completed_a is null or completed_b is null;
create table if not exists private.pro_config (id boolean primary key default true check(id), password_hash text not null);
insert into private.pro_config(id,password_hash) values(true,extensions.crypt('1162',extensions.gen_salt('bf',12))) on conflict(id) do nothing;
create table if not exists private.pro_attempts (user_id uuid primary key references auth.users(id) on delete cascade, attempts integer not null default 0, window_start timestamptz not null default now());
create table if not exists private.media_cleanup_jobs (
  bucket_id text not null, object_path text not null, created_at timestamptz not null default now(),
  attempts integer not null default 0, last_error text, primary key(bucket_id,object_path)
);
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function private.is_member(p_conversation uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (exists(select 1 from public.conversations c where c.id=p_conversation and auth.uid() in (c.member_a,c.member_b)) or exists(select 1 from public.conversation_members m where m.conversation_id=p_conversation and m.user_id=auth.uid()));
$$;
create or replace function private.is_pro()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select p.is_pro from public.profiles p where p.id=auth.uid()),false);
$$;
create or replace function private.can_see_profile(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_user=auth.uid() or exists(select 1 from public.conversations c where
    (c.member_a=auth.uid() and c.member_b=p_user) or (c.member_b=auth.uid() and c.member_a=p_user)) or exists(select 1 from public.conversation_members m where m.user_id=p_user and private.is_member(m.conversation_id));
$$;
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare u text := lower(split_part(new.email,'@',1));
begin
  if new.email !~ '^[a-zA-Z0-9_]{3,24}@chat[.]local$' then raise exception 'Use a valid BitchAt username.'; end if;
  insert into public.profiles(id,username,display_name) values(new.id,u,u) on conflict(id) do nothing;
  return new;
end;
$$;
drop trigger if exists bitchat_auth_profile on auth.users;
create trigger bitchat_auth_profile after insert on auth.users for each row execute function public.handle_new_user();
-- Repair missing profiles for existing username/password users without changing credentials.
insert into public.profiles(id,username,display_name)
select id,lower(split_part(email,'@',1)),lower(split_part(email,'@',1)) from auth.users
where email ~ '^[a-zA-Z0-9_]{3,24}@chat[.]local$' on conflict(id) do nothing;

create or replace function public.find_profiles(p_query text)
returns table(id uuid,username text,display_name text,avatar_url text)
language sql stable security definer set search_path='' as $$
  select p.id,p.username,p.display_name,p.avatar_url from public.profiles p
  where auth.uid() is not null and p.id<>auth.uid() and length(p_query) between 2 and 24
    and p.username like replace(replace(lower(p_query),'%','\%'),'_','\_') || '%' escape '\'
  order by p.username limit 12;
$$;
create or replace function public.open_conversation(p_other uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; me uuid := auth.uid();
begin
  if me is null or me=p_other or not exists(select 1 from public.profiles where id=p_other) then raise exception 'Person unavailable.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text,0));
  select id into result from public.conversations where member_a=least(me,p_other) and member_b=greatest(me,p_other);
  if result is not null then return result; end if;
  if (select count(*) from public.conversations where (member_a=me or member_b=me) and created_at>now()-interval '1 hour')>=20 then raise exception 'Please try again later.'; end if;
  insert into public.conversations(member_a,member_b) values(least(me,p_other),greatest(me,p_other))
  on conflict(member_a,member_b) do update set member_a=excluded.member_a returning id into result;
  return result;
end;
$$;
create or replace function public.unlock_pro(p_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare record private.pro_attempts; hash text;
begin
  if auth.uid() is null then return false; end if;
  insert into private.pro_attempts(user_id) values(auth.uid()) on conflict do nothing;
  select * into record from private.pro_attempts where user_id=auth.uid() for update;
  if record.window_start < now()-interval '15 minutes' then
    update private.pro_attempts set attempts=0,window_start=now() where user_id=auth.uid(); record.attempts:=0;
  end if;
  if record.attempts>=5 or p_code is null or length(p_code)>128 then return false; end if;
  update private.pro_attempts set attempts=attempts+1 where user_id=auth.uid();
  select password_hash into hash from private.pro_config where id=true;
  if extensions.crypt(p_code,hash)=hash then
    update public.profiles set is_pro=true where id=auth.uid();
    delete from private.pro_attempts where user_id=auth.uid(); return true;
  end if;
  return false;
end;
$$;

create or replace function private.can_upload(p_name text,p_avatar boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare parts text[]:=string_to_array(p_name,'/');
begin
  if auth.uid() is null or parts[1]<>auth.uid()::text then return false; end if;
  if p_avatar then return array_length(parts,1)=2 and parts[2] ~ '^[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$'; end if;
  if array_length(parts,1)<>3 or parts[2] !~ '^[0-9a-f-]{36}$' or parts[3] !~ '^[0-9a-f-]{36}[.](jpg|jpeg|png|webp|gif|mp4|webm|mov|m4a|ogg|mp3|wav)$' then return false; end if;
  return private.is_member(parts[2]::uuid);
exception when invalid_text_representation then return false;
end;
$$;
create or replace function private.owns_upload(p_bucket text,p_name text,p_conversation uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_upload(p_name) and split_part(p_name,'/',2)=p_conversation::text and exists(
    select 1 from storage.objects o where o.bucket_id=p_bucket and o.name=p_name and o.created_at>now()-interval '24 hours');
$$;
create table if not exists private.message_tombstones (id uuid primary key, deleted_at timestamptz not null default now());
alter table private.message_tombstones enable row level security;
revoke all on private.message_tombstones from public, anon, authenticated;
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
  if new.kind<>'instant' and new.content='' and new.media_url is null then raise exception 'Write a message or choose a photo.'; end if;
  if new.reply_to is not null and not exists(select 1 from public.messages where id=new.reply_to and conversation_id=new.conversation_id) then raise exception 'Reply unavailable.'; end if;
  if new.media_url is not null then
    if not private.owns_upload('chat-media',new.media_url,new.conversation_id) then raise exception 'Upload unavailable.'; end if;
    select metadata->>'mimetype' into mime from storage.objects where bucket_id='chat-media' and name=new.media_url;
    new.media_kind:=case when mime like 'video/%' then 'video' when mime like 'audio/%' then 'audio' else 'image' end;
  else new.media_kind:=null; end if;
  return new;
end;
$$;
drop trigger if exists bitchat_validate_message on public.messages;
create trigger bitchat_validate_message before insert on public.messages for each row execute function private.validate_message();
create or replace function private.message_activity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.conversations set last_activity=new.created_at where id=new.conversation_id;
  return new;
end;
$$;
drop trigger if exists bitchat_message_activity on public.messages;
create trigger bitchat_message_activity after insert on public.messages for each row execute function private.message_activity();
create or replace function private.validate_profile()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.avatar_url is distinct from old.avatar_url and new.avatar_url is not null and not exists (
    select 1 from storage.objects where bucket_id='avatars' and name=new.avatar_url and split_part(name,'/',1)=new.id::text
  ) then raise exception 'Profile photo unavailable.'; end if;
  return new;
end;
$$;
drop trigger if exists bitchat_validate_profile on public.profiles;
create trigger bitchat_validate_profile before update on public.profiles for each row execute function private.validate_profile();
create or replace function private.journal_time()
returns trigger language plpgsql set search_path='' as $$ begin new.updated_at:=now(); return new; end; $$;
drop trigger if exists bitchat_journal_time on public.journals;
create trigger bitchat_journal_time before update on public.journals for each row execute function private.journal_time();

create or replace function public.create_capsule(p_id uuid,p_conversation uuid,p_content text,p_media text,p_unlock timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if exists(select 1 from public.capsules where id=p_id and user_id=auth.uid() and conversation_id=p_conversation) then return p_id; end if;
  if p_unlock is null or p_unlock<=clock_timestamp() or p_unlock>now()+interval '5 years' then raise exception 'Choose a future date within five years.'; end if;
  if p_content is null or length(p_content)>4000 or (btrim(p_content)='' and p_media is null) then raise exception 'Add a note or photo.'; end if;
  if p_media is not null and not private.owns_upload('capsule-media',p_media,p_conversation) then raise exception 'Photo unavailable.'; end if;
  insert into public.capsules(id,conversation_id,user_id,unlock_at) values(p_id,p_conversation,auth.uid(),p_unlock);
  insert into private.capsule_payloads(capsule_id,content,media_url) values(p_id,btrim(p_content),p_media);
  return p_id;
end;
$$;
create or replace function public.open_capsule(p_id uuid)
returns table(content text,media_url text) language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.capsules where id=p_id and private.is_member(conversation_id) and unlock_at<=clock_timestamp()) then raise exception 'This capsule is still sealed.'; end if;
  return query select p.content,case when c.unlock_at>now()-interval '24 hours' then p.media_url else null end
  from private.capsule_payloads p join public.capsules c on c.id=p.capsule_id where p.capsule_id=p_id;
end;
$$;
create or replace function public.send_instant(p_id uuid,p_conversation uuid,p_media text,p_source text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if exists(select 1 from public.messages where id=p_id and user_id=auth.uid() and conversation_id=p_conversation and kind='instant') then return p_id; end if;
  if p_source is null or p_source not in ('camera','file') or (p_source='file' and not private.is_pro()) then raise exception 'Camera only.'; end if;
  if not private.owns_upload('instant-media',p_media,p_conversation) then raise exception 'Photo unavailable.'; end if;
  insert into public.messages(id,conversation_id,user_id,kind) values(p_id,p_conversation,auth.uid(),'instant');
  insert into private.instant_payloads(message_id,media_url) values(p_id,p_media);
  return p_id;
end;
$$;
-- This function is callable ONLY by the trusted Edge Function (service_role).
create or replace function public.claim_instant(p_id uuid,p_viewer uuid)
returns text language plpgsql security definer set search_path='' as $$
declare path text;
begin
  update private.instant_payloads p set claimed_at=clock_timestamp() from public.messages m join public.conversations c on c.id=m.conversation_id
  where p.message_id=p_id and m.id=p.message_id and m.user_id<>p_viewer
    and (p_viewer in (c.member_a,c.member_b) or exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id and cm.user_id=p_viewer)) and p.claimed_at is null and p.expires_at>clock_timestamp()
  returning p.media_url into path;
  if path is null then raise exception 'This instant is no longer available.'; end if;
  update public.messages set instant_viewed=true where id=p_id;
  return path;
end;
$$;
create or replace function public.ensure_goal(p_conversation uuid)
returns public.goals language plpgsql security definer set search_path='' as $$
declare result public.goals; prompts text[]:=array[
  'Send each other a photo of something that made you smile.',
  'Pick a song that reminds you of us. Listen to both together.',
  'Tell each other one little thing you appreciated today.',
  'Plan a tiny date. Even ten minutes counts.',
  'Take a five-minute phone-free break together.',
  'Share a favorite memory of the two of you.',
  'Draw each other in one minute. No erasing.',
  'Choose one new thing you would love to try together.'
];
begin
  if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if not exists(select 1 from public.conversations where id=p_conversation and kind='direct' and couple_a and couple_b) then raise exception 'Shared space is not enabled.'; end if;
  perform 1 from public.conversations where id=p_conversation for update;
  select * into result from public.goals where conversation_id=p_conversation and (completed_a is null or completed_b is null) limit 1;
  if result.id is null then
    insert into public.goals(conversation_id,prompt,available_at) values(p_conversation,prompts[1+floor(random()*array_length(prompts,1))::int],now()+interval '4 hours'+random()*interval '8 hours') returning * into result;
  end if;
  return result;
end;
$$;
create or replace function public.complete_goal(p_id uuid)
returns public.goals language plpgsql security definer set search_path='' as $$
declare result public.goals;
begin
  update public.goals g set completed_a=case when c.member_a=auth.uid() then coalesce(g.completed_a,now()) else g.completed_a end,
    completed_b=case when c.member_b=auth.uid() then coalesce(g.completed_b,now()) else g.completed_b end
  from public.conversations c where c.id=g.conversation_id and g.id=p_id and auth.uid() in (c.member_a,c.member_b) and g.available_at<=now() returning g.* into result;
  if result.id is null then raise exception 'Goal unavailable.'; end if;
  return result;
end;
$$;

-- Explicit privileges prevent changing is_pro, authors, recipients or timestamps.
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.journals enable row level security;
alter table public.capsules enable row level security;
alter table public.goals enable row level security;
revoke all on public.profiles,public.conversations,public.messages,public.journals,public.capsules,public.goals from public,anon,authenticated;
grant select on public.profiles,public.conversations,public.messages,public.journals,public.capsules,public.goals to authenticated;
grant update(display_name,avatar_url,mood) on public.profiles to authenticated;
grant insert(id,conversation_id,group_id,user_id,content,media_url,media_kind,kind,reply_to) on public.messages to authenticated;
grant update(content),delete on public.messages to authenticated;
grant insert(id,user_id,body,mood),update(body,mood),delete on public.journals to authenticated;
grant all on public.profiles,public.conversations,public.messages,public.journals,public.capsules,public.goals to service_role;
-- Refuse unknown permissive policies instead of silently weakening privacy.
do $$ begin
  if exists(select 1 from pg_policies where schemaname='public' and tablename in ('profiles','conversations','messages','journals','capsules','goals') and policyname not like 'bitchat_%') then
    raise exception 'Existing policies need review. Remove or migrate older policies on BitchAt tables before running this script.';
  end if;
end $$;
drop policy if exists bitchat_profile_read on public.profiles;
create policy bitchat_profile_read on public.profiles for select to authenticated using(private.can_see_profile(id));
drop policy if exists bitchat_profile_update on public.profiles;
create policy bitchat_profile_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
drop policy if exists bitchat_conversation_read on public.conversations;
create policy bitchat_conversation_read on public.conversations for select to authenticated using(private.is_member(id));
drop policy if exists bitchat_message_read on public.messages;
create policy bitchat_message_read on public.messages for select to authenticated using(private.is_member(conversation_id));
drop policy if exists bitchat_message_insert on public.messages;
create policy bitchat_message_insert on public.messages for insert to authenticated with check(user_id=(select auth.uid()) and private.is_member(conversation_id) and kind in ('message','sticker','miss'));
drop policy if exists bitchat_message_edit on public.messages;
create policy bitchat_message_edit on public.messages for update to authenticated using(user_id=(select auth.uid()) and private.is_member(conversation_id) and (select private.is_pro())) with check(user_id=(select auth.uid()) and private.is_member(conversation_id) and (select private.is_pro()));
drop policy if exists bitchat_message_delete on public.messages;
create policy bitchat_message_delete on public.messages for delete to authenticated using(user_id=(select auth.uid()) and private.is_member(conversation_id) and (select private.is_pro()));
drop policy if exists bitchat_journal_owner on public.journals;
create policy bitchat_journal_owner on public.journals for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists bitchat_capsule_read on public.capsules;
create policy bitchat_capsule_read on public.capsules for select to authenticated using(private.is_member(conversation_id));
drop policy if exists bitchat_goal_read on public.goals;
create policy bitchat_goal_read on public.goals for select to authenticated using(private.is_member(conversation_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('chat-media','chat-media',false,26214400,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav']),
 ('capsule-media','capsule-media',false,10485760,array['image/jpeg','image/png','image/webp']),
 ('instant-media','instant-media',false,10485760,array['image/jpeg','image/png','image/webp']),
 ('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function private.can_read_media(p_bucket text,p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select case
    when p_bucket='avatars' then auth.uid() is not null
    when p_bucket='chat-media' then exists(select 1 from public.messages m where m.media_url=p_name and private.is_member(m.conversation_id) and m.created_at>now()-interval '24 hours')
    when p_bucket='capsule-media' then exists(select 1 from private.capsule_payloads p join public.capsules c on c.id=p.capsule_id where p.media_url=p_name and private.is_member(c.conversation_id) and c.unlock_at<=now() and c.unlock_at>now()-interval '24 hours')
    else false
  end;
$$;
drop policy if exists bitchat_storage_insert on storage.objects;
create policy bitchat_storage_insert on storage.objects for insert to authenticated with check(
  (bucket_id in ('chat-media','capsule-media','instant-media') and private.can_upload(name)) or (bucket_id='avatars' and private.can_upload(name,true))
);
drop policy if exists bitchat_storage_read on storage.objects;
create policy bitchat_storage_read on storage.objects for select to authenticated using(private.can_read_media(bucket_id,name));
-- Restrictive gates protect our buckets even if this project has older broad policies.
drop policy if exists bitchat_storage_read_gate on storage.objects;
create policy bitchat_storage_read_gate on storage.objects as restrictive for select to authenticated using(bucket_id not in ('chat-media','capsule-media','instant-media','avatars') or private.can_read_media(bucket_id,name));
drop policy if exists bitchat_storage_insert_gate on storage.objects;
create policy bitchat_storage_insert_gate on storage.objects as restrictive for insert to authenticated with check(bucket_id not in ('chat-media','capsule-media','instant-media','avatars') or (bucket_id='avatars' and private.can_upload(name,true)) or (bucket_id<>'avatars' and private.can_upload(name)));
drop policy if exists bitchat_storage_update_gate on storage.objects;
create policy bitchat_storage_update_gate on storage.objects as restrictive for update to authenticated using(bucket_id not in ('chat-media','capsule-media','instant-media','avatars')) with check(bucket_id not in ('chat-media','capsule-media','instant-media','avatars'));
drop policy if exists bitchat_storage_delete_gate on storage.objects;
create policy bitchat_storage_delete_gate on storage.objects as restrictive for delete to authenticated using(bucket_id not in ('chat-media','capsule-media','instant-media','avatars'));
drop policy if exists bitchat_storage_anon_gate on storage.objects;
create policy bitchat_storage_anon_gate on storage.objects as restrictive for all to anon using(bucket_id not in ('chat-media','capsule-media','instant-media','avatars')) with check(bucket_id not in ('chat-media','capsule-media','instant-media','avatars'));
-- No direct client UPDATE/DELETE on objects. All removal uses the Storage API.

create or replace function public.get_media_cleanup_batch()
returns table(bucket_id text,object_path text) language plpgsql security definer set search_path='' as $$
begin
  insert into private.media_cleanup_jobs(bucket_id,object_path)
  select o.bucket_id,o.name from storage.objects o where
    (o.bucket_id='chat-media' and o.created_at<now()-interval '24 hours') or
    (o.bucket_id='instant-media' and (o.created_at<now()-interval '24 hours' or exists(select 1 from private.instant_payloads p where p.media_url=o.name and p.claimed_at is not null))) or
    (o.bucket_id='capsule-media' and (
      exists(select 1 from private.capsule_payloads p join public.capsules c on c.id=p.capsule_id where p.media_url=o.name and c.unlock_at<now()-interval '24 hours') or
      (o.created_at<now()-interval '24 hours' and not exists(select 1 from private.capsule_payloads p where p.media_url=o.name))
    )) or (o.bucket_id='avatars' and o.created_at<now()-interval '24 hours' and not exists(select 1 from public.profiles p where p.avatar_url=o.name))
  limit 1000 on conflict do nothing;
  return query select j.bucket_id,j.object_path from private.media_cleanup_jobs j order by j.attempts,j.created_at limit 100;
end;
$$;
create or replace function public.finish_media_cleanup(p_bucket text,p_paths text[],p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_error is not null then
    update private.media_cleanup_jobs set attempts=attempts+1,last_error=left(p_error,200) where bucket_id=p_bucket and object_path=any(p_paths); return;
  end if;
  if p_bucket='chat-media' then update public.messages set media_url=null,media_kind=null where media_url=any(p_paths); end if;
  if p_bucket='capsule-media' then update private.capsule_payloads set media_url=null where media_url=any(p_paths); end if;
  if p_bucket='instant-media' then
    update public.messages set instant_viewed=true where id in (select message_id from private.instant_payloads where media_url=any(p_paths));
    delete from private.instant_payloads where media_url=any(p_paths);
  end if;
  delete from private.media_cleanup_jobs where bucket_id=p_bucket and object_path=any(p_paths);
end;
$$;
-- A server secret is generated inside Vault, not stored in a public table.
do $$ begin
  if not exists(select 1 from vault.secrets where name='bitchat_cleanup_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'bitchat_cleanup_secret');
  end if;
  if not exists(select 1 from vault.secrets where name='bitchat_project_url') then
    perform vault.create_secret('https://llweydgvtpwgnslvgnqm.supabase.co','bitchat_project_url');
  end if;
end $$;
create or replace function public.delete_expired_media()
returns bigint language plpgsql security definer set search_path='' as $$
declare project_url text; cleanup_secret text; request_id bigint;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name='bitchat_project_url';
  select decrypted_secret into cleanup_secret from vault.decrypted_secrets where name='bitchat_cleanup_secret';
  if project_url is null or cleanup_secret is null then raise exception 'Media cleanup is not configured.'; end if;
  select net.http_post(url:=project_url || '/functions/v1/media-cleanup',
    headers:=jsonb_build_object('Content-Type','application/json','x-cleanup-secret',cleanup_secret),body:='{}'::jsonb,timeout_milliseconds:=10000) into request_id;
  return request_id;
end;
$$;
-- Expiry is 24 hours; sweep frequently so storage is reclaimed within 15 minutes.
do $$ declare j record; begin
  if to_regclass('cron.job') is not null then
    for j in select jobid from cron.job where jobname in ('chat-media-expiry','bitchat-media-every-24-hours') loop perform cron.unschedule(j.jobid); end loop;
  end if;
end $$;
select cron.schedule('bitchat-media-expiry','*/15 * * * *','select public.delete_expired_media();');

create or replace function public.authorize_cleanup(p_secret text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from vault.decrypted_secrets where name='bitchat_cleanup_secret' and decrypted_secret=p_secret);
$$;
revoke all on function public.authorize_cleanup(text) from public,anon,authenticated;
grant execute on function public.authorize_cleanup(text) to service_role;
create table if not exists private.signup_windows (bucket text primary key,attempts integer not null default 0,window_start timestamptz not null default now());
create or replace function public.take_signup_slot(p_address text)
returns boolean language plpgsql security definer set search_path='' as $$
declare ip_bucket text; secret text; current_attempts integer;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name='bitchat_cleanup_secret';
  if secret is null or p_address is null or length(p_address)>80 then return false; end if;
  ip_bucket:=encode(extensions.digest(secret||p_address,'sha256'),'hex');
  perform pg_advisory_xact_lock(1162,71);
  delete from private.signup_windows where window_start<now()-interval '1 hour';
  insert into private.signup_windows(bucket) values('global'),(ip_bucket) on conflict do nothing;
  if (select attempts from private.signup_windows where bucket='global')>=30 or (select attempts from private.signup_windows where bucket=ip_bucket)>=5 then return false; end if;
  update private.signup_windows set attempts=attempts+1 where bucket in ('global',ip_bucket);
  return true;
end;
$$;
revoke all on function public.take_signup_slot(text) from public,anon,authenticated;
grant execute on function public.take_signup_slot(text) to service_role;
-- Only explicit entry points are callable. Trigger functions are not public RPCs.
-- Engagement features never read private journals or sealed capsule contents.
alter table public.conversations add column if not exists read_a timestamptz;
alter table public.conversations add column if not exists read_b timestamptz;
create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji text not null check(emoji in ('❤️','😂','🥺','🔥','😘','🫶')),
  primary key(message_id,user_id)
);
create index if not exists reactions_user on public.reactions(user_id);
create table if not exists private.activity_days (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null, messages integer not null default 0, media integer not null default 0, misses integer not null default 0,
  primary key(conversation_id,day,user_id)
);
create index if not exists activity_user on private.activity_days(user_id);
create table if not exists private.deleted_messages (
  message_id uuid primary key, conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null, username text not null, content text not null, kind text not null, created_at timestamptz not null, deleted_at timestamptz not null default now()
);
create index if not exists deleted_cursor on private.deleted_messages(conversation_id,deleted_at desc,message_id desc);
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  game_type text not null check(game_type in ('question','either','tic_tac_toe')),
  question text not null default '', option_a text, option_b text,
  board text not null default '---------', next_player uuid, winner uuid,
  ended_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists games_cursor on public.games(conversation_id,created_at desc,id desc);
create index if not exists games_creator on public.games(created_by);
create unique index if not exists one_active_game on public.games(conversation_id) where ended_at is null;
create table if not exists private.game_answers (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  answer text not null check(length(answer) between 1 and 500),primary key(game_id,user_id)
);
create index if not exists answers_user on private.game_answers(user_id);
create or replace function public.mark_read(p_conversation uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.conversation_members set last_read_at=now() where conversation_id=p_conversation and user_id=auth.uid();
  update public.conversations set read_a=case when member_a=auth.uid() then now() else read_a end,
  read_b=case when member_b=auth.uid() then now() else read_b end
  where id=p_conversation and auth.uid() in (member_a,member_b);
end;
$$;
create or replace function private.capture_activity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.activity_days(conversation_id,user_id,day,messages,media,misses)
  values(new.conversation_id,new.user_id,(new.created_at at time zone 'UTC')::date,1,(new.media_url is not null or new.kind='instant')::int,(new.kind='miss')::int)
  on conflict(conversation_id,day,user_id) do update set messages=activity_days.messages+1,media=activity_days.media+excluded.media,misses=activity_days.misses+excluded.misses;
  return new;
end;
$$;
drop trigger if exists bitchat_activity on public.messages;
create trigger bitchat_activity after insert on public.messages for each row execute function private.capture_activity();
create or replace function private.archive_deleted()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.message_tombstones(id) values(old.id) on conflict do nothing;
  if auth.uid() is not null and private.is_member(old.conversation_id) and private.is_pro() and old.kind<>'instant' then
    insert into private.deleted_messages(message_id,conversation_id,user_id,username,content,kind,created_at)
    values(old.id,old.conversation_id,old.user_id,(select username from public.profiles where id=old.user_id),old.content,old.kind,old.created_at) on conflict do nothing;
  end if;
  return old;
end;
$$;
drop trigger if exists bitchat_archive_deleted on public.messages;
create trigger bitchat_archive_deleted before delete on public.messages for each row execute function private.archive_deleted();
create or replace function public.deleted_history(p_conversation uuid,p_before timestamptz default null,p_before_id uuid default null)
returns setof private.deleted_messages language plpgsql security definer set search_path='' as $$
begin
  if not private.is_member(p_conversation) or not private.is_pro() then raise exception 'Pro required.'; end if;
  return query select * from private.deleted_messages where conversation_id=p_conversation and (p_before is null or (deleted_at,message_id)<(p_before,p_before_id)) order by deleted_at desc,message_id desc limit 30;
end;
$$;
create or replace function public.start_game(p_conversation uuid,p_type text,p_custom text default null)
returns public.games language plpgsql security definer set search_path='' as $$
declare result public.games; prompt text; a text; b text; pick integer;
  questions text[]:=array['What makes you feel most loved?','What is one tiny thing you miss about me?','Where would you steal a kiss from me?','What should our next date look like?','What is a dream you have not told me yet?','Which memory of us would you replay?','What is your favorite way to be comforted?','What is one thing you want us to do more often?','Describe our perfect lazy morning.','What was the moment you first felt a spark?','What would you whisper in my ear right now?','What is your favorite kind of surprise?'];
  options_a text[]:=array['A cozy night in','A surprise kiss','Sunrise together','A handwritten note','Cooking together','A spontaneous trip'];
  options_b text[]:=array['A night out dancing','A long hug','Stargazing together','A surprise date','Ordering our favorites','A perfectly planned trip'];
begin
  if not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id=p_conversation and kind='direct') or p_type is null or p_type not in ('question','either','tic_tac_toe') then raise exception 'Game unavailable.'; end if;
  perform 1 from public.conversations where id=p_conversation for update;
  select * into result from public.games where conversation_id=p_conversation and ended_at is null limit 1;
  if result.id is not null then return result; end if;
  if not exists(select 1 from public.conversations where id=p_conversation and couple_a and couple_b) then
    questions:=array['What is a skill you would love to learn?','What song is on repeat for you?','What is the funniest thing that happened this week?','Where would you go on a free plane ticket?','What is a small win you are proud of?','What always makes you laugh?','What is your most underrated favorite movie?','What should we try together next?'];
    options_a:=array['A cozy night in','Mountains','Sunrise','Texting','Cooking','A spontaneous trip'];
    options_b:=array['A night out','The beach','Stargazing','Voice notes','Ordering in','A planned trip'];
  end if;
  if p_custom is not null then
    if not private.is_pro() or p_type<>'question' or length(btrim(p_custom)) not between 1 and 250 then raise exception 'Custom question unavailable.'; end if;
    prompt:=btrim(p_custom);
  elsif p_type='question' then prompt:=questions[1+floor(random()*array_length(questions,1))::int];
  elsif p_type='either' then pick:=1+floor(random()*array_length(options_a,1))::int;prompt:='This or that?';a:=options_a[pick];b:=options_b[pick];
  else prompt:='Three in a row'; end if;
  insert into public.games(conversation_id,created_by,game_type,question,option_a,option_b,next_player)
  values(p_conversation,auth.uid(),p_type,prompt,a,b,auth.uid()) returning * into result;
  return result;
end;
$$;
create or replace function public.answer_game(p_id uuid,p_answer text)
returns void language plpgsql security definer set search_path='' as $$
declare g public.games;
begin
  select * into g from public.games where id=p_id for update;
  if g.id is null or not private.is_member(g.conversation_id) or g.game_type='tic_tac_toe' or g.ended_at is not null then raise exception 'Game unavailable.'; end if;
  if p_answer is null or length(btrim(p_answer)) not between 1 and 500 or (g.game_type='either' and p_answer not in (g.option_a,g.option_b)) then raise exception 'Choose an answer.'; end if;
  insert into private.game_answers(game_id,user_id,answer) values(p_id,auth.uid(),btrim(p_answer)) on conflict do nothing;
  if (select count(*) from private.game_answers where game_id=p_id)=2 then update public.games set ended_at=now() where id=p_id;
  else update public.games set question=question where id=p_id; end if;
end;
$$;
create or replace function public.game_answers(p_id uuid)
returns table(user_id uuid,answer text) language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.games where id=p_id and private.is_member(conversation_id)) then raise exception 'Game unavailable.'; end if;
  return query select a.user_id,a.answer from private.game_answers a where a.game_id=p_id and (a.user_id=auth.uid() or (select count(*) from private.game_answers where game_id=p_id)=2);
end;
$$;
create or replace function public.play_move(p_id uuid,p_cell integer)
returns public.games language plpgsql security definer set search_path='' as $$
declare g public.games; c public.conversations; mark text; line integer[]; win boolean:=false;
begin
  select * into g from public.games where id=p_id for update;
  if g.id is null or not private.is_member(g.conversation_id) or g.game_type<>'tic_tac_toe' or g.ended_at is not null or g.next_player<>auth.uid() or p_cell is null or p_cell not between 0 and 8 or substr(g.board,p_cell+1,1)<>'-' then raise exception 'Move unavailable.'; end if;
  select * into c from public.conversations where id=g.conversation_id;
  mark:=case when auth.uid()=g.created_by then 'X' else 'O' end;
  g.board:=overlay(g.board placing mark from p_cell+1 for 1);
  foreach line slice 1 in array array[[1,2,3],[4,5,6],[7,8,9],[1,4,7],[2,5,8],[3,6,9],[1,5,9],[3,5,7]] loop
    if substr(g.board,line[1],1)=mark and substr(g.board,line[2],1)=mark and substr(g.board,line[3],1)=mark then win:=true; end if;
  end loop;
  update public.games set board=g.board,next_player=case when c.member_a=auth.uid() then c.member_b else c.member_a end,
    winner=case when win then auth.uid() else null end,ended_at=case when win or position('-' in g.board)=0 then now() else null end
  where id=p_id returning * into g;
  return g;
end;
$$;
create or replace function public.couple_stats(p_conversation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare streak integer:=0; d date:=(now() at time zone 'UTC')::date; result jsonb; today date:=d;
begin
  if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if (select count(*) from private.activity_days where conversation_id=p_conversation and day=d)<2 then d:=d-1; end if;
  while (select count(*) from private.activity_days where conversation_id=p_conversation and day=d)>=2 loop streak:=streak+1;d:=d-1;end loop;
  result:=jsonb_build_object('streak',streak);
  if not private.is_pro() then return result; end if;
  return result || jsonb_build_object(
    'messages',(select coalesce(sum(messages),0) from private.activity_days where conversation_id=p_conversation),
    'media',(select coalesce(sum(media),0) from private.activity_days where conversation_id=p_conversation),
    'misses',(select coalesce(sum(misses),0) from private.activity_days where conversation_id=p_conversation),
    'mine',(select coalesce(sum(messages),0) from private.activity_days where conversation_id=p_conversation and user_id=auth.uid()),
    'goals',(select count(*) from public.goals where conversation_id=p_conversation and completed_a is not null and completed_b is not null),
    'games',(select count(*) from public.games where conversation_id=p_conversation and ended_at is not null),
    'days',(select jsonb_agg(jsonb_build_object('day',day,'count',total) order by day) from (
      select gs::date as day,coalesce((select sum(messages) from private.activity_days where conversation_id=p_conversation and day=gs::date),0) as total from generate_series(today-29,today,interval '1 day') gs
    ) daily),
    'shared_picks',(select coalesce(jsonb_agg(jsonb_build_object('question',g.question,'answer',a.answer)),'[]'::jsonb)
      from public.games g join private.game_answers a on a.game_id=g.id and a.user_id=auth.uid()
      join private.game_answers b on b.game_id=g.id and b.user_id<>auth.uid()
      where g.conversation_id=p_conversation and g.game_type='either' and a.answer=b.answer),
    'agreement',(select round(100.0*count(*) filter(where a.answer=b.answer)/nullif(count(*),0))
      from public.games g join private.game_answers a on a.game_id=g.id and a.user_id=auth.uid()
      join private.game_answers b on b.game_id=g.id and b.user_id<>auth.uid() where g.conversation_id=p_conversation and g.game_type='either')
  );
end;
$$;
alter table public.reactions enable row level security;
alter table public.games enable row level security;
revoke all on public.reactions,public.games from public,anon,authenticated;
grant select,insert,update(emoji),delete on public.reactions to authenticated;
grant select on public.games to authenticated;
grant all on public.reactions,public.games to service_role;
drop policy if exists bitchat_reaction_read on public.reactions;
create policy bitchat_reaction_read on public.reactions for select to authenticated using(exists(select 1 from public.messages where id=message_id));
drop policy if exists bitchat_reaction_insert on public.reactions;
create policy bitchat_reaction_insert on public.reactions for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.messages where id=message_id));
drop policy if exists bitchat_reaction_update on public.reactions;
create policy bitchat_reaction_update on public.reactions for update to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.messages where id=message_id)) with check(user_id=(select auth.uid()) and exists(select 1 from public.messages where id=message_id));
drop policy if exists bitchat_reaction_delete on public.reactions;
create policy bitchat_reaction_delete on public.reactions for delete to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.messages where id=message_id));
drop policy if exists bitchat_game_read on public.games;
create policy bitchat_game_read on public.games for select to authenticated using(private.is_member(conversation_id));
revoke all on function public.mark_read(uuid),public.deleted_history(uuid,timestamptz,uuid),public.start_game(uuid,text,text),public.answer_game(uuid,text),public.game_answers(uuid),public.play_move(uuid,integer),public.couple_stats(uuid) from public,anon;
grant execute on function public.mark_read(uuid),public.deleted_history(uuid,timestamptz,uuid),public.start_game(uuid,text,text),public.answer_game(uuid,text),public.game_answers(uuid),public.play_move(uuid,integer),public.couple_stats(uuid) to authenticated;
-- Friend search, groups and shared activities.
create extension if not exists pg_trgm with schema extensions;
create index if not exists profiles_username_prefix on public.profiles(username text_pattern_ops);
create index if not exists profiles_display_search on public.profiles using gin(lower(display_name) extensions.gin_trgm_ops);
create index if not exists profiles_username_search on public.profiles using gin(username extensions.gin_trgm_ops);
create index if not exists messages_text_search on public.messages using gin(content extensions.gin_trgm_ops);
create table if not exists private.blocks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  other_id uuid not null references public.profiles(id) on delete cascade,
  primary key(user_id,other_id),check(user_id<>other_id)
);
create index if not exists blocks_other on private.blocks(other_id,user_id);
create or replace function private.blocked(p_a uuid,p_b uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.blocks where (user_id=p_a and other_id=p_b) or (user_id=p_b and other_id=p_a));
$$;
create or replace function public.find_profiles(p_query text)
returns table(id uuid,username text,display_name text,avatar_url text)
language sql stable security definer set search_path='' as $$
  with q as (select lower(left(btrim(p_query),40)) as term), pattern as
    (select term,replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_') as escaped from q)
  select p.id,p.username,p.display_name,p.avatar_url from public.profiles p cross join pattern q
  where auth.uid() is not null and p.id<>auth.uid() and length(q.term) between 2 and 40
    and not private.blocked(auth.uid(),p.id) and
    (p.username like q.escaped||'%' escape '\' or lower(p.display_name) like q.escaped||'%' escape '\'
      or (length(q.term)>=3 and (p.username like '%'||q.escaped||'%' escape '\' or lower(p.display_name) like '%'||q.escaped||'%' escape '\')))
  order by (p.username=q.term) desc,(p.username like q.escaped||'%' escape '\') desc,p.username limit 24;
$$;
create or replace function public.search_messages(p_conversation uuid,p_query text,p_before timestamptz default null,p_before_id uuid default null)
returns setof public.messages language plpgsql stable security definer set search_path='' as $$
declare term text:=replace(replace(replace(btrim(p_query),'\','\\'),'%','\%'),'_','\_');
begin
  if not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if p_query is null or length(btrim(p_query)) not between 2 and 100 then return; end if;
  return query select m.* from public.messages m where m.conversation_id=p_conversation and m.kind<>'instant'
    and m.content ilike '%'||term||'%' escape '\' and (p_before is null or (m.created_at,m.id)<(p_before,p_before_id))
    order by m.created_at desc,m.id desc limit 30;
end;
$$;
create or replace function public.create_group(p_title text,p_members uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; members uuid[]; me uuid:=auth.uid();
begin
  if me is null or p_title is null or length(btrim(p_title)) not between 1 and 60 then raise exception 'Add a group name.'; end if;
  select array_agg(distinct u) into members from unnest(array_append(p_members,me)) u;
  if cardinality(members) not between 3 and 16 or exists(select 1 from unnest(members) u where u is null or not exists(select 1 from public.profiles where id=u) or private.blocked(me,u)) then raise exception 'Choose 2 to 15 friends.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text,0));
  if (select count(*) from public.conversations where created_by=me and created_at>now()-interval '1 hour')>=10 then raise exception 'Please try again later.'; end if;
  insert into public.conversations(kind,title,created_by) values('group',btrim(p_title),me) returning id into result;
  insert into public.conversation_members(conversation_id,user_id) select result,unnest(members);
  return result;
end;
$$;
create or replace function public.set_couple_mode(p_conversation uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id=p_conversation and kind='direct') then raise exception 'Conversation unavailable.'; end if;
  update public.conversations set couple_a=case when member_a=auth.uid() then coalesce(p_enabled,false) else couple_a end,
    couple_b=case when member_b=auth.uid() then coalesce(p_enabled,false) else couple_b end where id=p_conversation;
end;
$$;
create or replace function public.set_block(p_other uuid,p_blocked boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or p_other=auth.uid() then raise exception 'Person unavailable.'; end if;
  if p_blocked then insert into private.blocks(user_id,other_id) values(auth.uid(),p_other) on conflict do nothing;
  else delete from private.blocks where user_id=auth.uid() and other_id=p_other; end if;
end;
$$;
create or replace function public.my_blocks()
returns table(other_id uuid) language sql stable security definer set search_path='' as $$
  select other_id from private.blocks where user_id=auth.uid();
$$;
create or replace function private.guard_contact()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.conversations c where c.id=new.conversation_id and c.kind='direct' and private.blocked(c.member_a,c.member_b)) then raise exception 'Messaging is unavailable for this conversation.'; end if;
  return new;
end;
$$;
drop trigger if exists bitchat_contact_guard on public.messages;
create trigger bitchat_contact_guard before insert on public.messages for each row execute function private.guard_contact();
create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question text not null check(length(btrim(question)) between 1 and 200),
  options text[] not null check(cardinality(options) between 2 and 4),
  created_at timestamptz not null default now(),closes_at timestamptz not null default now()+interval '24 hours'
);
create index if not exists polls_cursor on public.polls(conversation_id,created_at desc,id desc);
create index if not exists polls_user on public.polls(user_id);
create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  choice integer not null check(choice between 0 and 3),primary key(poll_id,user_id)
);
create index if not exists poll_votes_user on public.poll_votes(user_id);
create or replace function public.create_poll(p_id uuid,p_conversation uuid,p_question text,p_options text[])
returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not private.is_member(p_conversation) or exists(select 1 from public.conversations c where c.id=p_conversation and c.kind='direct' and private.blocked(c.member_a,c.member_b)) then raise exception 'Conversation unavailable.'; end if;
  if exists(select 1 from public.polls where id=p_id and user_id=auth.uid() and conversation_id=p_conversation) then return p_id; end if;
  if p_question is null or length(btrim(p_question)) not between 1 and 200 or p_options is null or cardinality(p_options) not between 2 and 4 or exists(select 1 from unnest(p_options) o where o is null or length(btrim(o)) not between 1 and 80) then raise exception 'Add a question and 2 to 4 answers.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
  if (select count(*) from public.polls where user_id=auth.uid() and created_at>now()-interval '1 hour')>=20 then raise exception 'Please try again later.'; end if;
  insert into public.polls(id,conversation_id,user_id,question,options) values(p_id,p_conversation,auth.uid(),btrim(p_question),p_options);
  update public.conversations set last_activity=now() where id=p_conversation;
  return p_id;
end;
$$;
create or replace function public.vote_poll(p_poll uuid,p_choice integer)
returns void language plpgsql security definer set search_path='' as $$
declare p public.polls;
begin
  select * into p from public.polls where id=p_poll for share;
  if p.id is null or not private.is_member(p.conversation_id) or p.closes_at<=now() or p_choice is null or p_choice<0 or p_choice>=cardinality(p.options) then raise exception 'Vote unavailable.'; end if;
  insert into public.poll_votes(poll_id,user_id,choice) values(p_poll,auth.uid(),p_choice) on conflict(poll_id,user_id) do update set choice=excluded.choice;
end;
$$;
alter table public.conversation_members enable row level security;
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
revoke all on public.conversation_members,public.polls,public.poll_votes from public,anon,authenticated;
grant select on public.conversation_members,public.polls,public.poll_votes to authenticated;
grant all on public.conversation_members,public.polls,public.poll_votes to service_role;
drop policy if exists bitchat_member_read on public.conversation_members;
create policy bitchat_member_read on public.conversation_members for select to authenticated using(private.is_member(conversation_id));
drop policy if exists bitchat_poll_read on public.polls;
create policy bitchat_poll_read on public.polls for select to authenticated using(private.is_member(conversation_id));
drop policy if exists bitchat_poll_vote_read on public.poll_votes;
create policy bitchat_poll_vote_read on public.poll_votes for select to authenticated using(exists(select 1 from public.polls p where p.id=poll_id));
revoke all on function public.search_messages(uuid,text,timestamptz,uuid),public.create_group(text,uuid[]),public.set_couple_mode(uuid,boolean),public.set_block(uuid,boolean),public.my_blocks(),public.create_poll(uuid,uuid,text,text[]),public.vote_poll(uuid,integer) from public,anon;
grant execute on function public.search_messages(uuid,text,timestamptz,uuid),public.create_group(text,uuid[]),public.set_couple_mode(uuid,boolean),public.set_block(uuid,boolean),public.my_blocks(),public.create_poll(uuid,uuid,text,text[]),public.vote_poll(uuid,integer) to authenticated;
-- Backfill aggregate counts exactly once; never read bodies into the application.
do $$ begin
  if current_setting('bitchat.legacy_migration',true)='yes' then
    insert into private.activity_days(conversation_id,user_id,day,messages)
      select conversation_id,user_id,(created_at at time zone 'UTC')::date,count(*) from public.messages group by 1,2,3 on conflict do nothing;
  end if;
end $$;
-- A private Realtime room permits typing/presence only for its conversation members.
do $$ begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists bitchat_presence_read on realtime.messages';
    execute 'create policy bitchat_presence_read on realtime.messages for select to authenticated using(extension in (''broadcast'',''presence'') and topic ~ ''^room:[0-9a-f-]{36}$'' and private.is_member(case when topic ~ ''^room:[0-9a-f-]{36}$'' then substring(topic from 6)::uuid else null end))';
    execute 'drop policy if exists bitchat_presence_write on realtime.messages';
    execute 'create policy bitchat_presence_write on realtime.messages for insert to authenticated with check(extension in (''broadcast'',''presence'') and topic ~ ''^room:[0-9a-f-]{36}$'' and private.is_member(case when topic ~ ''^room:[0-9a-f-]{36}$'' then substring(topic from 6)::uuid else null end))';
  end if;
end $$;
-- Retire the unused, empty custom-password schema from public API access.
-- Existing Supabase Auth profiles and group membership are unaffected.
do $$ declare t text; rows bigint; begin
  foreach t in array array['users','channels','channel_members'] loop
    if to_regclass('public.'||t) is not null then
      execute format('select count(*) from public.%I',t) into rows;
      if rows=0 then
        execute format('alter table public.%I enable row level security',t);
        execute format('revoke all on public.%I from public,anon,authenticated',t);
      end if;
    end if;
  end loop;
end $$;
-- Private tables also have RLS as a second boundary; their definer functions own access.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='private' loop execute format('alter table private.%I enable row level security',t.tablename); end loop;
end $$;
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on function public.handle_new_user() from public,anon,authenticated;
revoke all on function public.find_profiles(text),public.open_conversation(uuid),public.unlock_pro(text),public.create_capsule(uuid,uuid,text,text,timestamptz),public.open_capsule(uuid),public.send_instant(uuid,uuid,text,text),public.ensure_goal(uuid),public.complete_goal(uuid) from public,anon;
grant execute on function public.find_profiles(text),public.open_conversation(uuid),public.unlock_pro(text),public.create_capsule(uuid,uuid,text,text,timestamptz),public.open_capsule(uuid),public.send_instant(uuid,uuid,text,text),public.ensure_goal(uuid),public.complete_goal(uuid) to authenticated;
revoke all on function public.claim_instant(uuid,uuid),public.get_media_cleanup_batch(),public.finish_media_cleanup(text,text[],text),public.delete_expired_media() from public,anon,authenticated;
grant execute on function public.claim_instant(uuid,uuid),public.get_media_cleanup_batch(),public.finish_media_cleanup(text,text[],text) to service_role;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_member(uuid),private.is_pro(),private.can_see_profile(uuid),private.can_read_media(text,text),private.can_upload(text,boolean) to authenticated;

-- INSERT / UPDATE are authorized by RLS. DELETE sends only opaque primary keys.
alter table public.messages replica identity default;
do $$ declare t text; begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if;
  foreach t in array array['profiles','conversations','conversation_members','messages','capsules','goals','games','reactions','polls','poll_votes'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;


