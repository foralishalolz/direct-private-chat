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
