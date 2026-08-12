INSERT INTO public.notification_preferences (user_id, whatsapp_proactive, anticipation_whatsapp)
SELECT u.id, true, true
FROM auth.users u
LEFT JOIN public.notification_preferences p ON p.user_id = u.id
WHERE p.user_id IS NULL;

UPDATE public.notification_preferences
SET whatsapp_proactive = true, anticipation_whatsapp = true, updated_at = now()
WHERE whatsapp_proactive = false;

ALTER TABLE public.notification_preferences ALTER COLUMN whatsapp_proactive SET DEFAULT true;
ALTER TABLE public.notification_preferences ALTER COLUMN anticipation_whatsapp SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.ensure_notification_preferences()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_notification_preferences ON auth.users;
CREATE TRIGGER trg_ensure_notification_preferences
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.ensure_notification_preferences();

INSERT INTO public.communication_catalog
  (kind, label, family, description, active, allowed_channels, default_channels, min_severity_for_whatsapp)
VALUES
  ('concentration_risk', 'Risco de concentração de gastos', 'gastos', 'Uma categoria concentra parte incomum do gasto do período.', true, ARRAY['app','whatsapp'], ARRAY['app'], 'attention'),
  ('growing_category', 'Categoria em crescimento', 'gastos', 'Categoria com crescimento consistente entre períodos comparáveis.', true, ARRAY['app','whatsapp'], ARRAY['app'], 'attention'),
  ('cash_flow_imbalance', 'Desequilíbrio de caixa', 'gastos', 'Saídas previstas superam a entrada esperada do período.', true, ARRAY['app','whatsapp'], ARRAY['app','whatsapp'], 'attention'),
  ('recurring_commitment_pressure', 'Pressão de compromissos', 'recorrencias', 'Compromissos recorrentes concentrados perto do mesmo vencimento.', true, ARRAY['app','whatsapp'], ARRAY['app'], 'attention'),
  ('goal_feasibility', 'Viabilidade da meta', 'metas', 'A meta deixou de ser viável no ritmo atual de contribuição.', true, ARRAY['app','whatsapp'], ARRAY['app'], 'attention'),
  ('debt_overdue', 'Dívida em atraso', 'recorrencias', 'Parcela de dívida vencida sem pagamento registrado.', true, ARRAY['app','whatsapp'], ARRAY['app','whatsapp'], 'attention'),
  ('debt_due_soon', 'Dívida a vencer', 'recorrencias', 'Parcela de dívida vence nos próximos dias.', true, ARRAY['app','whatsapp'], ARRAY['app'], 'attention'),
  ('debt_installment_due', 'Parcela de dívida no vencimento', 'recorrencias', 'Parcela de dívida vence hoje e segue sem registro de pagamento.', true, ARRAY['app','whatsapp'], ARRAY['app','whatsapp'], 'attention')
ON CONFLICT (kind) DO UPDATE
SET active = true,
    allowed_channels = EXCLUDED.allowed_channels,
    min_severity_for_whatsapp = EXCLUDED.min_severity_for_whatsapp;

UPDATE public.communication_catalog
SET allowed_channels = ARRAY['app','whatsapp']
WHERE kind IN (
  'saving_opportunity','underused_subscription','relapse_risk','impulsive_spending',
  'emotional_spending','engagement_drop','financial_discipline','financial_procrastination',
  'recurring_pattern','advisor_review_weekly','advisor_review_monthly','spending_spike',
  'duplicate_expense','forgotten_bill','goal_at_risk'
);