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
  ('upcoming_cash_pressure', ARRAY['whatsapp']::text[], 0.60, 50, 48, 7),
  ('card_cycle_acceleration', ARRAY['whatsapp']::text[], 0.65, 80, 72, 7),
  ('weekday_spending_risk', ARRAY['whatsapp']::text[], 0.75, 120, 336, 14),
  ('weekend_spending_risk', ARRAY['whatsapp']::text[], 0.75, 120, 336, 14),
  ('month_phase_spending_risk', ARRAY[]::text[], 0.85, 200, 120, 14),
  ('small_spend_acceleration', ARRAY[]::text[], 0.99, 999999, 120, 14),
  ('expected_recurring_payment', ARRAY['whatsapp']::text[], 0.70, 100, 72, 7)
) AS v(kind, escalation, min_conf, min_impact, cooldown_hours, cooldown_days)
WHERE c.kind = v.kind AND c.family = 'anticipation';