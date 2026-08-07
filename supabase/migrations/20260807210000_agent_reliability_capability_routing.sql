-- Nino Agent Reliability — global rollout, no user allow-list.
-- Adds explainable capability/tool/model telemetry and guarantees that the
-- configured provider fallback is actually independent from the primary.

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS capability text,
  ADD COLUMN IF NOT EXISTS tool_scope text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS model_attempts jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.agent_turn_events
  ADD COLUMN IF NOT EXISTS capability text,
  ADD COLUMN IF NOT EXISTS tool_scope text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS model_attempts jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_path_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_path_check
  CHECK (path IS NULL OR path = ANY (ARRAY[
    'llm'::text,
    'deterministic_tool'::text,
    'deterministic_fallback'::text,
    'fast_log'::text
  ]));

CREATE INDEX IF NOT EXISTS idx_agent_runs_capability_created
  ON public.agent_runs(capability, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_turn_events_capability_created
  ON public.agent_turn_events(capability, created_at DESC);

-- Existing installations used Gemini as both primary and fallback. Preserve
-- every explicit cross-provider choice and only repair null/same-model routes.
UPDATE public.ai_model_routes
SET fallback_model = CASE
      WHEN primary_model LIKE 'google/%' THEN 'openai/gpt-5-mini'
      ELSE 'google/gemini-2.5-flash'
    END,
    updated_at = now()
WHERE active = true
  AND (fallback_model IS NULL OR fallback_model = primary_model);

COMMENT ON COLUMN public.agent_runs.capability IS
  'Deterministic capability selected before any LLM call; global for every user.';
COMMENT ON COLUMN public.agent_runs.tool_scope IS
  'Exact allow-list of tools exposed to the model in this turn.';
COMMENT ON COLUMN public.agent_runs.model_attempts IS
  'Ordered, sanitized provider/model attempts used for reliability diagnostics.';
