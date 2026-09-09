UPDATE public.agent_runtime_flags
SET enabled = true,
    rollout_percent = 100,
    pilot_user_ids = '{}'::uuid[],
    updated_at = now()
WHERE flag_name IN (
  'semantic_ir_v3',
  'semantic_ir_multiquery_v1',
  'semantic_completeness_v1',
  'semantic_allowed_claims_v1',
  'semantic_topic_state_v1',
  'semantic_investigation_loop_v1',
  'semantic_capability_rescue_v1'
);

UPDATE public.agent_runtime_flags
SET pilot_user_ids = '{}'::uuid[],
    description = COALESCE(description, '') || ' [DEPRECADO: só roda quando o semantic_ir_v3 não decidiu o turno]',
    updated_at = now()
WHERE flag_name = 'semantic_ir_v1';