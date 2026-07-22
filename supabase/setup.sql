-- Direct — multi-group private chat (text-only): complete Supabase schema.
-- This script is intentionally rerunnable.
--
-- God mode bootstrap: the FIRST account ever created (via /api/signup, using
-- your SIGNUP_INVITE_CODE) is automatically made an admin ("god user"). Every
-- account after that is a regular user. Sign up first, right after running
-- this script, so you become the admin.

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
-- Messages (text only — no media)
-- ---------------------------------------------------------------------------

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists group_id uuid;
alter table public.messages add column if not exists user_id uuid;
alter table public.messages add column if not exists content text;
alter table public.messages add column if not exists created_at timestamptz not null default now();

-- Drop leftover media columns from an earlier version of this app, if
-- present. The old insert policy referenced media_url directly, so it must
-- be dropped first — otherwise Postgres refuses to drop the column under it.
drop policy if exists "Members can create their own messages" on public.messages;
alter table public.messages drop column if exists media_url;
alter table public.messages drop column if exists media_type;

alter table public.messages
  drop constraint if exists messages_content_length,
  drop constraint if exists messages_content_not_blank;

alter table public.messages alter column content set not null;

alter table public.messages
  add constraint messages_content_length check (char_length(content) between 1 and 4000),
  add constraint messages_content_not_blank check (btrim(content) <> '');

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
  and btrim(content) <> ''
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
grant insert (id, group_id, user_id, content) on public.messages to authenticated;
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

commit;
