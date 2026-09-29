-- proactive_data_quality.v1 — pedido de dado (ex.: renda do mês não registrada)
-- substitui o falso alarme. É tarefa do app: nunca interrompe no WhatsApp.
insert into public.communication_catalog (
  kind, label, family, description, active, base_priority,
  allowed_channels, default_channels, cooldown_hours, dismiss_cooldown_days,
  not_useful_cooldown_days, max_per_day, requires_manual_approval, content_mode,
  sensitivity, fallback_policy, min_severity_for_whatsapp, stale_policy,
  default_window_hours, min_utility_score, escalation_channels,
  whatsapp_min_confidence, whatsapp_min_absolute_impact, same_pattern_cooldown_days
) values (
  'data_quality', 'Dado faltando', 'categorizacao',
  'Pede um dado que falta (ex.: renda do mês) em vez de alarmar com leitura incompleta.',
  true, 70,
  array['app'], array['app'], 72, 7,
  30, 1, false, 'deterministic',
  'normal', 'app_only', 'critical', 'drop_after_window',
  48, 0.5, array[]::text[],
  0.7, 0, 14
)
on conflict (kind) do nothing;
