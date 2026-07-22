alter table public.user_ai_preferences
  add column if not exists fast_log_token text not null default '!ja';