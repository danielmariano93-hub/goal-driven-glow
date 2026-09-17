-- nino_ai_provider_shadow.v1
-- Compara o Conversation Brain autoritativo com um provider/modelo alternativo
-- sem alterar resposta, tools, drafts ou qualquer verdade financeira.

CREATE TABLE IF NOT EXISTS public.ai_provider_shadow_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  inbound_message_id text,

  official_provider text NOT NULL,
  official_model text NOT NULL,
  official_act text,
  official_mode text,
  official_canonical_request text,
  official_focus jsonb NOT NULL DEFAULT '{}'::jsonb,
  official_action jsonb,
  official_confidence numeric,
  official_latency_ms integer,

  shadow_provider text NOT NULL,
  shadow_model text NOT NULL,
  shadow_act text,
  shadow_mode text,
  shadow_canonical_request text,
  shadow_focus jsonb NOT NULL DEFAULT '{}'::jsonb,
  shadow_action jsonb,
  shadow_confidence numeric,
  shadow_latency_ms integer,
  shadow_tokens_in integer NOT NULL DEFAULT 0,
  shadow_tokens_out integer NOT NULL DEFAULT 0,

  same_act boolean,
  same_mode boolean,
  same_canonical_request boolean,
  same_focus boolean,
  same_action_kind boolean,

  status text NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'shadow_error', 'not_configured')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_provider_shadow_user_time_idx
  ON public.ai_provider_shadow_evaluations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_provider_shadow_provider_time_idx
  ON public.ai_provider_shadow_evaluations (shadow_provider, shadow_model, created_at DESC);

ALTER TABLE public.ai_provider_shadow_evaluations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_provider_shadow_evaluations FROM authenticated, anon;
GRANT ALL ON public.ai_provider_shadow_evaluations TO service_role;

CREATE OR REPLACE VIEW public.ai_provider_shadow_summary AS
SELECT
  date_trunc('day', created_at) AS day,
  shadow_provider,
  shadow_model,
  count(*)::bigint AS turns,
  count(*) FILTER (WHERE status = 'ok')::bigint AS successful_turns,
  count(*) FILTER (WHERE status <> 'ok')::bigint AS failed_turns,
  round((100.0 * count(*) FILTER (WHERE status <> 'ok') / NULLIF(count(*), 0))::numeric, 2) AS error_pct,
  round((100.0 * count(*) FILTER (WHERE same_act IS TRUE) / NULLIF(count(*) FILTER (WHERE status = 'ok'), 0))::numeric, 2) AS act_match_pct,
  round((100.0 * count(*) FILTER (WHERE same_mode IS TRUE) / NULLIF(count(*) FILTER (WHERE status = 'ok'), 0))::numeric, 2) AS mode_match_pct,
  round((100.0 * count(*) FILTER (WHERE same_focus IS TRUE) / NULLIF(count(*) FILTER (WHERE status = 'ok'), 0))::numeric, 2) AS focus_match_pct,
  round((100.0 * count(*) FILTER (WHERE same_action_kind IS TRUE) / NULLIF(count(*) FILTER (WHERE status = 'ok'), 0))::numeric, 2) AS action_match_pct,
  round(avg(shadow_confidence) FILTER (WHERE status = 'ok')::numeric, 4) AS avg_shadow_confidence,
  round(avg(shadow_latency_ms) FILTER (WHERE status = 'ok')::numeric, 1) AS avg_shadow_latency_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY shadow_latency_ms)
    FILTER (WHERE status = 'ok') AS p95_shadow_latency_ms,
  sum(shadow_tokens_in)::bigint AS shadow_tokens_in,
  sum(shadow_tokens_out)::bigint AS shadow_tokens_out
FROM public.ai_provider_shadow_evaluations
GROUP BY 1, 2, 3;

REVOKE ALL ON public.ai_provider_shadow_summary FROM authenticated, anon;
GRANT SELECT ON public.ai_provider_shadow_summary TO service_role;

-- Fail-closed: adicionar a migration não inicia chamadas externas.
INSERT INTO public.agent_runtime_flags (flag_name, enabled, rollout_percent, pilot_user_ids)
VALUES ('ai_provider_shadow_v1', false, 0, '{}'::uuid[])
ON CONFLICT (flag_name) DO UPDATE
SET enabled = false,
    rollout_percent = 0,
    pilot_user_ids = '{}'::uuid[],
    updated_at = now();
