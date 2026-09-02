ALTER TABLE public.agent_runtime_flags
  ADD COLUMN IF NOT EXISTS rollout_percent integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS pilot_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.agent_runtime_flags
  DROP CONSTRAINT IF EXISTS agent_runtime_flags_rollout_percent_range;
ALTER TABLE public.agent_runtime_flags
  ADD CONSTRAINT agent_runtime_flags_rollout_percent_range
  CHECK (rollout_percent >= 0 AND rollout_percent <= 100);

INSERT INTO public.agent_runtime_flags (flag_name, enabled, rollout_percent, pilot_user_ids)
VALUES ('semantic_ir_v1', false, 0, '{}'::uuid[])
ON CONFLICT (flag_name) DO NOTHING;