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
