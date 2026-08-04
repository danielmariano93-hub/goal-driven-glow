-- 1) Rollout controlado do Motor de Antecipação (apenas Daniel, em simulação).
UPDATE public.agent_settings
SET anticipation_enabled = true,
    anticipation_dry_run = true,
    anticipation_rollout_pct = 0,
    anticipation_rollout_user_ids = ARRAY['088920ce-1f5e-47d5-9e07-e2e4a63f9214']::uuid[],
    updated_at = now()
WHERE id = (SELECT id FROM public.agent_settings ORDER BY id LIMIT 1);

-- 2) Contrato de escalação por tipo de comunicação.
ALTER TABLE public.communication_catalog
  ADD COLUMN IF NOT EXISTS escalation_channels text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS whatsapp_min_confidence numeric NOT NULL DEFAULT 0.7,
  ADD COLUMN IF NOT EXISTS whatsapp_min_absolute_impact numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS same_pattern_cooldown_days integer NOT NULL DEFAULT 14;

UPDATE public.communication_catalog c SET
  active = true,
  default_channels = ARRAY['app']::text[],
  escalation_channels = v.escalation,
  whatsapp_min_confidence = v.min_conf,
  whatsapp_min_absolute_impact = v.min_impact,
  cooldown_hours = v.cooldown_hours,
  same_pattern_cooldown_days = v.cooldown_days,
  updated_at = now()
FROM (VALUES
  ('anticipation_cash_pressure', ARRAY['whatsapp']::text[], 0.60, 50, 48, 7),
  ('anticipation_card_acceleration', ARRAY['whatsapp']::text[], 0.65, 80, 72, 7),
  ('anticipation_weekday_risk', ARRAY['whatsapp']::text[], 0.75, 120, 336, 14),
  ('anticipation_weekend_risk', ARRAY['whatsapp']::text[], 0.75, 120, 336, 14),
  ('anticipation_month_phase_risk', ARRAY[]::text[], 0.85, 200, 120, 14),
  ('anticipation_small_spend', ARRAY[]::text[], 0.99, 999999, 120, 14),
  ('anticipation_recurring_payment', ARRAY['whatsapp']::text[], 0.70, 100, 72, 7)
) AS v(kind, escalation, min_conf, min_impact, cooldown_hours, cooldown_days)
WHERE c.kind = v.kind;