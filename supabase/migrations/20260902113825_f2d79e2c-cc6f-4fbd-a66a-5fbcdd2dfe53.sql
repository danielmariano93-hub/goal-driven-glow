UPDATE public.agent_runtime_flags
SET enabled = true,
    rollout_percent = 0,
    pilot_user_ids = ARRAY['088920ce-1f5e-47d5-9e07-e2e4a63f9214','6be3fc9f-4b6e-4878-b7c8-5ca9d509523c']::uuid[],
    updated_at = now()
WHERE flag_name IN (
  'semantic_ir_v3','semantic_ir_multiquery_v1','semantic_completeness_v1',
  'semantic_allowed_claims_v1','semantic_topic_state_v1',
  'semantic_investigation_loop_v1','semantic_capability_rescue_v1'
);