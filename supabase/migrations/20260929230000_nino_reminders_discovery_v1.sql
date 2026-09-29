-- nino_reminders.v1 + nino_discovery.v1 — novos tipos de comunicação proativa.
-- Lembretes com data (conta do dia, fechamento do cartão) têm identidade por
-- ciclo e momento; o balanço de meio do mês e a dica de uso valem pelo que
-- orientam (sem piso em R$). A dica de uso é a de menor prioridade do catálogo.
insert into public.communication_catalog (
  kind, label, family, description, active, base_priority,
  allowed_channels, default_channels, cooldown_hours, dismiss_cooldown_days,
  not_useful_cooldown_days, max_per_day, requires_manual_approval, content_mode,
  sensitivity, fallback_policy, min_severity_for_whatsapp, stale_policy,
  default_window_hours, min_utility_score, escalation_channels,
  whatsapp_min_confidence, whatsapp_min_absolute_impact, same_pattern_cooldown_days
) values
(
  'bill_due_reminder', 'Conta do mês vencendo', 'recorrencias',
  'Lembra na véspera e no dia as contas recorrentes/planejadas ainda não pagas.',
  true, 230,
  array['app','whatsapp'], array['app','whatsapp'], 12, 3,
  30, 1, false, 'deterministic',
  'normal', 'app_only', 'attention', 'drop_after_window',
  14, 0.5, array[]::text[],
  0.7, 0, 1
),
(
  'card_closing_soon', 'Cartão fechando', 'recorrencias',
  'Avisa 2 dias antes do fechamento do cartão: compra grande pode esperar a fatura seguinte.',
  true, 150,
  array['app','whatsapp'], array['app','whatsapp'], 24, 7,
  30, 1, false, 'deterministic',
  'normal', 'app_only', 'attention', 'drop_after_window',
  14, 0.5, array[]::text[],
  0.7, 0, 20
),
(
  'mid_month_checkin', 'Balanço do meio do mês', 'evolucao',
  'Nos dias 14 a 16: quanto já foi, projeção do mês e comparação com o típico da pessoa.',
  true, 160,
  array['app','whatsapp'], array['app','whatsapp'], 72, 7,
  30, 1, false, 'deterministic',
  'normal', 'app_only', 'info', 'drop_after_window',
  6, 0.5, array[]::text[],
  0.7, 0, 25
),
(
  'feature_discovery', 'Dica de uso do Nino', 'habitos',
  'Apresenta uma funcionalidade que a pessoa ainda não usa. No máximo 1 por semana; nunca repete.',
  true, 40,
  array['app','whatsapp'], array['app','whatsapp'], 168, 30,
  90, 1, false, 'deterministic',
  'normal', 'app_only', 'info', 'drop_after_window',
  4, 0.5, array[]::text[],
  0.7, 0, 7
)
on conflict (kind) do nothing;
