-- nino_write_workflow.v1 — fluxo de escrita multi-turno durável.
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
  CONSTRAINT pending_write_workflows_status_chk
    CHECK (status IN ('open', 'completed', 'abandoned')),
  CONSTRAINT pending_write_workflows_turns_chk CHECK (turns >= 0 AND turns <= 12),
  CONSTRAINT pending_write_workflows_unique_conversation
    UNIQUE (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS pending_write_workflows_open_idx
  ON public.pending_write_workflows (user_id, updated_at DESC)
  WHERE status = 'open';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_write_workflows TO authenticated;
GRANT ALL ON public.pending_write_workflows TO service_role;

ALTER TABLE public.pending_write_workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own write workflows" ON public.pending_write_workflows;
CREATE POLICY "own write workflows"
  ON public.pending_write_workflows
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS pending_write_workflows_touch ON public.pending_write_workflows;
CREATE TRIGGER pending_write_workflows_touch
  BEFORE UPDATE ON public.pending_write_workflows
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();