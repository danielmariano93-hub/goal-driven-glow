-- nino_conversation_brain.v1
-- Infraestrutura aditiva e fail-closed para a Conversation Architecture V2.
-- Nenhuma flag nasce ativa e nenhum dado financeiro é alterado por esta migration.

CREATE TABLE IF NOT EXISTS public.pending_write_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  slots jsonb NOT NULL DEFAULT '{}'::jsonb,
  asked_slot text,
  turns integer NOT NULL DEFAULT 0 CHECK (turns >= 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'abandoned')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- O runtime usa upsert(user_id, conversation_id): uma linha durável por
-- conversa, reaberta para um novo workflow após o anterior ser encerrado.
CREATE UNIQUE INDEX IF NOT EXISTS pending_write_workflows_user_conversation_uniq
  ON public.pending_write_workflows (user_id, conversation_id);

CREATE INDEX IF NOT EXISTS pending_write_workflows_open_lookup
  ON public.pending_write_workflows (user_id, conversation_id, status, expires_at);

ALTER TABLE public.pending_write_workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own write workflows readable" ON public.pending_write_workflows;
CREATE POLICY "own write workflows readable"
  ON public.pending_write_workflows
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.pending_write_workflows TO authenticated;
GRANT ALL ON public.pending_write_workflows TO service_role;

-- Rollout do novo cérebro é explicitamente opt-in. Mesmo após a migration,
-- 0% dos usuários entra no V2 até uma ativação intencional posterior.
INSERT INTO public.agent_runtime_flags (flag_name, enabled, rollout_percent, pilot_user_ids)
VALUES
  ('conversation_brain_v1', false, 0, '{}'::uuid[]),
  ('write_workflow_v1', false, 0, '{}'::uuid[])
ON CONFLICT (flag_name) DO NOTHING;
