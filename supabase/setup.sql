-- ===========================================================================
-- BitchAt — complete Supabase schema (v2: media, reactions, presence, plans,
-- love notes, games, and web push).
--
-- Rerunnable: every statement is idempotent, so you can paste this whole file
-- into the Supabase SQL editor again after pulling new code and it will simply
-- add whatever is missing without destroying your data.
--
-- God-mode bootstrap: the FIRST account ever created is automatically promoted
-- to admin. Sign up first so that's you.
-- ===========================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- True when the signed-in user is an admin. SECURITY DEFINER so policies that
-- call it don't recurse into profiles' own RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role = 'admin'
  );
$$;

create or replace function public.is_member(target_group uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_members.group_id = target_group
      and group_members.user_id = auth.uid()
  );
$$;

-- True when the caller shares at least one group with the target user. Used to
-- let people discover profiles of the folks they actually chat with, without
-- exposing the whole user directory.
create or replace function public.shares_group_with(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid()
      and theirs.user_id = target_user
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_member(uuid) from public;
revoke all on function public.shares_group_with(uuid) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  role text not null default 'user',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists accent text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists couple_role text;
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists notification_sound text;
alter table public.profiles add column if not exists theme text;

alter table public.profiles
  drop constraint if exists profiles_username_length,
  drop constraint if exists profiles_username_format,
  drop constraint if exists profiles_role_valid,
  drop constraint if exists profiles_couple_role_valid;

alter table public.profiles
  add constraint profiles_username_length check (char_length(username) between 1 and 32),
  add constraint profiles_username_format check (username ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  add constraint profiles_role_valid check (role in ('admin', 'user')),
  add constraint profiles_couple_role_valid check (couple_role is null or couple_role in ('kitten', 'dada'));

-- ---------------------------------------------------------------------------
-- Groups (admins create them; everyone can create a 1:1 "direct" chat)
-- ---------------------------------------------------------------------------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  is_direct boolean not null default false,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.groups add column if not exists name text;
alter table public.groups add column if not exists description text;
alter table public.groups add column if not exists created_by uuid;
alter table public.groups add column if not exists is_direct boolean not null default false;
alter table public.groups add column if not exists avatar_url text;
alter table public.groups add column if not exists created_at timestamptz not null default now();

alter table public.groups drop constraint if exists groups_name_length;
alter table public.groups
  add constraint groups_name_length check (char_length(name) between 1 and 60);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  primary key (group_id, user_id)
);

alter table public.group_members add column if not exists last_read_at timestamptz not null default now();
alter table public.group_members add column if not exists muted boolean not null default false;

create index if not exists group_members_user_id_idx on public.group_members (user_id);
create index if not exists group_members_group_id_idx on public.group_members (group_id);

-- ---------------------------------------------------------------------------
-- Messages (text + image / video / audio / sticker)
-- ---------------------------------------------------------------------------

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists group_id uuid;
alter table public.messages add column if not exists user_id uuid;
alter table public.messages add column if not exists content text not null default '';
alter table public.messages add column if not exists created_at timestamptz not null default now();
alter table public.messages add column if not exists kind text not null default 'text';
alter table public.messages add column if not exists media_url text;
alter table public.messages add column if not exists media_type text;
alter table public.messages add column if not exists media_width integer;
alter table public.messages add column if not exists media_height integer;
alter table public.messages add column if not exists media_bytes bigint;
alter table public.messages add column if not exists duration_seconds integer;
alter table public.messages add column if not exists reply_to_id uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;

drop policy if exists "Members can create their own messages" on public.messages;

alter table public.messages
  drop constraint if exists messages_content_length,
  drop constraint if exists messages_content_not_blank,
  drop constraint if exists messages_kind_valid,
  drop constraint if exists messages_has_payload;

update public.messages
  set content = '(message removed)'
  where content is null or btrim(content) = '';

alter table public.messages alter column content set default '';
alter table public.messages alter column content set not null;

alter table public.messages
  add constraint messages_content_length check (char_length(content) <= 4000),
  add constraint messages_kind_valid check (kind in ('text', 'image', 'video', 'audio', 'sticker')),
  add constraint messages_has_payload check (
    btrim(content) <> '' or media_url is not null
  );

create index if not exists messages_group_created_id_idx
  on public.messages (group_id, created_at desc, id desc);
create index if not exists messages_user_id_idx on public.messages (user_id);

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.message_reactions
  drop constraint if exists message_reactions_emoji_length;
alter table public.message_reactions
  add constraint message_reactions_emoji_length check (char_length(emoji) between 1 and 16);

-- ---------------------------------------------------------------------------
-- Read receipts
-- ---------------------------------------------------------------------------

create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_reads_message_id_idx on public.message_reads (message_id);

-- ---------------------------------------------------------------------------
-- Typing indicators + presence (Realtime broadcast is primary; these tables
-- provide a durable fallback on flaky connections)
-- ---------------------------------------------------------------------------

create table if not exists public.typing_indicators (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  last_active_at timestamptz not null default now()
);

create index if not exists presence_group_idx on public.presence (group_id);

-- ---------------------------------------------------------------------------
-- Couple plans (scheduled dates / calls / trips)
-- ---------------------------------------------------------------------------

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  notes text,
  category text not null default 'date',
  starts_at timestamptz not null,
  duration_minutes integer,
  location text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  completed boolean not null default false,
  notified boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.plans add column if not exists notified boolean not null default false;
alter table public.plans add column if not exists completed boolean not null default false;
alter table public.plans add column if not exists location text;

alter table public.plans
  drop constraint if exists plans_category_valid,
  drop constraint if exists plans_title_length;
alter table public.plans
  add constraint plans_title_length check (char_length(title) between 1 and 120);
alter table public.plans
  add constraint plans_category_valid
  check (category in ('date', 'trip', 'call', 'movie', 'game', 'other'));

create index if not exists plans_group_starts_idx on public.plans (group_id, starts_at);

-- ---------------------------------------------------------------------------
-- Love notes / daily prompts
-- ---------------------------------------------------------------------------

create table if not exists public.love_notes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  prompt text,
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.love_notes
  drop constraint if exists love_notes_body_length;
alter table public.love_notes
  add constraint love_notes_body_length check (char_length(body) between 1 and 2000);

create index if not exists love_notes_group_idx
  on public.love_notes (group_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Multiplayer couple games
-- ---------------------------------------------------------------------------

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  kind text not null,
  state jsonb not null default '{}'::jsonb,
  turn_user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'active',
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.game_sessions
  drop constraint if exists game_sessions_kind_valid;
alter table public.game_sessions
  add constraint game_sessions_kind_valid check (
    kind in ('would_you_rather', 'this_or_that', 'truth_or_dare', 'two_truths', 'tictactoe', 'connect4')
  );

alter table public.game_sessions drop constraint if exists game_sessions_status_valid;
alter table public.game_sessions
  add constraint game_sessions_status_valid check (status in ('active', 'finished'));

create index if not exists game_sessions_group_idx
  on public.game_sessions (group_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Push notification subscriptions (one row per device)
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

-- Tracks which messages a device has already been notified about, so the
-- "you have unread messages" nudge never fires twice for the same message.
create table if not exists public.push_deliveries (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- ---------------------------------------------------------------------------
-- New-user bootstrap: first account ever created becomes admin (god mode).
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  final_username text;
  is_first_account boolean;
begin
  requested_username := lower(
    coalesce(
      nullif(new.raw_user_meta_data ->> 'username', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    )
  );

  requested_username := regexp_replace(requested_username, '[^a-z0-9._-]', '', 'g');
  requested_username := left(requested_username, 32);

  if requested_username is null or requested_username = '' then
    requested_username := 'user_' || substr(new.id::text, 1, 8);
  end if;

  final_username := requested_username;

  if exists (
    select 1 from public.profiles
    where username = final_username and id <> new.id
  ) then
    final_username := left(requested_username, 23) || '_' || substr(new.id::text, 1, 8);
  end if;

  select not exists (select 1 from public.profiles) into is_first_account;

  insert into public.profiles (id, username, role, display_name)
  values (
    new.id,
    final_username,
    case when is_first_account then 'admin' else 'user' end,
    final_username
  )
  on conflict (id) do update set username = excluded.username;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep game_sessions.updated_at fresh so clients can order live sessions.
create or replace function public.touch_game_session()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists game_sessions_touch on public.game_sessions;
create trigger game_sessions_touch
  before update on public.game_sessions
  for each row execute function public.touch_game_session();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_reads enable row level security;
alter table public.typing_indicators enable row level security;
alter table public.presence enable row level security;
alter table public.plans enable row level security;
alter table public.love_notes enable row level security;
alter table public.game_sessions enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;

alter table public.messages replica identity full;
alter table public.message_reactions replica identity full;
alter table public.game_sessions replica identity full;
alter table public.typing_indicators replica identity full;
alter table public.plans replica identity full;

-- Drop the old policy set so reruns always land on the current rules.
drop policy if exists "Authenticated members can read profiles" on public.profiles;
drop policy if exists "Profiles are readable by signed-in users" on public.profiles;
drop policy if exists "Users update their own profile" on public.profiles;
drop policy if exists "Members can read their groups" on public.groups;
drop policy if exists "Members can read their group memberships" on public.group_members;
drop policy if exists "Members can update their own membership" on public.group_members;
drop policy if exists "Authenticated members can read messages" on public.messages;
drop policy if exists "Members can read messages in their groups" on public.messages;
drop policy if exists "Members can create their own messages" on public.messages;
drop policy if exists "Members can edit their own messages" on public.messages;
drop policy if exists "Members can delete their own messages" on public.messages;

-- Profiles: read your own + people you share a group with + everyone if admin.
create policy "Profiles are readable by signed-in users"
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or public.shares_group_with(profiles.id)
  or public.is_admin()
);

create policy "Users update their own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Groups: members + admins.
create policy "Members can read their groups"
on public.groups for select to authenticated
using (public.is_member(groups.id) or public.is_admin());

-- Memberships: your own rows, your groups' rows, admins see everything.
create policy "Members can read their group memberships"
on public.group_members for select to authenticated
using (
  user_id = (select auth.uid())
  or public.is_member(group_members.group_id)
  or public.is_admin()
);

create policy "Members can update their own membership"
on public.group_members for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Messages.
create policy "Members can read messages in their groups"
on public.messages for select to authenticated
using (public.is_member(messages.group_id) or public.is_admin());

create policy "Members can create their own messages"
on public.messages for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_member(messages.group_id)
  and (btrim(content) <> '' or media_url is not null)
);

create policy "Members can edit their own messages"
on public.messages for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Members can delete their own messages"
on public.messages for delete to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

-- Reactions.
drop policy if exists "Members read reactions" on public.message_reactions;
drop policy if exists "Members add their own reactions" on public.message_reactions;
drop policy if exists "Members remove their own reactions" on public.message_reactions;

create policy "Members read reactions"
on public.message_reactions for select to authenticated
using (
  exists (
    select 1 from public.messages
    where messages.id = message_reactions.message_id
      and (public.is_member(messages.group_id) or public.is_admin())
  )
);

create policy "Members add their own reactions"
on public.message_reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.messages
    where messages.id = message_reactions.message_id
      and public.is_member(messages.group_id)
  )
);

create policy "Members remove their own reactions"
on public.message_reactions for delete to authenticated
using (user_id = (select auth.uid()));

-- Read receipts.
drop policy if exists "Members read receipts" on public.message_reads;
drop policy if exists "Members record their own reads" on public.message_reads;

create policy "Members read receipts"
on public.message_reads for select to authenticated
using (public.is_admin() or exists (
  select 1 from public.messages
  where messages.id = message_reads.message_id
    and public.is_member(messages.group_id)
));

create policy "Members record their own reads"
on public.message_reads for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.messages
    where messages.id = message_reads.message_id
      and public.is_member(messages.group_id)
  )
);

-- Typing + presence.
drop policy if exists "Members read typing" on public.typing_indicators;
drop policy if exists "Members write their own typing" on public.typing_indicators;
drop policy if exists "Members update their own typing" on public.typing_indicators;
drop policy if exists "Members delete their own typing" on public.typing_indicators;

create policy "Members read typing"
on public.typing_indicators for select to authenticated
using (public.is_member(typing_indicators.group_id) or public.is_admin());

create policy "Members write their own typing"
on public.typing_indicators for insert to authenticated
with check (
  user_id = (select auth.uid()) and public.is_member(typing_indicators.group_id)
);

create policy "Members update their own typing"
on public.typing_indicators for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Members delete their own typing"
on public.typing_indicators for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Members read presence" on public.presence;
drop policy if exists "Members write their own presence" on public.presence;
drop policy if exists "Members update their own presence" on public.presence;

create policy "Members read presence"
on public.presence for select to authenticated
using (true);

create policy "Members write their own presence"
on public.presence for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Members update their own presence"
on public.presence for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Plans.
drop policy if exists "Members read plans" on public.plans;
drop policy if exists "Members create plans" on public.plans;
drop policy if exists "Members edit plans" on public.plans;
drop policy if exists "Members delete plans" on public.plans;

create policy "Members read plans"
on public.plans for select to authenticated
using (public.is_member(plans.group_id) or public.is_admin());

create policy "Members create plans"
on public.plans for insert to authenticated
with check (created_by = (select auth.uid()) and public.is_member(plans.group_id));

create policy "Members edit plans"
on public.plans for update to authenticated
using (public.is_member(plans.group_id))
with check (public.is_member(plans.group_id));

create policy "Members delete plans"
on public.plans for delete to authenticated
using (created_by = (select auth.uid()) or public.is_admin());

-- Love notes.
drop policy if exists "Members read love notes" on public.love_notes;
drop policy if exists "Members write love notes" on public.love_notes;
drop policy if exists "Members delete their love notes" on public.love_notes;

create policy "Members read love notes"
on public.love_notes for select to authenticated
using (public.is_member(love_notes.group_id) or public.is_admin());

create policy "Members write love notes"
on public.love_notes for insert to authenticated
with check (user_id = (select auth.uid()) and public.is_member(love_notes.group_id));

create policy "Members delete their love notes"
on public.love_notes for delete to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

-- Games.
drop policy if exists "Members read games" on public.game_sessions;
drop policy if exists "Members create games" on public.game_sessions;
drop policy if exists "Members update games" on public.game_sessions;
drop policy if exists "Members delete games" on public.game_sessions;

create policy "Members read games"
on public.game_sessions for select to authenticated
using (public.is_member(game_sessions.group_id) or public.is_admin());

create policy "Members create games"
on public.game_sessions for insert to authenticated
with check (created_by = (select auth.uid()) and public.is_member(game_sessions.group_id));

create policy "Members update games"
on public.game_sessions for update to authenticated
using (public.is_member(game_sessions.group_id))
with check (public.is_member(game_sessions.group_id));

create policy "Members delete games"
on public.game_sessions for delete to authenticated
using (created_by = (select auth.uid()) or public.is_admin());

-- Push subscriptions: a user manages only their own devices. The server sends
-- with the service-role key, which bypasses RLS.
drop policy if exists "Users read own push subscriptions" on public.push_subscriptions;
drop policy if exists "Users add own push subscriptions" on public.push_subscriptions;
drop policy if exists "Users update own push subscriptions" on public.push_subscriptions;
drop policy if exists "Users delete own push subscriptions" on public.push_subscriptions;

create policy "Users read own push subscriptions"
on public.push_subscriptions for select to authenticated
using (user_id = (select auth.uid()));

create policy "Users add own push subscriptions"
on public.push_subscriptions for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users update own push subscriptions"
on public.push_subscriptions for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users delete own push subscriptions"
on public.push_subscriptions for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users read own deliveries" on public.push_deliveries;
create policy "Users read own deliveries"
on public.push_deliveries for select to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants (RLS still applies on top of these)
-- ---------------------------------------------------------------------------

revoke all on table public.profiles from anon;
revoke all on table public.groups from anon;
revoke all on table public.group_members from anon;
revoke all on table public.messages from anon;

grant usage on schema public to authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url, accent, bio, couple_role, last_seen_at, notification_sound, theme)
  on public.profiles to authenticated;

grant select on table public.groups to authenticated;
grant select, update (last_read_at, muted) on table public.group_members to authenticated;

grant select, delete on table public.messages to authenticated;
grant insert (id, group_id, user_id, content, kind, media_url, media_type,
              media_width, media_height, media_bytes, duration_seconds, reply_to_id, created_at)
  on public.messages to authenticated;
grant update (content, edited_at) on public.messages to authenticated;

grant select, delete on table public.message_reactions to authenticated;
grant insert (message_id, user_id, emoji) on public.message_reactions to authenticated;

grant select on table public.message_reads to authenticated;
grant insert (message_id, user_id, read_at) on public.message_reads to authenticated;

grant select, delete on table public.typing_indicators to authenticated;
grant insert (group_id, user_id, updated_at) on public.typing_indicators to authenticated;
grant update (updated_at) on public.typing_indicators to authenticated;

grant select on table public.presence to authenticated;
grant insert (user_id, group_id, last_active_at) on public.presence to authenticated;
grant update (group_id, last_active_at) on public.presence to authenticated;

grant select, delete on table public.plans to authenticated;
grant insert (group_id, title, notes, category, starts_at, duration_minutes, location, created_by)
  on public.plans to authenticated;
grant update (title, notes, category, starts_at, duration_minutes, location, completed)
  on public.plans to authenticated;

grant select, delete on table public.love_notes to authenticated;
grant insert (group_id, user_id, prompt, body) on public.love_notes to authenticated;

grant select, delete on table public.game_sessions to authenticated;
grant insert (id, group_id, kind, state, turn_user_id, created_by, title, status, created_at)
  on public.game_sessions to authenticated;
grant update (state, turn_user_id, status, title) on public.game_sessions to authenticated;

grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant select on table public.push_deliveries to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: chat media bucket + policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  true,
  52428800, -- 50 MB
  array['image/jpeg','image/png','image/webp','image/gif','image/avif',
        'video/mp4','video/webm','video/quicktime','audio/webm','audio/mpeg',
        'audio/mp4','audio/ogg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Chat media is publicly readable" on storage.objects;
drop policy if exists "Signed-in users upload chat media" on storage.objects;
drop policy if exists "Uploaders manage their chat media" on storage.objects;

create policy "Chat media is publicly readable"
on storage.objects for select
using (bucket_id = 'chat-media');

create policy "Signed-in users upload chat media"
on storage.objects for insert to authenticated
with check (bucket_id = 'chat-media' and owner = (select auth.uid())::text);

create policy "Uploaders manage their chat media"
on storage.objects for delete to authenticated
using (bucket_id = 'chat-media' and owner = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array[
    'messages', 'message_reactions', 'message_reads', 'typing_indicators',
    'plans', 'game_sessions', 'love_notes', 'group_members', 'groups'
  ]
  loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = target
       )
    then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end;
$$;

commit;
