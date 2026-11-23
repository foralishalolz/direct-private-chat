-- Run as the database owner. Every account, poll and vote is rolled back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  partner_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  conversation_id uuid := gen_random_uuid();
  poll_id uuid := gen_random_uuid();
  person uuid;
begin
  foreach person in array array[owner_id, partner_id, outsider_id] loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values(person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'qa28_' || replace(person::text, '-', '')::varchar(16) || '@chat.local',
      '', clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  end loop;
  insert into public.conversations(id, member_a, member_b, created_by, couple_a, couple_b)
  values(conversation_id, least(owner_id, partner_id), greatest(owner_id, partner_id), owner_id, true, true);
  perform set_config('bitchat.qa28_owner', owner_id::text, true);
  perform set_config('bitchat.qa28_partner', partner_id::text, true);
  perform set_config('bitchat.qa28_outsider', outsider_id::text, true);
  perform set_config('bitchat.qa28_conversation', conversation_id::text, true);
  perform set_config('bitchat.qa28_poll', poll_id::text, true);
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('bitchat.qa28_owner'), true);
set local role authenticated;
do $$
declare cid uuid := current_setting('bitchat.qa28_conversation')::uuid; pid uuid := current_setting('bitchat.qa28_poll')::uuid;
begin
  assert (select not is_pro from public.profiles where id = auth.uid()), 'Regular accounts can play.';
  assert public.create_poll(pid, cid, '🍓 Pick our treat', array['🍪 Cookie','🍦 Ice cream','🍓 Strawberries','🥞 Pancakes']) = pid, 'A member creates the round.';
  assert public.create_poll(pid, cid, '🍓 Pick our treat', array['🍪 Cookie','🍦 Ice cream','🍓 Strawberries','🥞 Pancakes']) = pid, 'Uncertain retries are idempotent.';
  assert (select count(*) = 1 from public.polls where id = pid), 'Retries never duplicate rounds.';
  assert (select user_id = auth.uid() and cardinality(options) = 4 and closes_at = created_at + interval '24 hours' from public.polls where id = pid), 'The server derives ownership and expiry.';
  perform public.vote_poll(pid, 2);
  assert (select choice = 2 from public.poll_votes where poll_id = pid and user_id = auth.uid()), 'The first choice belongs to the caller.';
  begin
    insert into public.poll_votes(poll_id, user_id, choice) values(pid, current_setting('bitchat.qa28_partner')::uuid, 2);
    raise exception 'Forged vote was accepted.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.vote_poll(pid, 4);
    raise exception 'Invalid choice was accepted.';
  exception when raise_exception then
    if sqlerrm <> 'Vote unavailable.' then raise; end if;
  end;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('bitchat.qa28_partner'), true);
set local role authenticated;
do $$
declare pid uuid := current_setting('bitchat.qa28_poll')::uuid;
begin
  assert (select not is_pro from public.profiles where id = auth.uid()), 'Both regular members can participate.';
  perform public.vote_poll(pid, 2);
  assert (select count(*) = 2 and bool_and(choice = 2) from public.poll_votes where poll_id = pid), 'Both members see the shared match.';
  perform public.vote_poll(pid, 1);
  assert (select count(*) = 2 from public.poll_votes where poll_id = pid), 'Changing a choice keeps one vote per member.';
  assert (select choice = 1 from public.poll_votes where poll_id = pid and user_id = auth.uid()), 'The caller changes only their vote.';
  perform public.vote_poll(pid, 2);
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('bitchat.qa28_outsider'), true);
set local role authenticated;
do $$
declare pid uuid := current_setting('bitchat.qa28_poll')::uuid; cid uuid := current_setting('bitchat.qa28_conversation')::uuid;
begin
  assert (select count(*) = 0 from public.polls where id = pid), 'Outsiders cannot read the round.';
  assert (select count(*) = 0 from public.poll_votes where poll_id = pid), 'Outsiders cannot read the choices.';
  begin
    perform public.vote_poll(pid, 2);
    raise exception 'Outsider vote was accepted.';
  exception when raise_exception then
    if sqlerrm <> 'Vote unavailable.' then raise; end if;
  end;
  begin
    perform public.create_poll(gen_random_uuid(), cid, '🍓 Pick our treat', array['🍪 Cookie','🍓 Strawberries']);
    raise exception 'Outsider round was accepted.';
  exception when raise_exception then
    if sqlerrm <> 'Conversation unavailable.' then raise; end if;
  end;
end;
$$;
reset role;

update public.polls set closes_at = now() - interval '1 second' where id = current_setting('bitchat.qa28_poll')::uuid;
select set_config('request.jwt.claim.sub', current_setting('bitchat.qa28_owner'), true);
set local role authenticated;
do $$
begin
  begin
    perform public.vote_poll(current_setting('bitchat.qa28_poll')::uuid, 2);
    raise exception 'Expired round was accepted.';
  exception when raise_exception then
    if sqlerrm <> 'Vote unavailable.' then raise; end if;
  end;
end;
$$;
reset role;
select jsonb_build_object('checks', 17, 'passed', true, 'fixtures_retained', false) as couple_moments_result;
rollback;
