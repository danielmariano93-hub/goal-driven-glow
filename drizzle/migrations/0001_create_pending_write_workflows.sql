CREATE TABLE IF NOT EXISTS public.pending_write_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  kind text NOT NULL,
  slots jsonb NOT NULL DEFAULT '{}'::jsonb,
  asked_slot text,
  turns integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_write_workflows_status_chk CHECK (status IN ('open','completed','abandoned'))
);

GRANT SELECT ON public.pending_write_workflows TO authenticated;
GRANT ALL ON public.pending_write_workflows TO service_role;

ALTER TABLE public.pending_write_workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own write workflows readable" ON public.pending_write_workflows;
CREATE POLICY "own write workflows readable"
ON public.pending_write_workflows
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS pending_write_workflows_one_open_per_conversation
ON public.pending_write_workflows (user_id, conversation_id);

CREATE INDEX IF NOT EXISTS pending_write_workflows_open_lookup
ON public.pending_write_workflows (user_id, conversation_id, status, expires_at);