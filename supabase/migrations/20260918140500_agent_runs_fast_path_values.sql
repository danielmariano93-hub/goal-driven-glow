-- Fast-path telemetry is intentionally more specific than the public turn path.
-- AgentCore has emitted these two values since nino_confirmation.v1, but the
-- historical CHECK still allowed only the coarse route taxonomy. The UPDATE
-- that closes a run therefore failed after the user had already received the
-- correct reply, leaving agent_runs.status='running'.
--
-- Keep the existing values for backwards compatibility and add only the two
-- runtime paths that are already first-class observability keys in TurnBudget.

ALTER TABLE public.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_path_check;

ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_path_check
  CHECK (
    path IS NULL
    OR path = ANY (
      ARRAY[
        'llm'::text,
        'deterministic_tool'::text,
        'deterministic_fallback'::text,
        'fast_log'::text,
        'confirmation_fast_path'::text,
        'structured_entry_fast_path'::text
      ]
    )
  );

COMMENT ON CONSTRAINT agent_runs_path_check ON public.agent_runs IS
  'Allowed execution paths, including deterministic confirmation and structured bank-entry fast paths.';
