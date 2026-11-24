-- The four-argument function defaults p_kind to message, so it also handles
-- the old three-argument API without an ambiguous overload.
drop function if exists public.register_push_subscription(text,text,text);
notify pgrst, 'reload schema';
