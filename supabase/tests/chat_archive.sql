-- Run as the database owner. Every fixture and mutation is rolled back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  partner_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  direct_id uuid := gen_random_uuid();
  group_id uuid := gen_random_uuid();
  person uuid;
begin
  foreach person in array array[owner_id, partner_id, outsider_id] loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values(person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'qa26_' || replace(person::text, '-', '')::varchar(16) || '@chat.local',
      '', clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
  end loop;
  update public.profiles set is_pro = true where id = outsider_id;
  insert into public.conversations(id, member_a, member_b, created_by)
  values(direct_id, least(owner_id, partner_id), greatest(owner_id, partner_id), owner_id);
  insert into public.conversations(id, kind, title, created_by)
  values(group_id, 'group', 'Archive QA', owner_id);
  insert into public.conversation_members(conversation_id, user_id)
  values(group_id, owner_id), (group_id, partner_id);
  perform set_config('request.jwt.claim.sub', partner_id::text, true);
  insert into public.messages(conversation_id, user_id, content)
  values(direct_id, partner_id, 'Retained direct text'), (group_id, partner_id, 'Retained group text');
  perform set_config('bitchat.qa_owner', owner_id::text, true);
  perform set_config('bitchat.qa_partner', partner_id::text, true);
  perform set_config('bitchat.qa_outsider', outsider_id::text, true);
  perform set_config('bitchat.qa_direct', direct_id::text, true);
  perform set_config('bitchat.qa_group', group_id::text, true);
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('bitchat.qa_owner'), true);
set local role authenticated;
do $$
declare cid uuid := current_setting('bitchat.qa_direct')::uuid; gid uuid := current_setting('bitchat.qa_group')::uuid; before_clear timestamptz;
begin
  assert public.set_chat_archived(cid, true), 'A member can archive a direct chat.';
  assert (select archived from public.chat_preferences where conversation_id = cid), 'Archive state is readable by its owner.';
  assert public.inbox_page() @> jsonb_build_array(jsonb_build_object('id', cid, 'archived', true)), 'Inbox exposes own archive state.';
  assert (select count(*) = 1 from public.messages where conversation_id = cid), 'Archiving retains readable text.';
  assert public.set_chat_archived(gid, true), 'A member can archive a group.';
  assert public.inbox_page() @> jsonb_build_array(jsonb_build_object('id', gid, 'archived', true)), 'Groups have archive state.';
  insert into public.messages(conversation_id, content) values(gid, 'A new message in an archived group');
  assert (select count(*) = 2 from public.messages where conversation_id = gid), 'Archiving allows new messages.';
  assert public.inbox_page() @> jsonb_build_array(jsonb_build_object('id', gid, 'archived', true)), 'New messages preserve archive state.';
  assert not public.set_chat_archived(cid, false), 'Unarchive returns false.';
  assert public.inbox_page() @> jsonb_build_array(jsonb_build_object('id', cid, 'archived', false)), 'Unarchive restores inbox state.';
  perform public.set_chat_archived(cid, true);
  before_clear := public.clear_chat(cid);
  assert (select not archived and cleared_before = before_clear from public.chat_preferences where conversation_id = cid), 'Delete resets archive and advances only own clear marker.';
  perform public.set_chat_archived(cid, true);
  assert (select cleared_before = before_clear and hidden_at = before_clear from public.chat_preferences where conversation_id = cid), 'Archiving never resets deleted history.';
  assert not (public.inbox_page() @> jsonb_build_array(jsonb_build_object('id', cid))), 'Archiving cannot restore a cleared row.';
  assert (select count(*) = 0 from public.messages where conversation_id = cid), 'Deleted-for-me text stays hidden.';
  begin
    perform public.set_chat_archived(gid, null);
    raise exception 'Null archive state was accepted.';
  exception when raise_exception then
    if sqlerrm <> 'Conversation unavailable.' then raise; end if;
  end;
  begin
    update public.chat_preferences set user_id = current_setting('bitchat.qa_partner')::uuid where conversation_id = gid;
    raise exception 'Direct preference mutation was allowed.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('bitchat.qa_partner'), true);
set local role authenticated;
do $$
declare cid uuid := current_setting('bitchat.qa_direct')::uuid; gid uuid := current_setting('bitchat.qa_group')::uuid;
begin
  assert public.inbox_page() @> jsonb_build_array(jsonb_build_object('id', cid, 'archived', false)), 'A partner has an independent direct inbox.';
  assert public.inbox_page() @> jsonb_build_array(jsonb_build_object('id', gid, 'archived', false)), 'Group members have independent inboxes.';
  assert (select count(*) = 0 from public.chat_preferences), 'RLS hides another account''s preferences.';
  assert (select count(*) = 1 from public.messages where conversation_id = cid), 'Delete for me retains partner text.';
end;
$$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('bitchat.qa_outsider'), true);
set local role authenticated;
do $$
begin
  assert public.inbox_page() = '[]'::jsonb, 'Even a Pro outsider cannot see these conversations.';
  begin
    perform public.set_chat_archived(current_setting('bitchat.qa_direct')::uuid, true);
    raise exception 'An outsider archived another account''s chat.';
  exception when raise_exception then
    if sqlerrm <> 'Conversation unavailable.' then raise; end if;
  end;
  assert (select count(*) = 0 from public.chat_preferences), 'An outsider cannot read preference rows.';
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.set_chat_archived(current_setting('bitchat.qa_direct')::uuid, true);
    raise exception 'An anonymous request reached the archive RPC.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select 'passed' as archive_security, 24 as assertions, 'All fixtures roll back' as cleanup;
rollback;
