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
insert into private.pro_config(id,password_hash) values(true,extensions.crypt(extensions.gen_random_uuid()::text,extensions.gen_salt('bf',12))) on conflict(id) do nothing;
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


begin; create index if not exists capsules_user on public.capsules(user_id); create index if not exists channel_members_user on public.channel_members(user_id); create index if not exists channels_creator on public.channels(created_by); create index if not exists groups_creator on public.groups(created_by); drop index if exists public.messages_owner; commit;
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

-- Version 2.4: member message actions and scoped reactions.
-- Existing messages are preserved. Ownership and conversation membership remain mandatory.
drop policy if exists bitchat_message_edit on public.messages;
create policy bitchat_message_edit on public.messages for update to authenticated
using (user_id=(select auth.uid()) and private.is_member(conversation_id))
with check (user_id=(select auth.uid()) and private.is_member(conversation_id));
drop policy if exists bitchat_message_delete on public.messages;
create policy bitchat_message_delete on public.messages for delete to authenticated
using (user_id=(select auth.uid()) and private.is_member(conversation_id));

create or replace function private.archive_deleted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.message_tombstones(id) values(old.id) on conflict do nothing;
  if auth.uid()=old.user_id and private.is_member(old.conversation_id) and old.kind<>'instant' then
    insert into private.deleted_messages(message_id,conversation_id,user_id,username,content,kind,created_at,media_url,media_kind)
    values(old.id,old.conversation_id,old.user_id,(select username from public.profiles where id=old.user_id),old.content,old.kind,old.created_at,old.media_url,old.media_kind)
    on conflict do nothing;
  end if;
  return old;
end;
$$;

alter table public.reactions add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
update public.reactions r set conversation_id=m.conversation_id from public.messages m where m.id=r.message_id and r.conversation_id is null;
alter table public.reactions alter column conversation_id set not null;
create index if not exists reactions_conversation_message on public.reactions(conversation_id,message_id);
alter table public.reactions drop constraint if exists reactions_emoji_check;
alter table public.reactions add constraint reactions_emoji_check check
  (emoji=any(array['❤️','😂','🥺','🔥','😘','🫶','👍','👎','😍','🥹','😮','😢','😡','🤍','💯','🎉','✨','👀','🙈','🤗','😈','💋','💕','💀','🥰','😻','🫂','🌹','🍓','🧸','🍪','🌙','🌸','💌','💘','💞','🫦','😽','🎀','💓']));

create or replace function private.reaction_conversation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  select m.conversation_id into new.conversation_id from public.messages m where m.id=new.message_id;
  if new.conversation_id is null then raise exception 'Message unavailable' using errcode='42501'; end if;
  return new;
end;
$$;
drop trigger if exists bitchat_reaction_conversation on public.reactions;
create trigger bitchat_reaction_conversation before insert or update on public.reactions
for each row execute function private.reaction_conversation();
revoke all on function private.reaction_conversation() from public,anon,authenticated;

-- Idempotent desired state, with the author derived from the authenticated session.
-- Explicit UPDATE(emoji) works with the existing narrow column grant.
create or replace function public.set_reaction(p_message uuid,p_emoji text default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.messages where id=p_message) then
    raise exception 'Message unavailable' using errcode='42501';
  end if;
  if p_emoji is null then
    delete from public.reactions where message_id=p_message and user_id=auth.uid();
  else
    insert into public.reactions(message_id,user_id,emoji) values(p_message,auth.uid(),p_emoji)
    on conflict(message_id,user_id) do update set emoji=excluded.emoji;
  end if;
end;
$$;
revoke all on function public.set_reaction(uuid,text) from public,anon;
grant execute on function public.set_reaction(uuid,text) to authenticated;

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


-- Private Web Push devices and a bounded, coalescing delivery queue.
-- Browser keys are public encryption keys; VAPID signing keys stay inside Vault.
begin;
create table private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check(length(endpoint) <= 2048),
  p256dh text not null,
  auth_secret text not null,
  updated_at timestamptz not null default clock_timestamp()
);
create index push_subscriptions_user on private.push_subscriptions(user_id);
create table private.push_jobs (
  subscription_id uuid not null references private.push_subscriptions(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  next_attempt timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  lease uuid,
  lease_until timestamptz,
  primary key(subscription_id, conversation_id)
);
create index push_jobs_due on private.push_jobs(next_attempt);
create index push_jobs_conversation on private.push_jobs(conversation_id);
create index push_jobs_message on private.push_jobs(message_id);
create table private.push_dispatch (
  id boolean primary key default true check(id),
  last_wake timestamptz not null default '-infinity'
);
insert into private.push_dispatch(id) values(true);
alter table private.push_subscriptions enable row level security;
alter table private.push_jobs enable row level security;
alter table private.push_dispatch enable row level security;
revoke all on private.push_subscriptions, private.push_jobs, private.push_dispatch from public, anon, authenticated, service_role;

create function private.push_endpoint_valid(p_endpoint text)
returns boolean language sql immutable set search_path = '' as $$
  select p_endpoint is not null and length(p_endpoint) between 20 and 2048
    and p_endpoint ~ '^https://(fcm[.]googleapis[.]com|([a-z0-9-]+[.])*push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|([a-z0-9-]+[.])+notify[.]windows[.]com)/[A-Za-z0-9_/?=&%+.:~-]+$';
$$;
revoke all on function private.push_endpoint_valid(text) from public, anon, authenticated;

create function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); existing private.push_subscriptions;
begin
  if me is null or not private.push_endpoint_valid(p_endpoint)
    or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$'
    or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$'
    or get_byte(decode(translate(p_p256dh, '-_', '+/') || '=', 'base64'), 0) <> 4
    then raise exception 'Notification subscription unavailable.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text, 27));
  delete from private.push_subscriptions where user_id = me and updated_at < now() - interval '180 days';
  select * into existing from private.push_subscriptions where endpoint = p_endpoint for update;
  if existing.id is not null and existing.user_id <> me then
    raise exception 'This device needs a new notification subscription.' using errcode = '42501';
  end if;
  if existing.id is null and (select count(*) from private.push_subscriptions where user_id = me) >= 10 then
    raise exception 'Notification device limit reached.'; end if;
  insert into private.push_subscriptions(user_id, endpoint, p256dh, auth_secret)
  values(me, p_endpoint, p_p256dh, p_auth)
  on conflict(endpoint) do update set p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, updated_at = clock_timestamp()
  where push_subscriptions.user_id = me;
end;
$$;
create function public.unregister_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from private.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
create function public.push_public_key()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'bitchat_push_public_key' and auth.uid() is not null;
$$;
revoke all on function public.register_push_subscription(text,text,text), public.unregister_push_subscription(text), public.push_public_key() from public, anon;
grant execute on function public.register_push_subscription(text,text,text), public.unregister_push_subscription(text), public.push_public_key() to authenticated;

do $$ begin
  if not exists(select 1 from vault.secrets where name = 'bitchat_push_worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'bitchat_push_worker_secret');
  end if;
end $$;
create function private.push_authorized(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select length(p_secret) = 64 and exists(select 1 from vault.decrypted_secrets where name = 'bitchat_push_worker_secret' and decrypted_secret = p_secret);
$$;
create function public.push_server_config(p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.push_authorized(p_secret), false) then return null; end if;
  return jsonb_build_object(
    'publicKey', (select decrypted_secret from vault.decrypted_secrets where name = 'bitchat_push_public_key'),
    'privateKey', (select decrypted_secret from vault.decrypted_secrets where name = 'bitchat_push_private_key'),
    'subject', 'https://bitchwyat.vercel.app');
end;
$$;
create function public.store_push_vapid(p_secret text, p_public text, p_private text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.push_authorized(p_secret), false) then return null; end if;
  if p_public is null or p_public !~ '^[A-Za-z0-9_-]{87}$' or p_private is null or p_private !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'Invalid VAPID keys.'; end if;
  perform pg_advisory_xact_lock(1162, 27);
  if not exists(select 1 from vault.secrets where name = 'bitchat_push_public_key') then
    perform vault.create_secret(p_public, 'bitchat_push_public_key');
    perform vault.create_secret(p_private, 'bitchat_push_private_key');
  end if;
  return public.push_server_config(p_secret);
end;
$$;

create function private.push_eligible(p_user uuid, p_conversation uuid, p_message uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
    left join public.chat_preferences cp on cp.user_id = p_user and cp.conversation_id = c.id
    left join private.read_markers r on r.user_id = p_user and r.conversation_id = c.id
    where m.id = p_message and c.id = p_conversation and m.user_id <> p_user
      and m.created_at > now() - interval '1 hour'
      and m.created_at > coalesce(cp.cleared_before, '-infinity')
      and m.created_at > coalesce(r.seen_at, '-infinity')
      and not coalesce(cp.archived, false) and not private.blocked(p_user, m.user_id)
      and ((c.kind = 'direct' and p_user in (c.member_a, c.member_b)) or
        (c.kind = 'group' and exists(select 1 from public.conversation_members cm
          where cm.user_id = p_user and cm.conversation_id = c.id and cm.joined_at <= m.created_at)))
  );
$$;

create function private.wake_push_worker(p_force boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare project_url text; worker_secret text; request_id bigint;
begin
  -- At most ten immediate wake-ups per second; Cron retries undelivered jobs.
  if not p_force and not exists(select 1 from private.push_jobs) then return null; end if;
  if p_force and not exists(select 1 from private.push_jobs) and exists(select 1 from vault.secrets where name = 'bitchat_push_public_key') then return null; end if;
  update private.push_dispatch set last_wake = clock_timestamp()
    where id and (p_force or last_wake < clock_timestamp() - interval '100 milliseconds');
  if not found then return null; end if;
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'bitchat_project_url';
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name = 'bitchat_push_worker_secret';
  if project_url is null or worker_secret is null then return null; end if;
  select net.http_post(url := project_url || '/functions/v1/push-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', worker_secret),
    body := '{}'::jsonb, timeout_milliseconds := 10000) into request_id;
  return request_id;
end;
$$;
create function private.enqueue_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.push_jobs(subscription_id, conversation_id, message_id)
  select s.id, new.conversation_id, new.id from private.push_subscriptions s join (
    select c.member_a as user_id from public.conversations c where c.id = new.conversation_id and c.kind = 'direct'
    union select c.member_b from public.conversations c where c.id = new.conversation_id and c.kind = 'direct'
    union select cm.user_id from public.conversation_members cm where cm.conversation_id = new.conversation_id
  ) recipients on recipients.user_id = s.user_id
  where s.user_id <> new.user_id and s.updated_at > now() - interval '180 days'
    and private.push_eligible(s.user_id, new.conversation_id, new.id)
  on conflict(subscription_id, conversation_id) do update set
    message_id = excluded.message_id, created_at = clock_timestamp(), next_attempt = clock_timestamp(), attempts = 0, lease = null, lease_until = null;
  if found then
    -- A delivery failure must never roll back a successful chat message.
    begin perform private.wake_push_worker(); exception when others then null; end;
  end if;
  return new;
end;
$$;
create trigger bitchat_enqueue_push after insert on public.messages for each row execute function private.enqueue_push();

create function public.claim_push_jobs(p_secret text)
returns table(subscription_id uuid, conversation_id uuid, message_id uuid, user_id uuid, endpoint text, p256dh text, auth_secret text, lease uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.push_authorized(p_secret), false) then raise exception 'Unauthorized.' using errcode = '42501'; end if;
  delete from private.push_subscriptions where updated_at < now() - interval '180 days';
  delete from private.push_jobs j using private.push_subscriptions s
    where s.id = j.subscription_id and (j.created_at < now() - interval '1 hour' or j.attempts >= 4 or not private.push_eligible(s.user_id, j.conversation_id, j.message_id));
  return query with due as (
    select j.subscription_id, j.conversation_id from private.push_jobs j
    where j.next_attempt <= clock_timestamp() and (j.lease_until is null or j.lease_until < clock_timestamp())
    order by j.next_attempt limit 40 for update skip locked
  ), claimed as (
    update private.push_jobs j set attempts = j.attempts + 1, lease = gen_random_uuid(), lease_until = clock_timestamp() + interval '90 seconds'
    from due d where j.subscription_id = d.subscription_id and j.conversation_id = d.conversation_id
    returning j.*
  ) select j.subscription_id, j.conversation_id, j.message_id, s.user_id, s.endpoint, s.p256dh, s.auth_secret, j.lease
    from claimed j join private.push_subscriptions s on s.id = j.subscription_id;
end;
$$;
create function public.finish_push_job(p_secret text, p_subscription uuid, p_conversation uuid, p_message uuid, p_lease uuid, p_status integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.push_authorized(p_secret), false) then raise exception 'Unauthorized.' using errcode = '42501'; end if;
  if p_status in (404, 410) then
    delete from private.push_subscriptions s where s.id = p_subscription and exists(
      select 1 from private.push_jobs j where j.subscription_id = s.id and j.conversation_id = p_conversation and j.message_id = p_message and j.lease = p_lease);
  elsif p_status between 200 and 299 or p_status in (400, 401, 403, 413) then
    delete from private.push_jobs j where j.subscription_id = p_subscription and j.conversation_id = p_conversation and j.message_id = p_message and j.lease = p_lease;
  else
    update private.push_jobs j set lease = null, lease_until = null, next_attempt = clock_timestamp() + (power(2, j.attempts) * interval '15 seconds')
      where j.subscription_id = p_subscription and j.conversation_id = p_conversation and j.message_id = p_message and j.lease = p_lease;
  end if;
end;
$$;
revoke all on function private.push_authorized(text), private.push_eligible(uuid,uuid,uuid), private.wake_push_worker(boolean), private.enqueue_push() from public, anon, authenticated, service_role;
revoke all on function public.push_server_config(text), public.store_push_vapid(text,text,text), public.claim_push_jobs(text), public.finish_push_job(text,uuid,uuid,uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.push_server_config(text), public.store_push_vapid(text,text,text), public.claim_push_jobs(text), public.finish_push_job(text,uuid,uuid,uuid,uuid,integer) to service_role;
select cron.schedule('bitchat-push-retry', '* * * * *', 'select private.wake_push_worker(true);');

-- ---------------------------------------------------------------------------
-- 2.12 Calling, pinned messages and ringing-call push.
-- Mirrors supabase/migrations/20261123120000_calls_pins_native.sql.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 1. Pinned messages. One row per pinned message; capped per conversation.
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_pins (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(conversation_id, message_id)
);
create index if not exists conversation_pins_recent on public.conversation_pins(conversation_id, created_at desc);
alter table public.conversation_pins enable row level security;
revoke all on public.conversation_pins from public, anon, authenticated;
grant select on public.conversation_pins to authenticated;
grant all on public.conversation_pins to service_role;
drop policy if exists bitchat_pins_read on public.conversation_pins;
create policy bitchat_pins_read on public.conversation_pins for select to authenticated
  using(private.is_member(conversation_id));

create or replace function public.pin_message(p_message uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); row public.messages; conversation uuid; total integer;
begin
  select * into row from public.messages where id = p_message;
  if row.id is null or me is null or not private.is_member(row.conversation_id) then
    raise exception 'Message unavailable.';
  end if;
  conversation := row.conversation_id;
  if row.kind not in ('message','sticker','miss') then raise exception 'This message cannot be pinned.'; end if;
  select count(*) into total from public.conversation_pins where conversation_id = conversation;
  if total >= 25 and not exists(select 1 from public.conversation_pins where conversation_id = conversation and message_id = p_message) then
    raise exception 'Unpin something first — 25 pins is the limit.';
  end if;
  insert into public.conversation_pins(conversation_id, message_id, pinned_by)
  values(conversation, p_message, me)
  on conflict(conversation_id, message_id) do update set pinned_by = excluded.pinned_by, created_at = now();
  perform realtime.send(jsonb_build_object('conversation_id', conversation, 'message_id', p_message, 'pinned', true), 'pins', 'room:'||conversation::text, true);
  return jsonb_build_object('ok', true, 'message_id', p_message);
end;
$$;

create or replace function public.unpin_message(p_message uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); conversation uuid;
begin
  select conversation_id into conversation from public.messages where id = p_message;
  if conversation is null or me is null or not private.is_member(conversation) then
    raise exception 'Message unavailable.';
  end if;
  delete from public.conversation_pins where conversation_id = conversation and message_id = p_message;
  perform realtime.send(jsonb_build_object('conversation_id', conversation, 'message_id', p_message, 'pinned', false), 'pins', 'room:'||conversation::text, true);
  return jsonb_build_object('ok', true, 'message_id', p_message);
end;
$$;

-- One round trip for the pin tray: newest 25 pins with their message bodies.
create or replace function public.conversation_pins_list(p_conversation uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(item order by pinned_at desc), '[]'::jsonb) from (
    select p.created_at pinned_at, jsonb_build_object(
      'message_id', m.id,
      'user_id', m.user_id,
      'content', m.content,
      'media_url', m.media_url,
      'media_kind', m.media_kind,
      'kind', m.kind,
      'created_at', m.created_at,
      'pinned_by', p.pinned_by,
      'pinned_at', p.created_at,
      'author', (select jsonb_build_object('id', pr.id, 'username', pr.username, 'display_name', pr.display_name, 'avatar_url', pr.avatar_url)
                 from public.profiles pr where pr.id = m.user_id)
    ) as item
    from public.conversation_pins p
    join public.messages m on m.id = p.message_id
    where p.conversation_id = p_conversation and private.is_member(p_conversation)
    order by p.created_at desc
    limit 25
  ) rows;
$$;

revoke all on function public.pin_message(uuid), public.unpin_message(uuid), public.conversation_pins_list(uuid) from public, anon;
grant execute on function public.pin_message(uuid), public.unpin_message(uuid), public.conversation_pins_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Calls. State lives here; SDP/ICE travel over a private broadcast topic.
-- ---------------------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller uuid not null references public.profiles(id) on delete cascade,
  callee uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('audio','video')),
  status text not null default 'ringing' check (status in ('ringing','active','declined','missed','ended','failed')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null
);
create index if not exists calls_conversation on public.calls(conversation_id, started_at desc);
create index if not exists calls_callee_ringing on public.calls(callee, started_at desc) where status = 'ringing';
alter table public.calls enable row level security;
revoke all on public.calls from public, anon, authenticated;
grant select on public.calls to authenticated;
grant all on public.calls to service_role;
drop policy if exists bitchat_calls_read on public.calls;
create policy bitchat_calls_read on public.calls for select to authenticated
  using(caller = (select auth.uid()) or callee = (select auth.uid()) or private.is_member(conversation_id));
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls') then
    alter publication supabase_realtime add table public.calls;
  end if;
end $$;

create or replace function public.start_call(p_conversation uuid, p_kind text default 'audio')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); c public.conversations; other uuid; created public.calls;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if p_kind is null or p_kind not in ('audio','video') then raise exception 'Choose a call type.'; end if;
  select * into c from public.conversations where id = p_conversation;
  if c.id is null or c.kind <> 'direct' then raise exception 'Calls are for one-to-one chats.'; end if;
  other := case when c.member_a = me then c.member_b else c.member_a end;
  if other is null then raise exception 'Conversation unavailable.'; end if;
  -- Anything still ringing for more than 90 seconds is a missed call.
  update public.calls set status = 'missed', ended_at = now()
   where conversation_id = p_conversation and status = 'ringing' and started_at < now() - interval '90 seconds';
  if exists(select 1 from public.calls where conversation_id = p_conversation and status in ('ringing','active')) then
    raise exception 'A call is already in progress here.';
  end if;
  insert into public.calls(conversation_id, caller, callee, kind)
  values(p_conversation, me, other, p_kind)
  returning * into created;
  perform realtime.send(
    jsonb_build_object('call_id', created.id, 'conversation_id', p_conversation, 'caller', me, 'callee', other, 'kind', p_kind, 'status', 'ringing', 'started_at', created.started_at),
    'call', 'call:'||p_conversation::text, true);
  return to_jsonb(created);
end;
$$;

create or replace function public.answer_call(p_call uuid, p_accept boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); row public.calls;
begin
  select * into row from public.calls where id = p_call for update;
  if row.id is null or me is null or row.callee <> me then raise exception 'Call unavailable.'; end if;
  if row.status <> 'ringing' then raise exception 'This call already ended.'; end if;
  if row.started_at < now() - interval '90 seconds' then
    update public.calls set status = 'missed', ended_at = now() where id = p_call;
    raise exception 'This call already ended.';
  end if;
  if coalesce(p_accept, true) then
    update public.calls set status = 'active', answered_at = now() where id = p_call returning * into row;
  else
    update public.calls set status = 'declined', ended_at = now(), ended_by = me where id = p_call returning * into row;
  end if;
  perform realtime.send(jsonb_build_object('call_id', row.id, 'conversation_id', row.conversation_id, 'status', row.status, 'by', me), 'call', 'call:'||row.conversation_id::text, true);
  return to_jsonb(row);
end;
$$;

create or replace function public.end_call(p_call uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); row public.calls; final text;
begin
  select * into row from public.calls where id = p_call for update;
  if row.id is null or me is null or me not in (row.caller, row.callee) then raise exception 'Call unavailable.'; end if;
  if row.status in ('ended','declined','missed','failed') then return to_jsonb(row); end if;
  final := case when row.status = 'ringing' then 'missed' else 'ended' end;
  update public.calls set status = final, ended_at = now(), ended_by = me where id = p_call returning * into row;
  perform realtime.send(jsonb_build_object('call_id', row.id, 'conversation_id', row.conversation_id, 'status', final, 'by', me), 'call', 'call:'||row.conversation_id::text, true);
  return to_jsonb(row);
end;
$$;

-- SDP and ICE candidates are relayed server-side so clients cannot spoof a peer.
create or replace function public.call_signal(p_call uuid, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); row public.calls;
begin
  select * into row from public.calls where id = p_call;
  if row.id is null or me is null or me not in (row.caller, row.callee) then raise exception 'Call unavailable.'; end if;
  if row.status not in ('ringing','active') then return false; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 16000 then
    raise exception 'Call signal too large.';
  end if;
  perform realtime.send(p_payload, 'signal', 'call:'||row.conversation_id::text, true);
  return true;
end;
$$;

create or replace function public.call_history(p_conversation uuid, p_limit integer default 40)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.started_at desc), '[]'::jsonb) from (
    select id, conversation_id, caller, callee, kind, status, started_at, answered_at, ended_at,
           greatest(0, coalesce(extract(epoch from (coalesce(ended_at, now()) - coalesce(answered_at, started_at))), 0))::integer as seconds
    from public.calls
    where conversation_id = p_conversation and private.is_member(p_conversation)
    order by started_at desc
    limit least(greatest(coalesce(p_limit, 40), 1), 100)
  ) c;
$$;

revoke all on function public.start_call(uuid,text), public.answer_call(uuid,boolean), public.end_call(uuid), public.call_signal(uuid,jsonb), public.call_history(uuid,integer) from public, anon;
grant execute on function public.start_call(uuid,text), public.answer_call(uuid,boolean), public.end_call(uuid), public.call_signal(uuid,jsonb), public.call_history(uuid,integer) to authenticated;

-- Private broadcast topics for call signaling. The restrictive write gate in
-- schema.sql only covers room: topics, and clients never insert here: every
-- frame is relayed by call_signal(). Reads must be allowed for members.
drop policy if exists bitchat_call_read on realtime.messages;
create policy bitchat_call_read on realtime.messages for select to authenticated using(
  extension = 'broadcast' and topic ~ '^call:[0-9a-f-]{36}$'
  and private.is_member(case when topic ~ '^call:[0-9a-f-]{36}$' then substring(topic from 6)::uuid else null end));

-- ---------------------------------------------------------------------------
-- 3. Ringing calls wake the partner's phone.
-- ---------------------------------------------------------------------------
-- Calls reuse the chat push queue: same worker secret, VAPID keys and delivery
-- function, with a `kind` flag so the worker sends a ringing payload instead of
-- a new-message one. Ringing jobs expire after 45 seconds.
-- One job row per ringing call, flagged so the worker builds a call payload.
alter table private.push_jobs alter column message_id drop not null;
alter table private.push_jobs add column if not exists call_id uuid references public.calls(id) on delete cascade;
alter table private.push_jobs add column if not exists kind text not null default 'message';
-- Subscriptions are per endpoint and kind so a phone can opt out of chat pushes
-- while still ringing for calls, or the other way round.
alter table private.push_subscriptions add column if not exists kind text not null default 'message';
create unique index if not exists push_subscriptions_endpoint_kind on private.push_subscriptions(user_id, endpoint, kind);

create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_kind text default 'message')
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); existing private.push_subscriptions; wanted text := case when p_kind = 'call' then 'call' else 'message' end;
begin
  if me is null or not private.push_endpoint_valid(p_endpoint)
    or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$'
    or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$'
    or get_byte(decode(translate(p_p256dh, '-_', '+/') || '=', 'base64'), 0) <> 4
    then raise exception 'Notification subscription unavailable.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text, 27));
  delete from private.push_subscriptions where user_id = me and updated_at < now() - interval '180 days';
  select * into existing from private.push_subscriptions where endpoint = p_endpoint and kind = wanted for update;
  if existing.id is not null and existing.user_id <> me then
    raise exception 'This device needs a new notification subscription.' using errcode = '42501';
  end if;
  if existing.id is null and (select count(*) from private.push_subscriptions where user_id = me) >= 10 then
    raise exception 'Notification device limit reached.'; end if;
  if existing.id is null then
    insert into private.push_subscriptions(user_id, endpoint, p256dh, auth_secret, kind)
    values(me, p_endpoint, p_p256dh, p_auth, wanted);
  else
    update private.push_subscriptions set p256dh = p_p256dh, auth_secret = p_auth, updated_at = clock_timestamp()
     where id = existing.id and user_id = me;
  end if;
end;
$$;
revoke all on function public.register_push_subscription(text,text,text,text) from public, anon;
grant execute on function public.register_push_subscription(text,text,text,text) to authenticated;

create or replace function private.enqueue_call_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.push_jobs(subscription_id, conversation_id, message_id, call_id, kind)
  select s.id, new.conversation_id, gen_random_uuid(), null::uuid, new.id, 'call'
  from private.push_subscriptions s
  where s.user_id = new.callee and s.kind = 'call'
    and s.updated_at > now() - interval '180 days'
    and not private.blocked(new.callee, new.caller)
  on conflict(subscription_id, conversation_id) do update set
    message_id = excluded.message_id, kind = 'call', call_id = excluded.call_id,
    created_at = clock_timestamp(), next_attempt = clock_timestamp(), attempts = 0, lease = null, lease_until = null;
  if found then
    begin perform private.wake_push_worker(); exception when others then null; end;
  end if;
  return new;
end;
$$;
drop trigger if exists bitchat_enqueue_call_push on public.calls;
create trigger bitchat_enqueue_call_push after insert on public.calls for each row execute function private.enqueue_call_push();

-- Chat pushes keep going to message subscriptions only.
-- Existing message subscriptions register with kind='message'; the client passes
-- 'call' to add a second, call-only subscription on the same endpoint.
create or replace function private.enqueue_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.push_jobs(subscription_id, conversation_id, message_id, call_id, kind)
  select s.id, new.conversation_id, new.id::uuid, null::uuid, 'message' from private.push_subscriptions s join (
    select c.member_a as user_id from public.conversations c where c.id = new.conversation_id and c.kind = 'direct'
    union select c.member_b from public.conversations c where c.id = new.conversation_id and c.kind = 'direct'
    union select cm.user_id from public.conversation_members cm where cm.conversation_id = new.conversation_id
  ) recipients on recipients.user_id = s.user_id
  where s.user_id <> new.user_id and s.updated_at > now() - interval '180 days' and s.kind = 'message'
    and private.push_eligible(s.user_id, new.conversation_id, new.id)
  on conflict(subscription_id, conversation_id) do update set
    message_id = excluded.message_id, kind = 'message', call_id = null, created_at = clock_timestamp(),
    next_attempt = clock_timestamp(), attempts = 0, lease = null, lease_until = null;
  if found then
    begin perform private.wake_push_worker(); exception when others then null; end;
  end if;
  return new;
end;
$$;

drop function if exists public.claim_push_jobs(text);

create function public.claim_push_jobs(p_secret text)
returns table(subscription_id uuid, conversation_id uuid, message_id uuid, call_id uuid, user_id uuid, endpoint text, p256dh text, auth_secret text, lease uuid, kind text)
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.push_authorized(p_secret), false) then raise exception 'Unauthorized.' using errcode = '42501'; end if;
  delete from private.push_subscriptions where updated_at < now() - interval '180 days';
  -- A ringing call is only worth waking for ~45 seconds.
  delete from private.push_jobs j where j.kind = 'call' and j.created_at < now() - interval '45 seconds';
  delete from private.push_jobs j using private.push_subscriptions s
    where s.id = j.subscription_id and (j.attempts >= 4 or (j.kind = 'message' and not private.push_eligible(s.user_id, j.conversation_id, j.message_id)));
  delete from private.push_jobs j where j.created_at < now() - interval '1 hour';
  return query with due as (
    select j.subscription_id, j.conversation_id from private.push_jobs j
    where j.next_attempt <= clock_timestamp() and (j.lease_until is null or j.lease_until < clock_timestamp())
    order by j.next_attempt limit 40 for update skip locked
  ), claimed as (
    update private.push_jobs j set attempts = j.attempts + 1, lease = gen_random_uuid(), lease_until = clock_timestamp() + interval '90 seconds'
    from due d where j.subscription_id = d.subscription_id and j.conversation_id = d.conversation_id
    returning j.*
  ) select j.subscription_id, j.conversation_id, j.message_id, j.call_id, s.user_id, s.endpoint, s.p256dh, s.auth_secret, j.lease, j.kind
    from claimed j join private.push_subscriptions s on s.id = j.subscription_id;
end;
$$;
revoke all on function public.claim_push_jobs(text) from public, anon, authenticated;
grant execute on function public.claim_push_jobs(text) to service_role;

notify pgrst, 'reload schema';
commit;
-- BitchAt 2.11 — couple extras. Additive only: nothing is dropped except
-- emoji/mood check constraints, which are widened to match the new client lists.
-- Every statement is idempotent so this can be replayed from the SQL editor.
begin;

-- ---------------------------------------------------------------------------
-- 1. Pet names. pet_a is what member_a calls member_b (and vice versa).
-- ---------------------------------------------------------------------------
alter table public.conversations add column if not exists pet_a text;
alter table public.conversations add column if not exists pet_b text;
alter table public.conversations drop constraint if exists conversations_pet_length;
alter table public.conversations add constraint conversations_pet_length check (
  (pet_a is null or (char_length(btrim(pet_a)) between 1 and 24 and btrim(pet_a) !~ '[[:cntrl:]<>]')) and
  (pet_b is null or (char_length(btrim(pet_b)) between 1 and 24 and btrim(pet_b) !~ '[[:cntrl:]<>]'))
);

create or replace function public.set_pet_name(p_conversation uuid, p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cleaned text := nullif(btrim(coalesce(p_name, '')), ''); result text;
begin
  if me is null or not private.is_member(p_conversation) then
    raise exception 'Conversation unavailable.';
  end if;
  if not exists(select 1 from public.conversations where id = p_conversation and kind = 'direct') then
    raise exception 'Nicknames are for one-to-one chats.';
  end if;
  if cleaned is not null and (char_length(cleaned) > 24 or cleaned ~ '[[:cntrl:]<>]') then
    raise exception 'Use 1–24 friendly characters.';
  end if;
  update public.conversations c set
    pet_a = case when c.member_a = me then cleaned else c.pet_a end,
    pet_b = case when c.member_b = me then cleaned else c.pet_b end
  where c.id = p_conversation
  returning case when c.member_a = me then c.pet_a else c.pet_b end into result;
  return result;
end;
$$;
revoke all on function public.set_pet_name(uuid, text) from public, anon;
grant execute on function public.set_pet_name(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Wider mood + reaction palettes (kept in sync with lib/types.ts).
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_mood_check;
alter table public.profiles add constraint profiles_mood_check check (mood is null or mood = any(array[
  '🥰','😊','🥺','😴','😔','😤','🤍','🫶','😻','🌸','🍓','🧸','🌙','✨','💌','😽'
]));

alter table public.journals drop constraint if exists journals_mood_check;
alter table public.journals add constraint journals_mood_check check (mood is null or mood = any(array[
  '🥰','😊','🥺','😴','😔','😤','🤍','🫶','😻','🌸','🍓','🧸','🌙','✨','💌','😽'
]));

alter table public.reactions drop constraint if exists reactions_emoji_check;
alter table public.reactions add constraint reactions_emoji_check check (emoji = any(array[
  '❤️','😂','🥺','🔥','😘','🫶','👍','👎','😍','🥹','😮','😢','😡','🤍','💯','🎉','✨','👀','🙈','🤗','😈','💋','💕','💀',
  '🥰','😻','🫂','🌹','🍓','🧸','🍪','🌙','🌸','💌','💘','💞','🫦','😽','🎀','💓'
]));

-- ---------------------------------------------------------------------------
-- 3. Digital makeout meter. One row per couple, written only through kiss().
-- ---------------------------------------------------------------------------
create table if not exists public.kiss_meter (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  taps_a integer not null default 0 check (taps_a >= 0),
  taps_b integer not null default 0 check (taps_b >= 0),
  last_at timestamptz not null default now()
);
alter table public.kiss_meter enable row level security;
revoke all on public.kiss_meter from public, anon, authenticated;
grant select on public.kiss_meter to authenticated;
grant all on public.kiss_meter to service_role;
drop policy if exists bitchat_kiss_read on public.kiss_meter;
create policy bitchat_kiss_read on public.kiss_meter for select to authenticated
  using(private.is_member(conversation_id));

create or replace function public.kiss(p_conversation uuid, p_count integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  taps integer := greatest(1, least(coalesce(p_count, 1), 12));
  is_a boolean;
  row public.kiss_meter;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  select c.member_a = me into is_a from public.conversations c where c.id = p_conversation and c.kind = 'direct';
  if is_a is null then raise exception 'Makeout needs a one-to-one chat.'; end if;
  insert into public.kiss_meter as k(conversation_id, taps_a, taps_b)
  values(p_conversation, case when is_a then taps else 0 end, case when is_a then 0 else taps end)
  on conflict(conversation_id) do update set
    taps_a = k.taps_a + case when is_a then taps else 0 end,
    taps_b = k.taps_b + case when is_a then 0 else taps end,
    last_at = now()
  returning * into row;
  return jsonb_build_object('taps_a', row.taps_a, 'taps_b', row.taps_b, 'last_at', row.last_at);
end;
$$;
revoke all on function public.kiss(uuid, integer) from public, anon;
grant execute on function public.kiss(uuid, integer) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists(select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kiss_meter') then
    alter publication supabase_realtime add table public.kiss_meter;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Memories: one round trip describing the shared story.
-- Visible to the caller only after their own cleared marker, like chat.
-- ---------------------------------------------------------------------------
create or replace function public.couple_memories(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  since timestamptz;
  fresh timestamptz := now() - interval '24 hours';
  payload jsonb;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  since := private.visible_after(p_conversation);
  select jsonb_build_object(
    'started_at', (select min(m.created_at) from public.messages m
      where m.conversation_id = p_conversation and m.created_at > since),
    'total', (select count(*) from public.messages m
      where m.conversation_id = p_conversation and m.created_at > since),
    'mine', (select count(*) from public.messages m
      where m.conversation_id = p_conversation and m.created_at > since and m.user_id = me),
    'photos', (select count(*) from public.messages m
      where m.conversation_id = p_conversation and m.created_at > since and m.media_url is not null),
    'misses', (select count(*) from public.messages m
      where m.conversation_id = p_conversation and m.created_at > since and m.kind = 'miss'),
    'kisses', coalesce((select k.taps_a + k.taps_b from public.kiss_meter k where k.conversation_id = p_conversation), 0),
    'first', (select jsonb_build_object(
        'content', m.content, 'kind', m.kind, 'created_at', m.created_at, 'user_id', m.user_id, 'media_url', m.media_url)
      from public.messages m
      where m.conversation_id = p_conversation and m.created_at > since
      order by m.created_at asc, m.id asc limit 1),
    'recent', coalesce((select jsonb_agg(item order by at desc) from (
        select jsonb_build_object('id', m.id, 'media_url', m.media_url, 'media_kind', m.media_kind,
          'content', m.content, 'created_at', m.created_at) as item, m.created_at as at
        from public.messages m
        where m.conversation_id = p_conversation and m.created_at > greatest(since, fresh)
          and (m.media_url is not null or m.kind in ('miss','sticker'))
        order by m.created_at desc limit 9) rows), '[]'::jsonb)
  ) into payload;
  return payload;
end;
$$;
revoke all on function public.couple_memories(uuid) from public, anon;
grant execute on function public.couple_memories(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. People discovery: suggestions and shareable @username lookups.
-- ---------------------------------------------------------------------------
create or replace function public.suggested_profiles()
returns table(id uuid, username text, display_name text, avatar_url text, mood text, shared integer)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as id)
  select p.id, p.username, p.display_name, p.avatar_url, p.mood,
    (select count(*)::int from public.conversation_members a
      join public.conversation_members b on b.conversation_id = a.conversation_id
      where a.user_id = p.id and b.user_id = (select id from me)) as shared
  from public.profiles p
  where (select id from me) is not null
    and p.id <> (select id from me)
    and not private.blocked((select id from me), p.id)
  order by
    (select count(*) from public.conversation_members a
      join public.conversation_members b on b.conversation_id = a.conversation_id
      where a.user_id = p.id and b.user_id = (select id from me)) desc,
    (exists(select 1 from public.conversations c
      where (c.member_a = p.id and c.member_b = (select id from me))
         or (c.member_b = p.id and c.member_a = (select id from me)))) desc,
    p.created_at desc
  limit 12;
$$;
revoke all on function public.suggested_profiles() from public, anon;
grant execute on function public.suggested_profiles() to authenticated;

create or replace function public.profile_by_username(p_username text)
returns table(id uuid, username text, display_name text, avatar_url text, mood text, is_pro boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.mood, p.is_pro
  from public.profiles p
  where auth.uid() is not null
    and p.username = lower(btrim(coalesce(p_username, '')))
  limit 1;
$$;
revoke all on function public.profile_by_username(text) from public, anon;
grant execute on function public.profile_by_username(text) to authenticated;

notify pgrst, 'reload schema';
commit;

-- BitchAt 2.13 — live shared activities, shared drawing board, more games.
-- Additive: new game types, two new tables, a couple of functions. Existing
-- rows and policies are untouched. Every statement is re-runnable.
begin;

-- ---------------------------------------------------------------------------
-- 1. More game types. The old check constraint only allowed three.
-- ---------------------------------------------------------------------------
alter table public.games drop constraint if exists games_game_type_check;
alter table public.games add constraint games_game_type_check
  check (game_type in ('question','either','tic_tac_toe','truth','dare','would_you','finish','this_or_that','kiss_dare'));

-- ---------------------------------------------------------------------------
-- 2. Shared activity session. One row per conversation: whoever opens a game,
--    the makeout meter or a drawing board flips this row, and the partner's
--    app (already subscribed to `activities`) gets a toast right away.
-- ---------------------------------------------------------------------------
create table if not exists public.shared_activity (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  kind text not null check (kind in ('makeout','game','draw','wyr','kiss')),
  ref_id uuid,
  opened_by uuid not null references public.profiles(id) on delete cascade,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.shared_activity enable row level security;
revoke all on public.shared_activity from public, anon, authenticated;
grant select on public.shared_activity to authenticated;
grant all on public.shared_activity to service_role;
drop policy if exists bitchat_activity_read on public.shared_activity;
create policy bitchat_activity_read on public.shared_activity for select to authenticated
  using(private.is_member(conversation_id));

create or replace function public.open_activity(p_conversation uuid, p_kind text, p_ref uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); row public.shared_activity;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if p_kind is null or p_kind not in ('makeout','game','draw','wyr','kiss') then raise exception 'Unknown activity.'; end if;
  insert into public.shared_activity as a(conversation_id, kind, ref_id, opened_by, opened_at, closed_at, updated_at)
  values(p_conversation, p_kind, p_ref, me, now(), null, now())
  on conflict(conversation_id) do update set
    kind = excluded.kind, ref_id = excluded.ref_id, opened_by = excluded.opened_by,
    opened_at = excluded.opened_at, closed_at = null, updated_at = now()
  returning * into row;
  return to_jsonb(row);
end;
$$;

create or replace function public.close_activity(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  update public.shared_activity set closed_at = now(), updated_at = now()
   where conversation_id = p_conversation and closed_at is null;
end;
$$;

revoke all on function public.open_activity(uuid,text,uuid), public.close_activity(uuid) from public, anon;
grant execute on function public.open_activity(uuid,text,uuid), public.close_activity(uuid) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shared_activity') then
    alter publication supabase_realtime add table public.shared_activity;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Shared drawing board. Strokes live in one row per conversation so both
--    screens show the same canvas: whoever draws, edits or clears it, the
--    partner sees it. Each stroke is {id, by, color, width, points[]}. The
--    entire board is capped so a doodle cannot become an unbounded payload.
-- ---------------------------------------------------------------------------
create table if not exists public.drawing_board (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  strokes jsonb not null default '[]'::jsonb,
  closed boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.drawing_board enable row level security;
revoke all on public.drawing_board from public, anon, authenticated;
grant select on public.drawing_board to authenticated;
grant all on public.drawing_board to service_role;
drop policy if exists bitchat_board_read on public.drawing_board;
create policy bitchat_board_read on public.drawing_board for select to authenticated
  using(private.is_member(conversation_id));

-- Replace the whole stroke list. Undo, redo, erase-one and clear are all just
-- a new list, which keeps the two screens convergent without merge conflicts.
create or replace function public.save_board(p_conversation uuid, p_strokes jsonb, p_closed boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); row public.drawing_board;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if p_strokes is null or jsonb_typeof(p_strokes) <> 'array' then raise exception 'Drawing unavailable.'; end if;
  if jsonb_array_length(p_strokes) > 400 or length(p_strokes::text) > 120000 then raise exception 'That drawing is too big.'; end if;
  insert into public.drawing_board as b(conversation_id, strokes, closed, updated_by, updated_at)
  values(p_conversation, p_strokes, coalesce(p_closed, false), me, now())
  on conflict(conversation_id) do update set
    strokes = excluded.strokes, closed = excluded.closed, updated_by = me, updated_at = now()
  returning * into row;
  return jsonb_build_object('conversation_id', row.conversation_id, 'strokes', row.strokes, 'closed', row.closed, 'updated_at', row.updated_at);
end;
$$;
revoke all on function public.save_board(uuid,jsonb,boolean) from public, anon;
grant execute on function public.save_board(uuid,jsonb,boolean) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='drawing_board') then
    alter publication supabase_realtime add table public.drawing_board;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Bigger, warmer question decks. Per-couple mode gets romantic and flirty
--    prompts; everything else gets friendlier ones. Never explicit.
-- ---------------------------------------------------------------------------
create or replace function public.start_game(p_conversation uuid, p_type text, p_custom text default null)
returns public.games language plpgsql security definer set search_path = '' as $$
declare result public.games; prompt text; a text; b text; pick integer; couple boolean; deck text[]; deck_a text[]; deck_b text[];
begin
  if not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id = p_conversation and kind = 'direct')
     or p_type is null or p_type not in ('question','either','tic_tac_toe','truth','dare','would_you','finish','this_or_that','kiss_dare') then
    raise exception 'Game unavailable.';
  end if;
  perform 1 from public.conversations where id = p_conversation for update;
  select * into result from public.games where conversation_id = p_conversation and ended_at is null limit 1;
  if result.id is not null then return result; end if;
  select (couple_a and couple_b) into couple from public.conversations where id = p_conversation;
  if coalesce(couple, false) then
    deck := array[
      'What makes you feel most loved?','What is one tiny thing you miss about me?',
      'Where would you steal a kiss from me?','What should our next date look like?',
      'What is a dream you have not told me yet?','Which memory of us would you replay?',
      'What is your favourite way to be comforted?','What is one thing you want us to do more often?',
      'Describe our perfect lazy morning.','What was the moment you first felt a spark?',
      'What would you whisper in my ear right now?','What is your favourite kind of surprise?',
      'When did you last think about me today?','What smell reminds you of us?',
      'What song is ours, and why?','What do you want me to do the next time we meet?',
      'What is the sweetest thing I have ever said to you?','Where do you feel safest with me?',
      'What is one promise you want to keep for us?','What do you daydream about when I am quiet?',
      'What part of my laugh do you love?','What is something you have never told me?',
      'How do you want to be kissed tonight?','What little thing do I do that gives you butterflies?',
      'If we could pause one moment of us forever, which one?','What is your favourite nickname to call me?',
      'What makes you want to hold my hand?','What is the best hug you have ever had from me?',
      'What are you most excited to do with me this year?','What do you want to be when we are older?',
      'What was the exact second you fell?','What do you want more of from me?',
      'What is a tiny ritual only we have?','When do you feel most wanted?',
      'What would you write on a postcard to me?','What do you miss when I am not around?',
      'What is the most romantic thing I could do this week?','What is one word that is just ours?',
      'What do you want me to remember about you?','What is your favourite place we have been alone?'
    ];
    deck_a := array['A cozy night in','A surprise kiss','Sunrise together','A handwritten note','Cooking together','A spontaneous trip',
      'A slow dance in the kitchen','Staying in bed all day','A long voice note','A rainy afternoon','A surprise gift','Midnight snacks'];
    deck_b := array['A night out dancing','A long hug','Stargazing together','A surprise date','Ordering our favourites','A perfectly planned trip',
      'A film under a blanket','A walk with no destination','A playlist made for me','A drive with the windows down','A surprise letter','Breakfast in bed'];
  else
    deck := array[
      'What is a skill you would love to learn?','What song is on repeat for you?',
      'What is the funniest thing that happened this week?','Where would you go on a free plane ticket?',
      'What is a small win you are proud of?','What always makes you laugh?',
      'What is your most underrated favourite movie?','What should we try together next?',
      'What is the best thing you ate this month?','What is your comfort show?',
      'What would your perfect Sunday look like?','What is one app you could not live without?'
    ];
    deck_a := array['A cozy night in','Mountains','Sunrise','Texting','Cooking','A spontaneous trip','Tea','A road trip','Live music','Staying up late'];
    deck_b := array['A night out','The beach','Stargazing','Voice notes','Ordering in','A planned trip','Coffee','A quiet night','A film at home','An early night'];
  end if;
  if p_custom is not null then
    if not private.is_pro() or p_type not in ('question','truth','dare','finish') or length(btrim(p_custom)) not between 1 and 250 then
      raise exception 'Custom question unavailable.';
    end if;
    prompt := btrim(p_custom);
  elsif p_type in ('question','truth','dare','finish','kiss_dare') then
    prompt := deck[1 + floor(random() * array_length(deck, 1))::int];
    -- Dares should sound like dares, not questions.
    if p_type in ('dare','kiss_dare') then
      prompt := (array['Give me your best 10-second hug when we meet.','Send the photo you almost sent me.','Say my name like you mean it.','Tell me one thing you want to do to me.','Compliment me in three words.','Kiss me like you missed me.','Write what you would do if I were next to you.','Describe my eyes from memory.','Send me a voice note of your laugh.','Promise me something silly and keep it.'])[1 + floor(random() * 10)::int];
    end if;
    if p_type = 'finish' then
      prompt := (array['The thing I want most tonight is…','If we were alone right now, I would…','My favourite thing about your body is…','I knew I loved you when…','The next time I see you, I will…','Something I have never said out loud:…'])[1 + floor(random() * 6)::int];
    end if;
  elsif p_type in ('either','would_you','this_or_that') then
    pick := 1 + floor(random() * array_length(deck_a, 1))::int;
    prompt := case p_type when 'would_you' then 'Would you rather?' when 'this_or_that' then 'This or that?' else 'This or that?' end;
    a := deck_a[pick]; b := deck_b[pick];
  else
    prompt := 'Three in a row';
  end if;
  insert into public.games(conversation_id, created_by, game_type, question, option_a, option_b, next_player)
  values(p_conversation, auth.uid(), p_type, prompt, a, b, auth.uid()) returning * into result;
  return result;
end;
$$;
revoke all on function public.start_game(uuid,text,text) from public, anon;
grant execute on function public.start_game(uuid,text,text) to authenticated;

-- answer_game only needs to accept the new choice-based types.
create or replace function public.answer_game(p_id uuid, p_answer text)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  select * into g from public.games where id = p_id for update;
  if g.id is null or not private.is_member(g.conversation_id) or g.game_type = 'tic_tac_toe' or g.ended_at is not null then raise exception 'Game unavailable.'; end if;
  if p_answer is null or length(btrim(p_answer)) not between 1 and 500
     or (g.game_type in ('either','would_you','this_or_that') and p_answer not in (g.option_a, g.option_b)) then
    raise exception 'Choose an answer.';
  end if;
  insert into private.game_answers(game_id, user_id, answer) values(p_id, auth.uid(), btrim(p_answer)) on conflict do nothing;
  if (select count(*) from private.game_answers where game_id = p_id) = 2 then update public.games set ended_at = now() where id = p_id;
  else update public.games set question = question where id = p_id; end if;
end;
$$;
revoke all on function public.answer_game(uuid,text) from public, anon;
grant execute on function public.answer_game(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
-- Atomic stroke-level edits prevent unrelated simultaneous edits from being lost.
begin;
create or replace function public.edit_board(p_conversation uuid, p_upserts jsonb, p_remove jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); board public.drawing_board; item jsonb; result jsonb;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if p_upserts is null or p_remove is null or jsonb_typeof(p_upserts) <> 'array' or jsonb_typeof(p_remove) <> 'array'
    or jsonb_array_length(p_upserts) > 400 or jsonb_array_length(p_remove) > 400
    or length(p_upserts::text) > 120000 or length(p_remove::text) > 20000 then raise exception 'Drawing unavailable.'; end if;
  for item in select value from jsonb_array_elements(p_upserts) loop
    if jsonb_typeof(item) <> 'object' or coalesce(item->>'id','') !~ '^[a-zA-Z0-9-]{1,64}$'
      or coalesce(item->>'by','') !~ '^[a-zA-Z0-9-]{1,64}$'
      or coalesce(item->>'color','') !~ '^#[0-9a-fA-F]{6}$'
      or jsonb_typeof(item->'width') is distinct from 'number'
      or jsonb_typeof(item->'points') is distinct from 'array' then raise exception 'Invalid stroke.'; end if;
    if (item->>'width')::numeric not between 1 and 30 or jsonb_array_length(item->'points') not between 1 and 900
      or exists (select 1 from jsonb_array_elements(item->'points') pt where jsonb_typeof(pt) is distinct from 'array'
         or case when jsonb_typeof(pt) = 'array' then jsonb_array_length(pt) <> 2 else true end
         or case when jsonb_typeof(pt) = 'array' and jsonb_array_length(pt) = 2 then
           jsonb_typeof(pt->0) is distinct from 'number' or jsonb_typeof(pt->1) is distinct from 'number'
         else false end)
      then raise exception 'Invalid stroke.'; end if;
    if exists (select 1 from jsonb_array_elements(item->'points') pt where (pt->>0)::numeric not between 0 and 1 or (pt->>1)::numeric not between 0 and 1) then raise exception 'Invalid point.'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_remove) v where jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[a-zA-Z0-9-]{1,64}$') then raise exception 'Invalid stroke ID.'; end if;
  insert into public.drawing_board(conversation_id, strokes, updated_by) values(p_conversation, '[]'::jsonb, me) on conflict (conversation_id) do nothing;
  select * into board from public.drawing_board where conversation_id = p_conversation for update;
  select coalesce(jsonb_agg(s.value order by s.ordinality), '[]'::jsonb) into result
    from jsonb_array_elements(board.strokes) with ordinality s(value, ordinality)
    where not exists(select 1 from jsonb_array_elements(p_remove) r where r #>> '{}' = s.value->>'id')
      and not exists(select 1 from jsonb_array_elements(p_upserts) u where u->>'id' = s.value->>'id');
  result := result || p_upserts;
  if jsonb_array_length(result) > 400 or length(result::text) > 120000 then raise exception 'That drawing is too big.'; end if;
  update public.drawing_board set strokes = result, updated_by = me, updated_at = clock_timestamp(), closed = false
    where conversation_id = p_conversation returning * into board;
  return jsonb_build_object('strokes', board.strokes, 'updated_at', board.updated_at);
end;
$$;
revoke all on function public.edit_board(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.edit_board(uuid,jsonb,jsonb) to authenticated;

-- Either participant can leave an abandoned game and start another.
create or replace function public.end_game(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.games;
begin
  select * into g from public.games where id = p_id for update;
  if g.id is null or auth.uid() is null or not private.is_member(g.conversation_id) then raise exception 'Game unavailable.'; end if;
  update public.games set ended_at = now() where id = p_id and ended_at is null;
end;
$$;
revoke all on function public.end_game(uuid) from public, anon;
grant execute on function public.end_game(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
-- Additional shared prompt games reuse the existing answer and realtime paths.
begin;
create or replace function public.start_prompt_game(p_conversation uuid, p_mode text)
returns public.games language plpgsql security definer set search_path = '' as $$
declare result public.games; deck text[]; prompt text;
begin
  if auth.uid() is null or not private.is_member(p_conversation)
    or not exists(select 1 from public.conversations where id=p_conversation and kind='direct') then
    raise exception 'Game unavailable.';
  end if;
  deck := case p_mode
    when 'memory' then array['What was your first impression of me?','Which date would you relive?','What is a tiny moment with me you still think about?','What did we laugh about the hardest?','Which song reminds you of us?','What was our best late-night conversation?','When did you feel closest to me?','What is a photo of us you love?']
    when 'future' then array['Where should we go together next?','What would a perfect weekend together look like?','What should we cook together?','What kind of home would feel like us?','What is a tradition you would like us to start?','What baby names do you like, if we ever want kids?','What small thing should we do together this week?','What is on your list for our next date?']
    when 'guess' then array['What snack do you think I would pick right now?','What do you think my ideal date is?','Which song do you think I would choose for us?','What do you think makes me feel most loved?','What do you think I would order for us?','Guess the first place I would take you on a trip.','What do you think I miss most about you?','Guess what I would do with a free day together.']
    when 'emoji' then array['Describe our first date in three emojis.','Describe our next date using only emojis.','Send three emojis that remind you of me.','Tell a story about us using five emojis.','Pick an emoji for our mood tonight.','Describe our dream holiday in emojis.','Choose an emoji for your favourite memory of us.','Give me an emoji clue for a surprise date.']
    when 'spicy' then array['What kind of kiss are you in the mood for?','What would you whisper to me if we were alone?','What is something flirty you would like me to say?','What is your favourite way for me to tease you?','Where would you like a slow kiss?','What should our next private date feel like?','What makes you feel wanted?','What would you like more of when we are together?']
    else null end;
  if deck is null then raise exception 'Game unavailable.'; end if;
  perform 1 from public.conversations where id=p_conversation for update;
  select * into result from public.games where conversation_id=p_conversation and ended_at is null limit 1;
  if result.id is not null then return result; end if;
  prompt := deck[1 + floor(random()*array_length(deck,1))::int];
  insert into public.games(conversation_id,created_by,game_type,question,next_player)
    values(p_conversation,auth.uid(),'question',prompt,auth.uid()) returning * into result;
  return result;
end;
$$;
revoke all on function public.start_prompt_game(uuid,text) from public, anon;
grant execute on function public.start_prompt_game(uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
begin;
-- Pet is shared per direct conversation; no time decay or punitive streaks.
create table if not exists public.couple_pet (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  species text not null check (species in ('cat','dog','bunny')),
  feeds integer not null default 0 check (feeds between 0 and 1000000),
  plays integer not null default 0 check (plays between 0 and 1000000),
  cuddles integer not null default 0 check (cuddles between 0 and 1000000),
  last_action text not null default 'adopt' check (last_action in ('adopt','feed','play','cuddle','rename')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.couple_pet enable row level security;
revoke all on public.couple_pet from public, anon, authenticated;
grant select on public.couple_pet to authenticated;
grant all on public.couple_pet to service_role;
drop policy if exists couple_pet_read on public.couple_pet;
create policy couple_pet_read on public.couple_pet for select to authenticated using(private.is_member(conversation_id));

create or replace function public.care_couple_pet(p_conversation uuid, p_action text, p_name text default null, p_species text default null)
returns public.couple_pet language plpgsql security definer set search_path = '' as $$
declare result public.couple_pet; me uuid := auth.uid();
begin
  if me is null or not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id=p_conversation and kind='direct') then raise exception 'Pet unavailable.'; end if;
  if p_action is null or p_action not in ('adopt','feed','play','cuddle','rename') then raise exception 'Unknown action.'; end if;
  if p_action in ('adopt','rename') and (p_name is null or char_length(btrim(p_name)) not between 1 and 24) then raise exception 'Choose a name between 1 and 24 characters.'; end if;
  if p_action='adopt' then
    if p_species is null or p_species not in ('cat','dog','bunny') then raise exception 'Choose a pet.'; end if;
    insert into public.couple_pet(conversation_id,name,species,updated_by) values(p_conversation,btrim(p_name),p_species,me) on conflict(conversation_id) do nothing;
  else
    update public.couple_pet set name=case when p_action='rename' then btrim(p_name) else name end,
      feeds=case when p_action='feed' then least(feeds+1,1000000) else feeds end,
      plays=case when p_action='play' then least(plays+1,1000000) else plays end,
      cuddles=case when p_action='cuddle' then least(cuddles+1,1000000) else cuddles end,
      last_action=p_action,updated_by=me,updated_at=clock_timestamp()
      where conversation_id=p_conversation;
  end if;
  select * into result from public.couple_pet where conversation_id=p_conversation;
  if result.conversation_id is null then raise exception 'Adopt a pet first.'; end if;
  return result;
end $$;
revoke all on function public.care_couple_pet(uuid,text,text,text) from public,anon;
grant execute on function public.care_couple_pet(uuid,text,text,text) to authenticated;

create table if not exists public.future_names (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 name text not null check (char_length(name) between 1 and 40),
 created_by uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index if not exists future_names_conversation_idx on public.future_names(conversation_id,created_at);
alter table public.future_names enable row level security;
revoke all on public.future_names from public,anon,authenticated;
grant select on public.future_names to authenticated;
grant all on public.future_names to service_role;
drop policy if exists future_names_read on public.future_names;
create policy future_names_read on public.future_names for select to authenticated using(private.is_member(conversation_id));
create or replace function public.change_future_name(p_conversation uuid,p_name text default null,p_remove uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id=p_conversation and kind='direct') then raise exception 'List unavailable.'; end if;
  perform 1 from public.conversations where id=p_conversation for update;
  if p_remove is not null then delete from public.future_names where id=p_remove and conversation_id=p_conversation;
  else
    if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then raise exception 'Enter a name of up to 40 characters.'; end if;
    if (select count(*) from public.future_names where conversation_id=p_conversation)>=40 then raise exception 'The list is full.'; end if;
    if not exists(select 1 from public.future_names where conversation_id=p_conversation and lower(name)=lower(btrim(p_name))) then
      insert into public.future_names(conversation_id,name,created_by) values(p_conversation,btrim(p_name),auth.uid());
    end if;
  end if;
end $$;
revoke all on function public.change_future_name(uuid,text,uuid) from public,anon;
grant execute on function public.change_future_name(uuid,text,uuid) to authenticated;

alter table public.shared_activity drop constraint if exists shared_activity_kind_check;
alter table public.shared_activity add constraint shared_activity_kind_check check(kind in ('makeout','game','draw','wyr','kiss','pet'));
create or replace function public.open_activity(p_conversation uuid, p_kind text, p_ref uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); row public.shared_activity;
begin
  if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  if p_kind is null or p_kind not in ('makeout','game','draw','wyr','kiss','pet') then raise exception 'Unknown activity.'; end if;
  insert into public.shared_activity as a(conversation_id,kind,ref_id,opened_by,opened_at,closed_at,updated_at)
  values(p_conversation,p_kind,p_ref,me,now(),null,now())
  on conflict(conversation_id) do update set kind=excluded.kind,ref_id=excluded.ref_id,opened_by=excluded.opened_by,opened_at=excluded.opened_at,closed_at=null,updated_at=now()
  returning * into row;
  return to_jsonb(row);
end $$;
revoke all on function public.open_activity(uuid,text,uuid) from public,anon;
grant execute on function public.open_activity(uuid,text,uuid) to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='couple_pet') then alter publication supabase_realtime add table public.couple_pet; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='future_names') then alter publication supabase_realtime add table public.future_names; end if;
end $$;
notify pgrst, 'reload schema';
commit;
begin;
create or replace function private.is_couple(p_conversation uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_member(p_conversation) and exists(select 1 from public.conversations c where c.id=p_conversation and c.kind='direct' and c.couple_a and c.couple_b);
$$;
revoke all on function private.is_couple(uuid) from public,anon;
grant execute on function private.is_couple(uuid) to authenticated;
drop policy if exists couple_pet_read on public.couple_pet;
create policy couple_pet_read on public.couple_pet for select to authenticated using(private.is_couple(conversation_id));
drop policy if exists future_names_read on public.future_names;
create policy future_names_read on public.future_names for select to authenticated using(private.is_couple(conversation_id));
create or replace function public.care_couple_pet(p_conversation uuid, p_action text, p_name text default null, p_species text default null)
returns public.couple_pet language plpgsql security definer set search_path = '' as $$
declare result public.couple_pet; me uuid := auth.uid();
begin
  if me is null or not private.is_couple(p_conversation) then raise exception 'Pet unavailable.'; end if;
  if p_action is null or p_action not in ('adopt','feed','play','cuddle','rename') then raise exception 'Unknown action.'; end if;
  if p_action in ('adopt','rename') and (p_name is null or char_length(btrim(p_name)) not between 1 and 24) then raise exception 'Choose a name between 1 and 24 characters.'; end if;
  if p_action='adopt' then
    if p_species is null or p_species not in ('cat','dog','bunny') then raise exception 'Choose a pet.'; end if;
    insert into public.couple_pet(conversation_id,name,species,updated_by) values(p_conversation,btrim(p_name),p_species,me) on conflict(conversation_id) do nothing;
  else
    update public.couple_pet set name=case when p_action='rename' then btrim(p_name) else name end,
      feeds=case when p_action='feed' then least(feeds+1,1000000) else feeds end,
      plays=case when p_action='play' then least(plays+1,1000000) else plays end,
      cuddles=case when p_action='cuddle' then least(cuddles+1,1000000) else cuddles end,
      last_action=p_action,updated_by=me,updated_at=clock_timestamp()
      where conversation_id=p_conversation;
  end if;
  select * into result from public.couple_pet where conversation_id=p_conversation;
  if result.conversation_id is null then raise exception 'Adopt a pet first.'; end if;
  return result;
end $$;
create or replace function public.change_future_name(p_conversation uuid,p_name text default null,p_remove uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_couple(p_conversation) then raise exception 'List unavailable.'; end if;
  perform 1 from public.conversations where id=p_conversation for update;
  if p_remove is not null then delete from public.future_names where id=p_remove and conversation_id=p_conversation;
  else
    if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then raise exception 'Enter a name of up to 40 characters.'; end if;
    if (select count(*) from public.future_names where conversation_id=p_conversation)>=40 then raise exception 'The list is full.'; end if;
    if not exists(select 1 from public.future_names where conversation_id=p_conversation and lower(name)=lower(btrim(p_name))) then
      insert into public.future_names(conversation_id,name,created_by) values(p_conversation,btrim(p_name),auth.uid());
    end if;
  end if;
end $$;
drop policy if exists bitchat_kiss_read on public.kiss_meter;
create policy bitchat_kiss_read on public.kiss_meter for select to authenticated using(private.is_couple(conversation_id));
create or replace function public.kiss(p_conversation uuid, p_count integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  taps integer := greatest(1, least(coalesce(p_count, 1), 12));
  is_a boolean;
  row public.kiss_meter;
begin
  if me is null or not private.is_couple(p_conversation) then raise exception 'Conversation unavailable.'; end if;
  select c.member_a = me into is_a from public.conversations c where c.id = p_conversation and c.kind = 'direct';
  if is_a is null then raise exception 'Makeout needs a one-to-one chat.'; end if;
  insert into public.kiss_meter as k(conversation_id, taps_a, taps_b)
  values(p_conversation, case when is_a then taps else 0 end, case when is_a then 0 else taps end)
  on conflict(conversation_id) do update set
    taps_a = k.taps_a + case when is_a then taps else 0 end,
    taps_b = k.taps_b + case when is_a then 0 else taps end,
    last_at = now()
  returning * into row;
  return jsonb_build_object('taps_a', row.taps_a, 'taps_b', row.taps_b, 'last_at', row.last_at);
end;
$$;

alter table public.shared_activity drop constraint if exists shared_activity_kind_check;
alter table public.shared_activity add constraint shared_activity_kind_check check(kind in ('makeout','game','draw','wyr','kiss','pet','arcade','listen'));
create or replace function public.open_activity(p_conversation uuid,p_kind text,p_ref uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); row public.shared_activity;
begin
 if me is null or not private.is_member(p_conversation) then raise exception 'Conversation unavailable.'; end if;
 if p_kind is null or p_kind not in ('makeout','game','draw','wyr','kiss','pet','arcade','listen') then raise exception 'Unknown activity.'; end if;
 if p_kind in ('makeout','kiss','pet') and not private.is_couple(p_conversation) then raise exception 'Both people must enable couple mode.'; end if;
 insert into public.shared_activity as a(conversation_id,kind,ref_id,opened_by,opened_at,closed_at,updated_at) values(p_conversation,p_kind,p_ref,me,clock_timestamp(),null,clock_timestamp())
 on conflict(conversation_id) do update set kind=excluded.kind,ref_id=excluded.ref_id,opened_by=excluded.opened_by,opened_at=excluded.opened_at,closed_at=null,updated_at=excluded.updated_at returning * into row;
 return to_jsonb(row);
end $$;

notify pgrst,'reload schema';
commit;
begin;
create table if not exists public.live_arcade (
 conversation_id uuid primary key references public.conversations(id) on delete cascade,
 round_id uuid not null default gen_random_uuid(), mode text not null check(mode in ('four','garden','race')),
 board text not null, started_by uuid not null references public.profiles(id),
 next_player uuid references public.profiles(id), last_player uuid references public.profiles(id),
 winner uuid references public.profiles(id), finished boolean not null default false,
 ready_a boolean not null default false, ready_b boolean not null default false, ready_at timestamptz, updated_at timestamptz not null default clock_timestamp()
);
alter table public.live_arcade enable row level security;
revoke all on public.live_arcade from public,anon,authenticated;
grant select on public.live_arcade to authenticated;
grant all on public.live_arcade to service_role;
drop policy if exists live_arcade_read on public.live_arcade;
create policy live_arcade_read on public.live_arcade for select to authenticated using(private.is_member(conversation_id));
create or replace function public.start_live_arcade(p_conversation uuid,p_mode text) returns public.live_arcade language plpgsql security definer set search_path='' as $$
declare r public.live_arcade; me uuid:=auth.uid();
begin
 if me is null or not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id=p_conversation and kind='direct' and member_a is not null and member_b is not null) or p_mode is null or p_mode not in ('four','garden','race') then raise exception 'Game unavailable.'; end if;
 perform 1 from public.conversations where id=p_conversation for update;
 select * into r from public.live_arcade where conversation_id=p_conversation;
 if r.conversation_id is not null and not r.finished then raise exception 'End the current game first.'; end if;
 insert into public.live_arcade as a(conversation_id,round_id,mode,board,started_by,next_player,last_player,winner,finished,ready_a,ready_b,ready_at,updated_at)
 values(p_conversation,gen_random_uuid(),p_mode,repeat('-',case when p_mode='four' then 42 when p_mode='garden' then 16 else 1 end),me,case when p_mode='race' then null else me end,null,null,false,false,false,null,clock_timestamp())
 on conflict(conversation_id) do update set round_id=excluded.round_id,mode=excluded.mode,board=excluded.board,started_by=excluded.started_by,next_player=excluded.next_player,last_player=null,winner=null,finished=false,ready_a=false,ready_b=false,ready_at=null,updated_at=excluded.updated_at returning * into r;
 perform public.open_activity(p_conversation,'arcade');
 return r;
end $$;
create or replace function public.play_live_arcade(p_conversation uuid,p_round uuid,p_action text,p_cell integer default null) returns public.live_arcade language plpgsql security definer set search_path='' as $$
declare r public.live_arcade; me uuid:=auth.uid(); a uuid; b uuid; other uuid; token text; pos integer; rr integer; cc integer; dr integer; dc integer; k integer; win boolean:=false; line boolean;
begin
 if me is null or not private.is_member(p_conversation) then raise exception 'Game unavailable.'; end if;
 select member_a,member_b into a,b from public.conversations where id=p_conversation and kind='direct';
 if me is distinct from a and me is distinct from b then raise exception 'Game unavailable.'; end if;
 other:=case when me=a then b else a end; token:=case when me=a then 'A' else 'B' end;
 select * into r from public.live_arcade where conversation_id=p_conversation for update;
 if r.conversation_id is null or r.finished or r.round_id is distinct from p_round then raise exception 'Game is over.'; end if;
 if p_action='end' then r.finished:=true;
 elsif r.mode='race' and p_action='ready' then
  if me=a then r.ready_a:=true; else r.ready_b:=true; end if;
  if r.ready_a and r.ready_b and r.ready_at is null then r.ready_at:=clock_timestamp()+interval '3 seconds'; end if;
 elsif r.mode='race' and p_action='tap' then
  if r.ready_at is null or clock_timestamp()<r.ready_at then raise exception 'Wait for GO.'; end if;
  r.winner:=me; r.finished:=true; r.last_player:=me;
 elsif r.mode='four' and p_action='move' then
  if r.next_player<>me then raise exception 'Wait for your turn.'; end if;
  if p_cell is null or p_cell<0 or p_cell>6 then raise exception 'Choose a column.'; end if;
  pos:=null;
  for rr in reverse 5..0 loop if substring(r.board from rr*7+p_cell+1 for 1)='-' then pos:=rr*7+p_cell+1; exit; end if; end loop;
  if pos is null then raise exception 'Column is full.'; end if;
  r.board:=overlay(r.board placing token from pos for 1); r.last_player:=me; r.next_player:=other;
  for rr in 0..5 loop for cc in 0..6 loop
   for dr in -1..1 loop for dc in 0..1 loop
    if (dr<>0 or dc<>0) and rr+3*dr between 0 and 5 and cc+3*dc between 0 and 6 then
     line:=true; for k in 0..3 loop if substring(r.board from (rr+k*dr)*7+cc+k*dc+1 for 1)<>token then line:=false; exit; end if; end loop;
     if line then win:=true; end if;
    end if;
   end loop; end loop;
  end loop; end loop;
  if win then r.finished:=true; r.winner:=me; elsif position('-' in r.board)=0 then r.finished:=true; end if;
 elsif r.mode='garden' and p_action='move' then
  if r.next_player<>me then raise exception 'Wait for your turn.'; end if;
  if p_cell is null or p_cell<0 or p_cell>15 or substring(r.board from p_cell+1 for 1)<>'-' then raise exception 'Choose an empty spot.'; end if;
  r.board:=overlay(r.board placing token from p_cell+1 for 1);r.last_player:=me;r.next_player:=other;
  if position('-' in r.board)=0 then r.finished:=true; end if;
 else raise exception 'Unknown move.'; end if;
 update public.live_arcade set board=r.board,next_player=r.next_player,last_player=r.last_player,winner=r.winner,finished=r.finished,ready_a=r.ready_a,ready_b=r.ready_b,ready_at=r.ready_at,updated_at=clock_timestamp() where conversation_id=p_conversation returning * into r;
 return r;
end $$;
revoke all on function public.start_live_arcade(uuid,text),public.play_live_arcade(uuid,uuid,text,integer) from public,anon;
grant execute on function public.start_live_arcade(uuid,text),public.play_live_arcade(uuid,uuid,text,integer) to authenticated;
do $$ begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_arcade') then alter publication supabase_realtime add table public.live_arcade; end if; end $$;

notify pgrst,'reload schema';
commit;
begin;
-- A shared timeline referencing a chat audio message; no audio is copied.
create table if not exists public.shared_listening (
 conversation_id uuid primary key references public.conversations(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 playing boolean not null default false,
 position double precision not null default 0 check(position>=0 and position<=86400),
 changed_at timestamptz not null default clock_timestamp(),
 changed_by uuid not null references public.profiles(id)
);
alter table public.shared_listening enable row level security;
revoke all on public.shared_listening from public,anon,authenticated;
grant select on public.shared_listening to authenticated;
grant all on public.shared_listening to service_role;
drop policy if exists shared_listening_read on public.shared_listening;
create policy shared_listening_read on public.shared_listening for select to authenticated using(private.is_member(conversation_id));
create or replace function public.control_listening(p_conversation uuid,p_action text,p_message uuid default null,p_position double precision default null) returns public.shared_listening language plpgsql security definer set search_path='' as $$
declare r public.shared_listening; me uuid:=auth.uid();
begin
 if me is null or not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id=p_conversation and kind='direct') then raise exception 'Listening unavailable.'; end if;
 if p_action='start' then
  if not exists(select 1 from public.messages m where m.id=p_message and m.conversation_id=p_conversation and m.media_kind='audio' and m.media_url is not null and m.created_at>clock_timestamp()-interval '24 hours' and m.created_at>private.visible_after(p_conversation)) then raise exception 'Audio unavailable.'; end if;
  insert into public.shared_listening as s(conversation_id,message_id,playing,position,changed_at,changed_by) values(p_conversation,p_message,false,0,clock_timestamp(),me)
  on conflict(conversation_id) do update set message_id=excluded.message_id,playing=false,position=0,changed_at=excluded.changed_at,changed_by=me returning * into r;
  perform public.open_activity(p_conversation,'listen');
 elsif p_action in ('play','pause') then
  select * into r from public.shared_listening where conversation_id=p_conversation for update;
  if r.message_id is null or r.message_id is distinct from p_message then raise exception 'Audio changed. Rejoin the session.'; end if;
  if not exists(select 1 from public.messages m where m.id=r.message_id and m.conversation_id=p_conversation and m.media_kind='audio' and m.media_url is not null and m.created_at>clock_timestamp()-interval '24 hours' and m.created_at>private.visible_after(p_conversation)) then raise exception 'Audio unavailable.'; end if;
  if p_position is null or p_position<0 or p_position>86400 or p_position::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid position.'; end if;
  update public.shared_listening set playing=(p_action='play'),position=p_position,changed_at=clock_timestamp(),changed_by=me where conversation_id=p_conversation returning * into r;
 else raise exception 'Unknown action.'; end if;
 return r;
end $$;
revoke all on function public.control_listening(uuid,text,uuid,double precision) from public,anon;
grant execute on function public.control_listening(uuid,text,uuid,double precision) to authenticated;
do $$ begin if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shared_listening') then alter publication supabase_realtime add table public.shared_listening; end if; end $$;

notify pgrst,'reload schema';
commit;
begin;
-- Public to signed-in users, except between people who have blocked each other.
create table if not exists public.stories (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 body text not null default '' check(char_length(body)<=280),
 media_path text,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '24 hours'),
 deleted_at timestamptz,
 check(length(btrim(body))>0 or media_path is not null)
);
create index if not exists stories_latest_idx on public.stories(created_at desc) where deleted_at is null;
alter table public.stories enable row level security;
revoke all on public.stories from public,anon,authenticated;
grant select on public.stories to authenticated;
grant all on public.stories to service_role;
drop policy if exists stories_read on public.stories;
create policy stories_read on public.stories for select to authenticated using(deleted_at is null and expires_at>now() and (user_id=auth.uid() or not private.blocked(auth.uid(),user_id)));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('story-media','story-media',false,5242880,array['image/webp','image/jpeg','image/png']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create or replace function private.story_media_read(p_name text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.stories s where s.media_path=p_name and s.deleted_at is null and s.expires_at>now() and (s.user_id=auth.uid() or not private.blocked(auth.uid(),s.user_id)));
$$;
revoke all on function private.story_media_read(text) from public,anon;
grant execute on function private.story_media_read(text) to authenticated;
drop policy if exists story_media_read on storage.objects;
create policy story_media_read on storage.objects for select to authenticated using(bucket_id='story-media' and private.story_media_read(name));
drop policy if exists story_media_insert on storage.objects;
create policy story_media_insert on storage.objects for insert to authenticated with check(bucket_id='story-media' and split_part(name,'/',1)=auth.uid()::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$');
drop policy if exists story_media_read_gate on storage.objects;
create policy story_media_read_gate on storage.objects as restrictive for select to authenticated using(bucket_id<>'story-media' or private.story_media_read(name));
drop policy if exists story_media_insert_gate on storage.objects;
create policy story_media_insert_gate on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'story-media' or (split_part(name,'/',1)=auth.uid()::text and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'));
drop policy if exists story_media_update_gate on storage.objects;
create policy story_media_update_gate on storage.objects as restrictive for update to authenticated using(bucket_id<>'story-media') with check(bucket_id<>'story-media');
drop policy if exists story_media_delete_gate on storage.objects;
create policy story_media_delete_gate on storage.objects as restrictive for delete to authenticated using(bucket_id<>'story-media');
drop policy if exists story_media_anon_gate on storage.objects;
create policy story_media_anon_gate on storage.objects as restrictive for all to anon using(bucket_id<>'story-media') with check(bucket_id<>'story-media');
create or replace function public.post_story(p_body text default '',p_media text default null) returns public.stories language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); r public.stories; clean text:=btrim(coalesce(p_body,''));
begin
 if me is null then raise exception 'Sign in first.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text,218));
 if char_length(clean)>280 or (clean='' and p_media is null) then raise exception 'Add text or a photo.'; end if;
 if (select count(*) from public.stories where user_id=me and created_at>now()-interval '24 hours')>=20 then raise exception 'Story limit reached for today.'; end if;
 if p_media is not null and not exists(select 1 from storage.objects o where o.bucket_id='story-media' and o.name=p_media and split_part(o.name,'/',1)=me::text and o.created_at>now()-interval '1 hour' and not exists(select 1 from public.stories s where s.media_path=p_media)) then raise exception 'Photo unavailable.'; end if;
 insert into public.stories(user_id,body,media_path) values(me,clean,p_media) returning * into r;
 return r;
end $$;
create or replace function public.delete_story(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.stories set deleted_at=clock_timestamp() where id=p_id and user_id=auth.uid() and deleted_at is null;
 if not found then raise exception 'Story unavailable.'; end if;
end $$;
revoke all on function public.post_story(text,text),public.delete_story(uuid) from public,anon;
grant execute on function public.post_story(text,text),public.delete_story(uuid) to authenticated;
-- Extend the existing storage worker; objects never bypass the Storage API.
create or replace function public.get_media_cleanup_batch()
returns table(bucket_id text,object_path text) language plpgsql security definer set search_path='' as $$
begin
  insert into private.media_cleanup_jobs(bucket_id,object_path)
  select o.bucket_id,o.name from storage.objects o where
    (o.bucket_id='chat-media' and o.created_at<now()-interval '24 hours') or
    (o.bucket_id='instant-media' and (o.created_at<now()-interval '24 hours' or exists(select 1 from private.instant_payloads p where p.media_url=o.name and p.claimed_at is not null and not p.allow_replay))) or
    (o.bucket_id='capsule-media' and (exists(select 1 from private.capsule_payloads p join public.capsules c on c.id=p.capsule_id where p.media_url=o.name and c.unlock_at<now()-interval '24 hours') or (o.created_at<now()-interval '24 hours' and not exists(select 1 from private.capsule_payloads p where p.media_url=o.name)))) or
    (o.bucket_id='avatars' and o.created_at<now()-interval '24 hours' and not exists(select 1 from public.profiles p where p.avatar_url=o.name)) or
    (o.bucket_id='story-media' and (exists(select 1 from public.stories s where s.media_path=o.name and (s.deleted_at is not null or s.expires_at<=now())) or (o.created_at<now()-interval '1 hour' and not exists(select 1 from public.stories s where s.media_path=o.name))))
  limit 1000 on conflict do nothing;
  delete from public.stories where created_at<now()-interval '48 hours';
  return query select j.bucket_id,j.object_path from private.media_cleanup_jobs j order by j.attempts,j.created_at limit 100;
end $$;
notify pgrst,'reload schema';
commit;
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
begin;
alter table public.live_arcade drop constraint if exists live_arcade_mode_check;
alter table public.live_arcade add constraint live_arcade_mode_check check(mode in ('four','garden','race','grid'));
create or replace function public.start_live_arcade(p_conversation uuid,p_mode text) returns public.live_arcade language plpgsql security definer set search_path='' as $$
declare r public.live_arcade; me uuid:=auth.uid();
begin
 if me is null or not private.is_member(p_conversation) or not exists(select 1 from public.conversations where id=p_conversation and kind='direct' and member_a is not null and member_b is not null) or p_mode is null or p_mode not in ('four','garden','race','grid') then raise exception 'Game unavailable.'; end if;
 perform 1 from public.conversations where id=p_conversation for update;
 select * into r from public.live_arcade where conversation_id=p_conversation;
 if r.conversation_id is not null and not r.finished then raise exception 'End the current game first.'; end if;
 insert into public.live_arcade as a(conversation_id,round_id,mode,board,started_by,next_player,last_player,winner,finished,ready_a,ready_b,ready_at,updated_at)
 values(p_conversation,gen_random_uuid(),p_mode,repeat('-',case when p_mode='four' then 42 when p_mode='garden' then 16 when p_mode='grid' then 25 else 1 end),me,case when p_mode='race' then null else me end,null,null,false,false,false,null,clock_timestamp())
 on conflict(conversation_id) do update set round_id=excluded.round_id,mode=excluded.mode,board=excluded.board,started_by=excluded.started_by,next_player=excluded.next_player,last_player=null,winner=null,finished=false,ready_a=false,ready_b=false,ready_at=null,updated_at=excluded.updated_at returning * into r;
 perform public.open_activity(p_conversation,'arcade');
 return r;
end $$;
create or replace function public.play_live_arcade(p_conversation uuid,p_round uuid,p_action text,p_cell integer default null) returns public.live_arcade language plpgsql security definer set search_path='' as $$
declare r public.live_arcade; me uuid:=auth.uid(); a uuid; b uuid; other uuid; token text; pos integer; rr integer; cc integer; dr integer; dc integer; k integer; win boolean:=false; line boolean;
begin
 if me is null or not private.is_member(p_conversation) then raise exception 'Game unavailable.'; end if;
 select member_a,member_b into a,b from public.conversations where id=p_conversation and kind='direct';
 if me is distinct from a and me is distinct from b then raise exception 'Game unavailable.'; end if;
 other:=case when me=a then b else a end; token:=case when me=a then 'A' else 'B' end;
 select * into r from public.live_arcade where conversation_id=p_conversation for update;
 if r.conversation_id is null or r.finished or r.round_id is distinct from p_round then raise exception 'Game is over.'; end if;
 if p_action='end' then r.finished:=true;
 elsif r.mode='race' and p_action='ready' then
  if me=a then r.ready_a:=true; else r.ready_b:=true; end if;
  if r.ready_a and r.ready_b and r.ready_at is null then r.ready_at:=clock_timestamp()+interval '3 seconds'; end if;
 elsif r.mode='race' and p_action='tap' then
  if r.ready_at is null or clock_timestamp()<r.ready_at then raise exception 'Wait for GO.'; end if;
  r.winner:=me; r.finished:=true; r.last_player:=me;
 elsif r.mode='four' and p_action='move' then
  if r.next_player<>me then raise exception 'Wait for your turn.'; end if;
  if p_cell is null or p_cell<0 or p_cell>6 then raise exception 'Choose a column.'; end if;
  pos:=null;
  for rr in reverse 5..0 loop if substring(r.board from rr*7+p_cell+1 for 1)='-' then pos:=rr*7+p_cell+1; exit; end if; end loop;
  if pos is null then raise exception 'Column is full.'; end if;
  r.board:=overlay(r.board placing token from pos for 1); r.last_player:=me; r.next_player:=other;
  for rr in 0..5 loop for cc in 0..6 loop
   for dr in -1..1 loop for dc in 0..1 loop
    if (dr<>0 or dc<>0) and rr+3*dr between 0 and 5 and cc+3*dc between 0 and 6 then
     line:=true; for k in 0..3 loop if substring(r.board from (rr+k*dr)*7+cc+k*dc+1 for 1)<>token then line:=false; exit; end if; end loop;
     if line then win:=true; end if;
    end if;
   end loop; end loop;
  end loop; end loop;
  if win then r.finished:=true; r.winner:=me; elsif position('-' in r.board)=0 then r.finished:=true; end if;
 elsif r.mode='grid' and p_action='move' then
  if r.next_player<>me then raise exception 'Wait for your turn.'; end if;
  if p_cell is null or p_cell<0 or p_cell>24 or substring(r.board from p_cell+1 for 1)<>'-' then raise exception 'Choose an empty spot.'; end if;
  r.board:=overlay(r.board placing token from p_cell+1 for 1);r.last_player:=me;r.next_player:=other;
  for rr in 0..4 loop for cc in 0..4 loop
   for dr in -1..1 loop for dc in 0..1 loop
    if (dr<>0 or dc<>0) and rr+3*dr between 0 and 4 and cc+3*dc between 0 and 4 then
     line:=true; for k in 0..3 loop if substring(r.board from (rr+k*dr)*5+cc+k*dc+1 for 1)<>token then line:=false; exit; end if; end loop;
     if line then win:=true; end if;
    end if;
   end loop; end loop;
  end loop; end loop;
  if win then r.finished:=true;r.winner:=me; elsif position('-' in r.board)=0 then r.finished:=true; end if;
 elsif r.mode='garden' and p_action='move' then
  if r.next_player<>me then raise exception 'Wait for your turn.'; end if;
  if p_cell is null or p_cell<0 or p_cell>15 or substring(r.board from p_cell+1 for 1)<>'-' then raise exception 'Choose an empty spot.'; end if;
  r.board:=overlay(r.board placing token from p_cell+1 for 1);r.last_player:=me;r.next_player:=other;
  if position('-' in r.board)=0 then r.finished:=true; end if;
 else raise exception 'Unknown move.'; end if;
 update public.live_arcade set board=r.board,next_player=r.next_player,last_player=r.last_player,winner=r.winner,finished=r.finished,ready_a=r.ready_a,ready_b=r.ready_b,ready_at=r.ready_at,updated_at=clock_timestamp() where conversation_id=p_conversation returning * into r;
 return r;
end $$;
revoke all on function public.start_live_arcade(uuid,text),public.play_live_arcade(uuid,uuid,text,integer) from public,anon;
grant execute on function public.start_live_arcade(uuid,text),public.play_live_arcade(uuid,uuid,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
