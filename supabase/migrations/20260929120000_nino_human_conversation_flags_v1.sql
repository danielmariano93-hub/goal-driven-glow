-- Nino human conversation v1: rollout flags.
--
-- conversational_composer_v1  reactive chat voice (evidence-guarded composer)
-- relationship_memory_v1      durable personal context captured by the composer
-- compound_turns_v1           multi-family TurnSpec V3 plans + goal projection
-- advisor_reasoning_v1        scenario / decision / goal projection reasoning
-- v3_first_authority_v1       V3 before the closed compiler (compiler = provider recovery)
--
-- Registered enabled at 0% with no pilots. Rollout is an operational decision
-- (pilot_user_ids / rollout_percent), so an existing row is never overwritten.
INSERT INTO public.agent_runtime_flags (flag_name, enabled, description, rollout_percent, pilot_user_ids)
VALUES
  ('conversational_composer_v1', true, 'Reactive chat voice: evidence-guarded conversational composer', 0, '{}'::uuid[]),
  ('relationship_memory_v1', true, 'Persist durable personal context volunteered in conversation', 0, '{}'::uuid[]),
  ('compound_turns_v1', true, 'Execute multi-family TurnSpec V3 plans (fact+advice, write+read, goal projection)', 0, '{}'::uuid[]),
  ('advisor_reasoning_v1', true, 'Scenario, decision and goal projection advisory reasoning', 0, '{}'::uuid[]),
  ('v3_first_authority_v1', true, 'V3 before closed deterministic compiler (compiler only as provider recovery)', 0, '{}'::uuid[])
ON CONFLICT (flag_name) DO NOTHING;
