-- Direct v2 migration: media messages, push subscriptions, couples, plans, games
-- -----------------------------------------------------------------------------
-- Run this in the Supabase SQL Editor on an EXISTING database (after the original
-- setup.sql was already applied). It is intentionally idempotent / rerunnable.
-- Safely layered on top of the original schema — run the original setup.sql
-- first if you have not yet (it applies the entire current schema).

begin;

-- ---------------------------------------------------------------------------
-- 1. Messages: media columns (image/video), relax content NOT NULL
-- ---------------------------------------------------------------------------

alter table public.messages add column if not exists media_url text;
alter table public.messages add column if not exists media_type text;
alter table public.messages add column if not exists media_name text;
alter table public.messages add column if not exists media_size bigint;

drop policy if exists "Members can create their own messages" on public.messages;

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

revoke select, insert, delete on table public.messages from authenticated;
grant select, delete on table public.messages to authenticated;
grant insert (id, group_id, user_id, content, media_url, media_type, media_name, media_size) on public.messages to authenticated;
grant update (content) on public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Push subscriptions
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
-- 3. Couples + members + plans + games
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

create index if not exists couple_members_user_id_idx on public.couple_members (user_id);
create index if not exists couple_members_couple_id_idx on public.couple_members (couple_id);
create index if not exists plans_couple_id_idx on public.plans (couple_id, starts_at);
create index if not exists games_couple_id_idx on public.games (couple_id, updated_at desc);

alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.plans enable row level security;
alter table public.games enable row level security;

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

alter table public.plans replica identity full;
alter table public.games replica identity full;

-- ---------------------------------------------------------------------------
-- 4. Storage bucket: chat-media (public read, authenticated upload)
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

-- ---------------------------------------------------------------------------
-- 5. Realtime publication (plans + games)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'plans'
  ) then
    alter publication supabase_realtime add table public.plans;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end;
$$;

commit;
