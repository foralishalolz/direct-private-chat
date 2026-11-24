-- iOS-style text effects are presentation metadata, not message text. Keep the
-- accepted values on the server so a stale or hostile client cannot inject CSS.
alter table public.messages add column if not exists text_effect text;

alter table public.messages drop constraint if exists messages_text_effect_check;
alter table public.messages add constraint messages_text_effect_check
  check (text_effect is null or text_effect in ('big','small','shake','ripple','bloom','explode'));

comment on column public.messages.text_effect is
  'Optional iOS-style presentation effect. Content, search and push payloads remain unchanged.';

-- Authenticated clients write only the strict enum; RLS still gates the row.
grant insert(text_effect), update(text_effect) on public.messages to authenticated;

-- PostgREST caches table columns; make the new column available immediately.
notify pgrst, 'reload schema';
