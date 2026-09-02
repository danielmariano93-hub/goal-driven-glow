-- nino_semantic_ir.v3 — flags de rollout independentes, TODAS desligadas.
-- Idempotente: pode ser reaplicada sem efeito colateral. Não altera a
-- configuração existente de `semantic_ir_v1`.
INSERT INTO public.agent_runtime_flags (flag_name, enabled, rollout_percent, pilot_user_ids)
VALUES
  ('semantic_ir_v3', false, 0, '{}'::uuid[]),
  ('semantic_ir_multiquery_v1', false, 0, '{}'::uuid[]),
  ('semantic_completeness_v1', false, 0, '{}'::uuid[]),
  ('semantic_allowed_claims_v1', false, 0, '{}'::uuid[]),
  ('semantic_topic_state_v1', false, 0, '{}'::uuid[]),
  ('semantic_investigation_loop_v1', false, 0, '{}'::uuid[]),
  ('semantic_capability_rescue_v1', false, 0, '{}'::uuid[])
ON CONFLICT (flag_name) DO NOTHING;
