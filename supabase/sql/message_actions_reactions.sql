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
  (emoji=any(array['❤️','😂','🥺','🔥','😘','🫶','👍','👎','😍','🥹','😮','😢','😡','🤍','💯','🎉','✨','👀','🙈','🤗','😈','💋','💕','💀']));

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
