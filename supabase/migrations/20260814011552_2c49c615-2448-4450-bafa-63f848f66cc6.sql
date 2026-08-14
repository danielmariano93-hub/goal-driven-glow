UPDATE public.communication_catalog
SET allowed_channels = ARRAY['app','whatsapp']::text[],
    default_channels = ARRAY['app','whatsapp']::text[],
    min_severity_for_whatsapp = 'attention',
    updated_at = now()
WHERE kind IN (
  'advisor_review_weekly',
  'advisor_review_monthly',
  'cash_flow_imbalance',
  'concentration_risk',
  'debt_due_soon',
  'debt_installment_due',
  'debt_overdue',
  'duplicate_expense',
  'expected_recurring_payment',
  'forgotten_bill',
  'goal_at_risk',
  'goal_feasibility',
  'growing_category',
  'month_phase_spending_risk',
  'recurring_commitment_pressure',
  'relapse_risk',
  'spending_spike',
  'upcoming_cash_pressure',
  'weekday_spending_risk',
  'weekend_spending_risk'
);

UPDATE public.pending_proactive_suggestions AS suggestion
SET status = 'pending',
    dismissed_at = NULL,
    dispatched_at = NULL,
    next_attempt_at = NULL,
    defer_reason = NULL
WHERE suggestion.status = 'dismissed'
  AND suggestion.created_at >= now() - interval '7 days'
  AND (suggestion.expires_at IS NULL OR suggestion.expires_at > now())
  AND suggestion.severity IN ('attention', 'critical')
  AND suggestion.kind IN (
    SELECT catalog.kind
    FROM public.communication_catalog AS catalog
    WHERE catalog.active = true
      AND 'whatsapp' = ANY(catalog.default_channels)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.communication_deliveries AS delivery
    WHERE delivery.suggestion_id = suggestion.id
  );