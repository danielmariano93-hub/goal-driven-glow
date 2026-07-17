-- Preferência de privacidade: sincronizada por usuário e reaplicada a cada login.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hide_financial_values boolean NOT NULL DEFAULT false;
