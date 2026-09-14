-- Conversation Architecture V2 — production rollout 100%
-- Explicitly authorized production activation after CI/golden regressions.
-- Keeps shadow disabled because the V2 becomes authoritative for all users.

INSERT INTO public.agent_runtime_flags (flag_name, enabled, rollout_percent, pilot_user_ids)
VALUES
  ('conversation_brain_v1', true, 100, '{}'::uuid[]),
  ('write_workflow_v1', true, 100, '{}'::uuid[]),
  ('conversation_brain_shadow_v1', false, 0, '{}'::uuid[])
ON CONFLICT (flag_name) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  rollout_percent = EXCLUDED.rollout_percent,
  pilot_user_ids = EXCLUDED.pilot_user_ids;
