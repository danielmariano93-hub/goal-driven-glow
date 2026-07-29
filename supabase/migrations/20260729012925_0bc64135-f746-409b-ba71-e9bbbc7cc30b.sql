ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_path_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_path_check
  CHECK (path = ANY (ARRAY['llm'::text, 'deterministic_fallback'::text, 'fast_log'::text]));