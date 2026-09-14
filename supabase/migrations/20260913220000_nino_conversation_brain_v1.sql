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

-- Avaliação shadow: armazena apenas o CONTRATO que o Brain teria emitido e a
-- rota legada observada. Não executa tools, drafts ou mutações financeiras.
CREATE TABLE IF NOT EXISTS public.conversation_brain_shadow_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  inbound_message_id text,
  brain_act text,
  brain_mode text,
  brain_canonical_request text,
  brain_focus jsonb NOT NULL DEFAULT '{}'::jsonb,
  brain_action jsonb,
  brain_confidence numeric,
  brain_latency_ms integer,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  legacy_path text,
  legacy_reply_kind text,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'brain_error')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_brain_shadow_lookup
  ON public.conversation_brain_shadow_evaluations (user_id, created_at DESC);

ALTER TABLE public.conversation_brain_shadow_evaluations ENABLE ROW LEVEL SECURITY;
-- Shadow telemetry is operational data: no end-user policy; service_role only.
REVOKE ALL ON public.conversation_brain_shadow_evaluations FROM authenticated, anon;
GRANT ALL ON public.conversation_brain_shadow_evaluations TO service_role;

-- Resumo operacional para decidir rollout com evidência. Não tenta dizer se o
-- Brain "está certo" sozinho; expõe volume, falha, confiança e latência para o
-- gate humano/golden-replay. Somente service_role pode ler.
CREATE OR REPLACE VIEW public.conversation_brain_shadow_summary AS
SELECT
  date_trunc('day', created_at) AS day,
  count(*)::bigint AS turns,
  count(*) FILTER (WHERE status = 'brain_error')::bigint AS brain_errors,
  round(
    (100.0 * count(*) FILTER (WHERE status = 'brain_error') / NULLIF(count(*), 0))::numeric,
    2
  ) AS brain_error_pct,
  round(avg(brain_confidence) FILTER (WHERE status = 'ok')::numeric, 4) AS avg_confidence,
  round(avg(brain_latency_ms) FILTER (WHERE status = 'ok')::numeric, 1) AS avg_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY brain_latency_ms)
    FILTER (WHERE status = 'ok') AS p95_latency_ms,
  count(*) FILTER (WHERE brain_act IN ('follow_up', 'answer', 'repair'))::bigint AS continuation_turns,
  count(*) FILTER (WHERE brain_mode = 'write')::bigint AS write_turns,
  count(*) FILTER (WHERE brain_mode = 'clarify')::bigint AS clarify_turns
FROM public.conversation_brain_shadow_evaluations
GROUP BY 1;

REVOKE ALL ON public.conversation_brain_shadow_summary FROM authenticated, anon;
GRANT SELECT ON public.conversation_brain_shadow_summary TO service_role;

-- Rollout do novo cérebro é explicitamente opt-in. Mesmo após a migration,
-- 0% dos usuários entra no V2 ou shadow até uma ativação intencional posterior.
INSERT INTO public.agent_runtime_flags (flag_name, enabled, rollout_percent, pilot_user_ids)
VALUES
  ('conversation_brain_v1', false, 0, '{}'::uuid[]),
  ('conversation_brain_shadow_v1', false, 0, '{}'::uuid[]),
  ('write_workflow_v1', false, 0, '{}'::uuid[])
ON CONFLICT (flag_name) DO NOTHING;
