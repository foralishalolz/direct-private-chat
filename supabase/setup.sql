-- Direct — private multi-group chat (text + media, couples, games):
-- complete Supabase schema. This script is intentionally rerunnable.
--
-- God mode bootstrap: the FIRST account ever created (via /api/signup, using
-- your SIGNUP_INVITE_CODE) is automatically made an admin ("god user"). Every
-- account after that is a regular user. Sign up first, right after running
-- this script, so you become the admin.
--
-- Sections:
--   1. Profiles
--   2. Groups + memberships
--   3. Messages (text + image/video media)
--   4. New-user bootstrap (first account = admin)
--   5. Row Level Security
--   6. Push subscriptions (web-push)
--   7. Couples (members, plans, games)
--   8. Storage bucket chat-media
--   9. Realtime publication

begin;

create extension if not exists pgcrypto;

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

alter table public.profiles
  drop constraint if exists profiles_username_length,
  drop constraint if exists profiles_username_format,
  drop constraint if exists profiles_role_valid;

alter table public.profiles
  add constraint profiles_username_length check (char_length(username) between 1 and 32),
  add constraint profiles_username_format check (username ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  add constraint profiles_role_valid check (role in ('admin', 'user'));

-- ---------------------------------------------------------------------------
-- Groups (created only by the admin)
-- ---------------------------------------------------------------------------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.groups add column if not exists name text;
alter table public.groups add column if not exists description text;
alter table public.groups add column if not exists created_by uuid;
alter table public.groups add column if not exists created_at timestamptz not null default now();

alter table public.groups
  drop constraint if exists groups_name_length;

alter table public.groups
  add constraint groups_name_length check (char_length(name) between 1 and 60);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_id_idx
  on public.group_members (user_id);

create index if not exists group_members_group_id_idx
  on public.group_members (group_id);

-- ---------------------------------------------------------------------------
-- Messages (text + optional image/video media)
-- ---------------------------------------------------------------------------

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  media_url text,
  media_type text,
  media_name text,
  media_size bigint,
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists group_id uuid;
alter table public.messages add column if not exists user_id uuid;
alter table public.messages add column if not exists content text;
alter table public.messages add column if not exists media_url text;
alter table public.messages add column if not exists media_type text;
alter table public.messages add column if not exists media_name text;
alter table public.messages add column if not exists media_size bigint;
alter table public.messages add column if not exists created_at timestamptz not null default now();

-- The old text-only setup dropped media columns; no longer needed.

alter table public.messages
  drop constraint if exists messages_content_length,
  drop constraint if exists messages_content_not_blank,
  drop constraint if exists messages_media_type_valid,
  drop constraint if exists messages_content_or_media;

alter table public.messages alter column content drop not null;

alter table public.messages
  add constraint messages_media_type_valid check (media_type is null or media_type in ('image', 'video')),
  add constraint messages_content_or_media check (
    length(btrim(coalesce(content, ''))) > 0
    or media_url is not null
  ),
  add constraint messages_content_length check (char_length(coalesce(content, '')) <= 4000);

create index if not exists messages_group_created_id_idx
  on public.messages (group_id, created_at desc, id desc);

create index if not exists messages_user_id_idx
  on public.messages (user_id);

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
    select 1
    from public.profiles
    where username = final_username and id <> new.id
  ) then
    final_username := left(requested_username, 23) || '_' || substr(new.id::text, 1, 8);
  end if;

  select not exists (select 1 from public.profiles) into is_first_account;

  insert into public.profiles (id, username, role)
  values (new.id, final_username, case when is_first_account then 'admin' else 'user' end)
  on conflict (id) do update
    set username = excluded.username;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.messages enable row level security;
alter table public.messages replica identity full;

drop policy if exists "Authenticated members can read profiles" on public.profiles;
drop policy if exists "Members can read their groups" on public.groups;
drop policy if exists "Members can read their group memberships" on public.group_members;
drop policy if exists "Authenticated members can read messages" on public.messages;
drop policy if exists "Members can create their own messages" on public.messages;
drop policy if exists "Members can edit their own messages" on public.messages;
drop policy if exists "Members can delete their own messages" on public.messages;

create policy "Authenticated members can read profiles"
on public.profiles
for select
to authenticated
using (true);

create policy "Members can read their groups"
on public.groups
for select
to authenticated
using (
  exists (
    select 1 from public.group_members
    where group_members.group_id = groups.id
      and group_members.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'admin'
  )
);

create policy "Members can read their group memberships"
on public.group_members
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'admin'
  )
);

create policy "Authenticated members can read messages"
on public.messages
for select
to authenticated
using (
  exists (
    select 1 from public.group_members
    where group_members.group_id = messages.group_id
      and group_members.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role = 'admin'
  )
);

create policy "Members can create their own messages"
on public.messages
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (
    btrim(coalesce(content, '')) <> ''
    or media_url is not null
  )
  and exists (
    select 1 from public.group_members
    where group_members.group_id = messages.group_id
      and group_members.user_id = (select auth.uid())
  )
);

create policy "Members can edit their own messages"
on public.messages
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Members can delete their own messages"
on public.messages
for delete
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.profiles from anon;
revoke all on table public.groups from anon;
revoke all on table public.group_members from anon;
revoke all on table public.messages from anon;

revoke insert, update, delete on table public.profiles from authenticated;
revoke insert, update, delete on table public.groups from authenticated;
revoke insert, update, delete on table public.group_members from authenticated;
revoke update on table public.messages from authenticated;

grant usage on schema public to authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.groups to authenticated;
grant select on table public.group_members to authenticated;
grant select, delete on table public.messages to authenticated;
grant insert (id, group_id, user_id, content, media_url, media_type, media_name, media_size) on public.messages to authenticated;
grant update (content) on public.messages to authenticated;

-- Add messages to the Realtime publication without failing on a rerun.
do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Push subscriptions (web-push endpoints per user)
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can read their own push subscriptions" on public.push_subscriptions;
drop policy if exists "Users can create their own push subscriptions" on public.push_subscriptions;
drop policy if exists "Users can delete their own push subscriptions" on public.push_subscriptions;

create policy "Users can read their own push subscriptions"
on public.push_subscriptions
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Users can create their own push subscriptions"
on public.push_subscriptions
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can delete their own push subscriptions"
on public.push_subscriptions
for delete
to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.push_subscriptions from anon;
revoke insert, update, delete on table public.push_subscriptions from authenticated;
grant select, delete on table public.push_subscriptions to authenticated;
grant insert (user_id, endpoint, p256dh, auth) on table public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- Couples: two members, a playful vibe (Kitten / Daddy), shared plans, games
-- ---------------------------------------------------------------------------

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  cute_role text not null default 'kitten',
  since timestamptz not null default now(),
  primary key (couple_id, user_id)
);

alter table public.couple_members drop constraint if exists couple_members_cute_role_valid;

alter table public.couple_members
  add constraint couple_members_cute_role_valid check (cute_role in ('kitten', 'daddy'));

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  kind text not null,
  board jsonb not null default '[]'::jsonb,
  current_turn text not null default 'x',
  status text not null default 'playing',
  winner_user_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.games drop constraint if exists games_kind_valid,
  drop constraint if exists games_status_valid;

alter table public.games
  add constraint games_kind_valid check (kind in ('tictactoe')),
  add constraint games_status_valid check (status in ('playing', 'won', 'draw'));

create index if not exists couple_members_user_id_idx
  on public.couple_members (user_id);

create index if not exists couple_members_couple_id_idx
  on public.couple_members (couple_id);

create index if not exists plans_couple_id_idx
  on public.plans (couple_id, starts_at);

create index if not exists games_couple_id_idx
  on public.games (couple_id, updated_at desc);

alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.plans enable row level security;
alter table public.games enable row level security;

-- Couples --------------------------------------------------------------
drop policy if exists "Members can read their couples" on public.couples;
drop policy if exists "Members can end their couples" on public.couples;

create policy "Members can read their couples"
on public.couples
for select
to authenticated
using (
  exists (
    select 1 from public.couple_members
    where couple_members.couple_id = couples.id
      and couple_members.user_id = (select auth.uid())
  )
);

create policy "Members can end their couples"
on public.couples
for delete
to authenticated
using (
  exists (
    select 1 from public.couple_members
    where couple_members.couple_id = couples.id
      and couple_members.user_id = (select auth.uid())
  )
);

-- Couple members -------------------------------------------------------
drop policy if exists "Members can read their couple memberships" on public.couple_members;
drop policy if exists "Members can update their own couple membership" on public.couple_members;

create policy "Members can read their couple memberships"
on public.couple_members
for select
to authenticated
using (
  exists (
    select 1 from public.couple_members cm2
    where cm2.couple_id = couple_members.couple_id
      and cm2.user_id = (select auth.uid())
  )
);

create policy "Members can update their own couple membership"
on public.couple_members
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Plans ------------------------------------------------------------------
drop policy if exists "Members can read their plans" on public.plans;
drop policy if exists "Members can create plans" on public.plans;
drop policy if exists "Members can update their plans" on public.plans;
drop policy if exists "Members can delete their plans" on public.plans;

create policy "Members can read their plans"
on public.plans
for select
to authenticated
using (
  exists (
    select 1 from public.couple_members
    where couple_members.couple_id = plans.couple_id
      and couple_members.user_id = (select auth.uid())
  )
);

create policy "Members can create plans"
on public.plans
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.couple_members
    where couple_members.couple_id = plans.couple_id
      and couple_members.user_id = (select auth.uid())
  )
);

create policy "Members can update their plans"
on public.plans
for update
to authenticated
using (
  exists (
    select 1 from public.couple_members
    where couple_members.couple_id = plans.couple_id
      and couple_members.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.couple_members
    where couple_members.couple_id = plans.couple_id
      and couple_members.user_id = (select auth.uid())
  )
);

create policy "Members can delete their plans"
on public.plans
for delete
to authenticated
using (
  exists (
    select 1 from public.couple_members
    where couple_members.couple_id = plans.couple_id
      and couple_members.user_id = (select auth.uid())
  )
);

-- Games ------------------------------------------------------------------
drop policy if exists "Members can read their games" on public.games;
drop policy if exists "Members can create their games" on public.games;
drop policy if exists "Members can update their games" on public.games;
drop policy if exists "Members can delete their games" on public.games;

create policy "Members can read their games"
on public.games
for select
to authenticated
using (
  exists (
    select 1 from public.couple_members
    where couple_members.couple_id = games.couple_id
      and couple_members.user_id = (select auth.uid())
  )
);

create policy "Members can create their games"
on public.games
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.couple_members
    where couple_members.couple_id = games.couple_id
      and couple_members.user_id = (select auth.uid())
  )
);

create policy "Members can update their games"
on public.games
for update
to authenticated
using (
  exists (
    select 1 from public.couple_members
    where couple_members.couple_id = games.couple_id
      and couple_members.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.couple_members
    where couple_members.couple_id = games.couple_id
      and couple_members.user_id = (select auth.uid())
  )
);

create policy "Members can delete their games"
on public.games
for delete
to authenticated
using (
  exists (
    select 1 from public.couple_members
    where couple_members.couple_id = games.couple_id
      and couple_members.user_id = (select auth.uid())
  )
);

revoke all on table public.couples from anon;
revoke all on table public.couple_members from anon;
revoke all on table public.plans from anon;
revoke all on table public.games from anon;

revoke insert, update, delete on table public.couples from authenticated;
revoke insert, update, delete on table public.couple_members from authenticated;
revoke insert, update, delete on table public.plans from authenticated;
revoke insert, update, delete on table public.games from authenticated;

grant usage on schema public to authenticated;
grant select on table public.couples to authenticated;
grant delete on table public.couples to authenticated;
grant select on table public.couple_members to authenticated;
grant update (cute_role) on table public.couple_members to authenticated;
grant select on table public.plans to authenticated;
grant insert (id, couple_id, title, starts_at, ends_at, location, notes, created_by) on table public.plans to authenticated;
grant update (done, title, starts_at, ends_at, location, notes) on table public.plans to authenticated;
grant delete on table public.plans to authenticated;
grant select on table public.games to authenticated;
grant insert (id, couple_id, kind, board, current_turn, status, winner_user_id, created_by) on table public.games to authenticated;
grant update (board, current_turn, status, winner_user_id, updated_at) on table public.games to authenticated;
grant delete on table public.games to authenticated;


-- ---------------------------------------------------------------------------
-- Storage: chat-media bucket (public reads, authenticated uploads)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Authenticated users can upload media to their own folder" on storage.objects;
create policy "Authenticated users can upload media to their own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Anyone can read chat media" on storage.objects;
create policy "Anyone can read chat media"
on storage.objects
for select
to public
using (bucket_id = 'chat-media');

drop policy if exists "Users can delete their own media uploads" on storage.objects;
create policy "Users can delete their own media uploads"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- Realtime ----------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'plans'
  ) then
    alter publication supabase_realtime add table public.plans;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end;
$$;

alter table public.plans replica identity full;
alter table public.games replica identity full;

commit;
