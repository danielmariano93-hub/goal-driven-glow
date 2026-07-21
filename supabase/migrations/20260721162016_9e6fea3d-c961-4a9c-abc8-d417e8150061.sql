CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp','simulator','app')),
  conversation_id uuid NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_sessions_user_channel_active_uniq
  ON public.agent_sessions (user_id, channel);
CREATE INDEX IF NOT EXISTS agent_sessions_conversation_idx
  ON public.agent_sessions (conversation_id);
GRANT ALL ON public.agent_sessions TO service_role;
ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;