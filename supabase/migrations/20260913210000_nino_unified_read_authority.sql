-- Nino Unified Read Authority v1
--
-- Ativa globalmente as duas proteções factuais que já estão integradas ao
-- SemanticTurnPipeline. A migration é idempotente e mantém rollback por flag.
INSERT INTO public.agent_runtime_flags (
  flag_name, enabled, rollout_percent, pilot_user_ids, description
)
VALUES
  (
    'semantic_preservation_v1', true, 100, '{}'::uuid[],
    'Bloqueia resposta quando filtro, período, métrica ou escopo executado diverge do pedido.'
  ),
  (
    'typical_monthly_v1', true, 100, '{}'::uuid[],
    'Usa meses completos e estatística canônica para perguntas de gasto típico mensal.'
  )
ON CONFLICT (flag_name) DO UPDATE
SET enabled = EXCLUDED.enabled,
    rollout_percent = EXCLUDED.rollout_percent,
    pilot_user_ids = EXCLUDED.pilot_user_ids,
    description = EXCLUDED.description,
    updated_at = now();
