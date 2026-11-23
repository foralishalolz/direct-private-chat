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
