CREATE UNIQUE INDEX IF NOT EXISTS conversations_user_phone_unique
ON public.conversations (user_id, phone_e164);