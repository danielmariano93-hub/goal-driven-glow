CREATE TABLE IF NOT EXISTS public.agent_runtime_flags (
  flag_name   text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT true,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.agent_runtime_flags TO authenticated;
GRANT ALL ON public.agent_runtime_flags TO service_role;

ALTER TABLE public.agent_runtime_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent runtime flags readable" ON public.agent_runtime_flags;
CREATE POLICY "agent runtime flags readable" ON public.agent_runtime_flags
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.agent_runtime_flags (flag_name, enabled, description) VALUES
  ('evidence_pack_v1',       true,  'Compressao semantica de resultados de tools no prompt'),
  ('deterministic_first_v2', true,  'Renderizadores deterministicos antes de escalar para LLM'),
  ('progressive_tools_v1',   true,  'Escopo inicial reduzido de ferramentas com ampliacao sob demanda'),
  ('context_budget_v2',      true,  'Orcamento de contexto por camada com telemetria'),
  ('model_routing_v2',       true,  'Tiers reais de modelo por complexidade da tarefa'),
  ('document_efficiency_v1', true,  'Ingestao de documentos: texto deterministico antes de visao')
ON CONFLICT (flag_name) DO NOTHING;

ALTER TABLE public.ai_model_routes
  ADD COLUMN IF NOT EXISTS model_tier text;

UPDATE public.ai_model_routes SET
  model_tier = 'tier1_light',
  primary_model = 'google/gemini-3.1-flash-lite',
  fallback_model = 'openai/gpt-5.4-nano',
  max_steps = 2,
  max_latency_ms = 12000
WHERE task IN ('fast_operation', 'semantic_classification');

UPDATE public.ai_model_routes SET
  model_tier = 'tier2_analysis',
  primary_model = 'google/gemini-3.7-flash',
  fallback_model = 'openai/gpt-5.4-mini',
  max_steps = 3,
  max_latency_ms = 20000
WHERE task = 'financial_analysis';

UPDATE public.ai_model_routes SET
  model_tier = 'tier3_reasoning',
  primary_model = 'google/gemini-3.1-pro-preview',
  fallback_model = 'openai/gpt-5.6-terra',
  max_steps = 3,
  max_latency_ms = 30000
WHERE task = 'complex_reasoning';

UPDATE public.ai_model_routes SET
  model_tier = 'vision',
  primary_model = 'google/gemini-3.7-flash',
  fallback_model = 'openai/gpt-5.4',
  max_steps = 3,
  max_latency_ms = 30000
WHERE task = 'vision';

INSERT INTO public.ai_model_routes (task, primary_model, fallback_model, max_steps, max_latency_ms, active, model_tier)
VALUES ('document_text', 'google/gemini-3.7-flash', 'openai/gpt-5.4-mini', 2, 30000, true, 'tier2_analysis')
ON CONFLICT (task) DO UPDATE SET
  primary_model = excluded.primary_model,
  fallback_model = excluded.fallback_model,
  max_steps = excluded.max_steps,
  max_latency_ms = excluded.max_latency_ms,
  model_tier = excluded.model_tier,
  active = true;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS fallback_attempts integer,
  ADD COLUMN IF NOT EXISTS provider_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS compression_ratio numeric,
  ADD COLUMN IF NOT EXISTS context_layers jsonb,
  ADD COLUMN IF NOT EXISTS system_prompt_chars integer,
  ADD COLUMN IF NOT EXISTS history_chars integer,
  ADD COLUMN IF NOT EXISTS working_memory_chars integer,
  ADD COLUMN IF NOT EXISTS semantic_memory_chars integer,
  ADD COLUMN IF NOT EXISTS financial_context_chars integer,
  ADD COLUMN IF NOT EXISTS tool_schema_chars integer,
  ADD COLUMN IF NOT EXISTS evidence_chars integer,
  ADD COLUMN IF NOT EXISTS truth_validation_failed boolean,
  ADD COLUMN IF NOT EXISTS clarification_asked boolean;

CREATE INDEX IF NOT EXISTS agent_runs_started_capability_idx
  ON public.agent_runs (started_at DESC, capability);

DROP VIEW IF EXISTS public.v_agent_efficiency_daily;
CREATE VIEW public.v_agent_efficiency_daily WITH (security_invoker = true) AS
SELECT
  date_trunc('day', started_at)::date            AS day,
  channel,
  capability,
  model,
  model_tier,
  count(*)                                        AS turns,
  count(*) FILTER (WHERE path = 'deterministic_tool')     AS deterministic_turns,
  count(*) FILTER (WHERE path = 'llm')                    AS llm_turns,
  count(*) FILTER (WHERE path = 'deterministic_fallback') AS fallback_turns,
  count(*) FILTER (WHERE status = 'error')                AS failed_turns,
  count(*) FILTER (WHERE truth_validation_failed)         AS truth_validation_failures,
  count(*) FILTER (WHERE clarification_asked)             AS clarifications,
  sum(coalesce(tokens_in, 0))                     AS tokens_in,
  sum(coalesce(tokens_out, 0))                    AS tokens_out,
  avg(coalesce(llm_calls, 0))                     AS avg_llm_calls,
  avg(coalesce(steps, 0))                         AS avg_tools,
  avg(latency_ms)                                 AS avg_latency_ms,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms)  AS p50_latency_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
  sum(coalesce(estimated_cost_usd, 0))            AS estimated_cost_usd,
  sum(provider_cost_usd)                          AS provider_cost_usd,
  sum(coalesce(tool_result_full_chars, 0))        AS tool_result_full_chars,
  sum(coalesce(tool_result_llm_chars, 0))         AS tool_result_llm_chars
FROM public.agent_runs
GROUP BY 1, 2, 3, 4, 5;

GRANT SELECT ON public.v_agent_efficiency_daily TO authenticated, service_role;

DROP VIEW IF EXISTS public.v_agent_cost_by_user;
CREATE VIEW public.v_agent_cost_by_user WITH (security_invoker = true) AS
SELECT
  user_id,
  date_trunc('day', started_at)::date AS day,
  count(*) AS turns,
  sum(coalesce(tokens_in, 0) + coalesce(tokens_out, 0)) AS tokens_total,
  sum(coalesce(estimated_cost_usd, 0)) AS estimated_cost_usd,
  sum(provider_cost_usd) AS provider_cost_usd
FROM public.agent_runs
GROUP BY 1, 2;

GRANT SELECT ON public.v_agent_cost_by_user TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_v2_ai_efficiency(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => greatest(1, least(90, coalesce(p_days, 7))));
  v_out jsonb;
BEGIN
  PERFORM public._require_perm('cockpit.read');

  SELECT jsonb_build_object(
    'window_days', greatest(1, least(90, coalesce(p_days, 7))),
    'totals', (
      SELECT jsonb_build_object(
        'turns', count(*),
        'deterministic_resolution_rate', round(
          (count(*) FILTER (WHERE path = 'deterministic_tool'))::numeric
          / greatest(1, count(*))::numeric, 4),
        'llm_resolution_rate', round(
          (count(*) FILTER (WHERE path = 'llm'))::numeric
          / greatest(1, count(*))::numeric, 4),
        'fallback_rate', round(
          (count(*) FILTER (WHERE path = 'deterministic_fallback'))::numeric
          / greatest(1, count(*))::numeric, 4),
        'failed_turn_rate', round(
          (count(*) FILTER (WHERE status = 'error'))::numeric
          / greatest(1, count(*))::numeric, 4),
        'truth_validation_failure_rate', round(
          (count(*) FILTER (WHERE truth_validation_failed))::numeric
          / greatest(1, count(*))::numeric, 4),
        'clarification_rate', round(
          (count(*) FILTER (WHERE clarification_asked))::numeric
          / greatest(1, count(*))::numeric, 4),
        'avg_llm_calls_per_turn', round(avg(coalesce(llm_calls, 0))::numeric, 3),
        'avg_tools_per_turn', round(avg(coalesce(steps, 0))::numeric, 3),
        'tokens_in', sum(coalesce(tokens_in, 0)),
        'tokens_out', sum(coalesce(tokens_out, 0)),
        'tokens_per_turn', round(
          sum(coalesce(tokens_in, 0) + coalesce(tokens_out, 0))::numeric
          / greatest(1, count(*))::numeric, 1),
        'estimated_cost_usd', round(sum(coalesce(estimated_cost_usd, 0))::numeric, 6),
        'provider_cost_usd', sum(provider_cost_usd),
        'compression_ratio', CASE WHEN sum(coalesce(tool_result_full_chars, 0)) > 0
          THEN round(sum(coalesce(tool_result_llm_chars, 0))::numeric
                     / sum(coalesce(tool_result_full_chars, 0))::numeric, 4)
          ELSE NULL END,
        'p50_latency_ms', percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms),
        'p95_latency_ms', percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)
      )
      FROM public.agent_runs WHERE started_at >= v_since
    ),
    'by_capability', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT capability,
               count(*) AS turns,
               round((count(*) FILTER (WHERE path = 'deterministic_tool'))::numeric
                     / greatest(1, count(*))::numeric, 4) AS deterministic_rate,
               sum(coalesce(tokens_in, 0) + coalesce(tokens_out, 0)) AS tokens,
               round(avg(coalesce(llm_calls, 0))::numeric, 3) AS avg_llm_calls,
               percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
               round(sum(coalesce(estimated_cost_usd, 0))::numeric, 6) AS estimated_cost_usd
        FROM public.agent_runs WHERE started_at >= v_since
        GROUP BY capability ORDER BY count(*) DESC LIMIT 25
      ) t
    ), '[]'::jsonb),
    'by_model', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT model, model_tier, count(*) AS turns,
               sum(coalesce(tokens_in, 0)) AS tokens_in,
               sum(coalesce(tokens_out, 0)) AS tokens_out,
               round(sum(coalesce(estimated_cost_usd, 0))::numeric, 6) AS estimated_cost_usd
        FROM public.agent_runs WHERE started_at >= v_since AND model IS NOT NULL
        GROUP BY model, model_tier ORDER BY count(*) DESC LIMIT 25
      ) t
    ), '[]'::jsonb),
    'by_channel', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT channel, count(*) AS turns,
               round(avg(latency_ms)::numeric, 0) AS avg_latency_ms,
               round(sum(coalesce(estimated_cost_usd, 0))::numeric, 6) AS estimated_cost_usd
        FROM public.agent_runs WHERE started_at >= v_since
        GROUP BY channel ORDER BY count(*) DESC LIMIT 10
      ) t
    ), '[]'::jsonb),
    'heaviest_tools', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT tc.tool_name, count(*) AS calls,
               round(avg(tc.duration_ms)::numeric, 0) AS avg_ms,
               count(*) FILTER (WHERE NOT tc.ok) AS failures
        FROM public.agent_tool_calls tc
        JOIN public.agent_runs r ON r.id = tc.run_id
        WHERE r.started_at >= v_since
        GROUP BY tc.tool_name ORDER BY avg(tc.duration_ms) DESC NULLS LAST LIMIT 15
      ) t
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN coalesce(v_out, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_v2_ai_efficiency(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_v2_ai_efficiency(integer) TO authenticated, service_role;