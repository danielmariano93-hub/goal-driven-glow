ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS fallback_attempts integer NOT NULL DEFAULT 0,
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
  ADD COLUMN IF NOT EXISTS truth_validation_failed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clarification_asked boolean NOT NULL DEFAULT false;

INSERT INTO public.ai_model_routes (task, primary_model, fallback_model, max_latency_ms, max_steps, active)
VALUES ('document_text', 'google/gemini-3.7-flash', 'openai/gpt-5.4-mini', 30000, 2, true)
ON CONFLICT (task) DO UPDATE
  SET primary_model = EXCLUDED.primary_model,
      fallback_model = EXCLUDED.fallback_model,
      max_latency_ms = EXCLUDED.max_latency_ms,
      max_steps = EXCLUDED.max_steps,
      active = true;