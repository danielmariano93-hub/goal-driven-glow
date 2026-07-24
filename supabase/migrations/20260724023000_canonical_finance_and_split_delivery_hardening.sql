-- Meu Nino: consolida a fundação financeira e a entrega 24/7 da Divisão do Rolê.
-- A migration é aditiva/corretiva: não liga feature flags e não remove histórico.

-- As tabelas operacionais abaixo são exclusivas do backend.
ALTER TABLE public.financial_backfill_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_metric_diffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_backfill_checkpoints, public.financial_metric_diffs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.financial_backfill_checkpoints, public.financial_metric_diffs
  TO service_role;

-- Vocabulário canônico alinhado ao constraint atual de transactions.movement_kind:
-- transaction, refund, internal_transfer, investment_application,
-- investment_redemption, investment_yield e loan_proceeds.
CREATE OR REPLACE FUNCTION public.is_behavioral_consumption(
  p_type text,
  p_status text,
  p_movement_kind text,
  p_transfer_group_id uuid,
  p_settles_card_id uuid
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_type = 'expense'
     AND coalesce(p_status, 'confirmed') = 'confirmed'
     AND p_transfer_group_id IS NULL
     AND p_settles_card_id IS NULL
     AND coalesce(p_movement_kind, 'transaction') = 'transaction'
$$;

CREATE OR REPLACE FUNCTION public.refresh_financial_daily_facts(
  p_user_id uuid,
  p_from date,
  p_to date
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  IF p_user_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'invalid_refresh_range';
  END IF;

  DELETE FROM public.financial_daily_facts
   WHERE user_id = p_user_id AND fact_date BETWEEN p_from AND p_to;
  DELETE FROM public.financial_daily_category_facts
   WHERE user_id = p_user_id AND fact_date BETWEEN p_from AND p_to;

  INSERT INTO public.financial_daily_facts(
    user_id, fact_date, income, cash_outflow, behavioral_consumption,
    account_consumption, card_consumption, transaction_count,
    formula_version
  )
  SELECT
    t.user_id,
    t.occurred_at::date,
    -- Renda comportamental: só entradas comuns. Estorno, resgate,
    -- rendimento de investimento e crédito de empréstimo não são renda.
    coalesce(sum(t.amount) FILTER (
      WHERE t.type = 'income'
        AND coalesce(t.status, 'confirmed') = 'confirmed'
        AND t.transfer_group_id IS NULL
        AND coalesce(t.movement_kind, 'transaction') = 'transaction'
    ), 0),
    -- Saída literal da conta: inclui aplicação e pagamento de fatura,
    -- mas não cartão, transferência interna ou lançamento planejado.
    coalesce(sum(t.amount) FILTER (
      WHERE t.type = 'expense'
        AND coalesce(t.status, 'confirmed') = 'confirmed'
        AND t.transfer_group_id IS NULL
        AND coalesce(t.movement_kind, 'transaction') <> 'internal_transfer'
        AND t.credit_card_id IS NULL
        AND coalesce(t.payment_method, 'account') <> 'credit_card'
    ), 0),
    -- Consumo real: despesa comum menos estornos confirmados.
    coalesce(sum(
      CASE
        WHEN public.is_behavioral_consumption(
          t.type::text, t.status::text, t.movement_kind,
          t.transfer_group_id, t.settles_card_id
        ) THEN t.amount
        WHEN t.type = 'income'
          AND coalesce(t.status, 'confirmed') = 'confirmed'
          AND t.transfer_group_id IS NULL
          AND coalesce(t.movement_kind, 'transaction') = 'refund'
          THEN -t.amount
        ELSE 0
      END
    ), 0),
    -- Consumo pago em conta, líquido de estornos de conta.
    coalesce(sum(
      CASE
        WHEN public.is_behavioral_consumption(
          t.type::text, t.status::text, t.movement_kind,
          t.transfer_group_id, t.settles_card_id
        )
        AND t.credit_card_id IS NULL
        AND coalesce(t.payment_method, 'account') <> 'credit_card'
          THEN t.amount
        WHEN t.type = 'income'
          AND coalesce(t.status, 'confirmed') = 'confirmed'
          AND coalesce(t.movement_kind, 'transaction') = 'refund'
          AND t.credit_card_id IS NULL
          AND coalesce(t.payment_method, 'account') <> 'credit_card'
          THEN -t.amount
        ELSE 0
      END
    ), 0),
    -- Consumo de cartão, líquido de estornos identificados no cartão.
    coalesce(sum(
      CASE
        WHEN public.is_behavioral_consumption(
          t.type::text, t.status::text, t.movement_kind,
          t.transfer_group_id, t.settles_card_id
        )
        AND (t.credit_card_id IS NOT NULL OR t.payment_method = 'credit_card')
          THEN t.amount
        WHEN t.type = 'income'
          AND coalesce(t.status, 'confirmed') = 'confirmed'
          AND coalesce(t.movement_kind, 'transaction') = 'refund'
          AND (t.credit_card_id IS NOT NULL OR t.payment_method = 'credit_card')
          THEN -t.amount
        ELSE 0
      END
    ), 0),
    (count(*) FILTER (
      WHERE coalesce(t.status, 'confirmed') = 'confirmed'
    ))::integer,
    'financial_daily.v2'
  FROM public.transactions t
  WHERE t.user_id = p_user_id
    AND t.occurred_at::date BETWEEN p_from AND p_to
  GROUP BY t.user_id, t.occurred_at::date;
  GET DIAGNOSTICS affected = ROW_COUNT;

  INSERT INTO public.financial_daily_category_facts(
    user_id, fact_date, category_id, consumption, transaction_count,
    formula_version
  )
  SELECT
    t.user_id,
    t.occurred_at::date,
    t.category_id,
    sum(CASE WHEN t.movement_kind = 'refund' THEN -t.amount ELSE t.amount END),
    (count(*) FILTER (WHERE t.type = 'expense'))::integer,
    'financial_daily_category.v2'
  FROM public.transactions t
  WHERE t.user_id = p_user_id
    AND t.occurred_at::date BETWEEN p_from AND p_to
    AND (
      public.is_behavioral_consumption(
        t.type::text, t.status::text, t.movement_kind,
        t.transfer_group_id, t.settles_card_id
      )
      OR (
        t.type = 'income'
        AND coalesce(t.status, 'confirmed') = 'confirmed'
        AND t.transfer_group_id IS NULL
        AND coalesce(t.movement_kind, 'transaction') = 'refund'
      )
    )
  GROUP BY t.user_id, t.occurred_at::date, t.category_id;

  RETURN affected;
END
$$;
REVOKE ALL ON FUNCTION public.refresh_financial_daily_facts(uuid,date,date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_financial_daily_facts(uuid,date,date)
  TO service_role;

-- Templates determinísticos que haviam ficado apenas na migration original,
-- não registrada pela Lovable.
INSERT INTO public.financial_report_templates(template_key, name, definition, active)
VALUES
  ('spending_trend', 'Evolução dos gastos', jsonb_build_object(
    'chart', 'line', 'curve', 'monotone',
    'metric', 'behavioral_consumption',
    'series', jsonb_build_array('daily', 'cumulative_average'),
    'formula_version', 'financial_daily.v2'
  ), true),
  ('monthly_comparison', 'Comparativo mensal', jsonb_build_object(
    'chart', 'bar', 'metric', 'behavioral_consumption',
    'formula_version', 'financial_daily.v2'
  ), true),
  ('weekly_one_page', 'One Page semanal', jsonb_build_object(
    'sections', jsonb_build_array(
      'snapshot', 'trend', 'categories', 'goals', 'next_actions'
    ),
    'formula_version', 'financial_daily.v2'
  ), true)
ON CONFLICT (template_key) DO UPDATE
  SET name = excluded.name,
      definition = excluded.definition,
      active = excluded.active,
      updated_at = now();

UPDATE public.financial_report_templates
   SET active = false, updated_at = now()
 WHERE template_key = 'weekly_reflection_v1';

-- A Divisão do Rolê opera 24/7. Mantém lease, limite de tentativas,
-- scheduled_for e SKIP LOCKED; remove somente a janela artificial 08–22.
CREATE OR REPLACE FUNCTION public.claim_reminder_jobs(p_limit integer DEFAULT 10)
RETURNS SETOF public.reminder_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    UPDATE public.reminder_jobs r
       SET status = 'processing'::public.reminder_status,
           attempts = coalesce(r.attempts, 0) + 1,
           lease_expires_at = now() + interval '2 minutes',
           updated_at = now()
     WHERE r.id IN (
       SELECT q.id
         FROM public.reminder_jobs q
        WHERE (
          q.status = 'queued'::public.reminder_status
          OR (
            q.status = 'processing'::public.reminder_status
            AND q.lease_expires_at < now()
          )
        )
          AND q.scheduled_for <= now()
          AND coalesce(q.attempts, 0) < 5
        ORDER BY q.scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT greatest(1, least(coalesce(p_limit, 10), 50))
     )
     RETURNING r.*;
END
$$;
REVOKE ALL ON FUNCTION public.claim_reminder_jobs(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reminder_jobs(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_reminder_jobs_for_owner(
  p_owner_user_id uuid,
  p_limit integer DEFAULT 10
) RETURNS SETOF public.reminder_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_owner_user_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.reminder_jobs r
       SET status = 'processing'::public.reminder_status,
           attempts = coalesce(r.attempts, 0) + 1,
           lease_expires_at = now() + interval '2 minutes',
           updated_at = now()
     WHERE r.id IN (
       SELECT q.id
         FROM public.reminder_jobs q
        WHERE q.owner_user_id = p_owner_user_id
          AND (
            q.status = 'queued'::public.reminder_status
            OR (
              q.status = 'processing'::public.reminder_status
              AND q.lease_expires_at < now()
            )
          )
          AND q.scheduled_for <= now()
          AND coalesce(q.attempts, 0) < 5
        ORDER BY q.scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT greatest(1, least(coalesce(p_limit, 10), 20))
     )
     RETURNING r.*;
END
$$;
REVOKE ALL ON FUNCTION public.claim_reminder_jobs_for_owner(uuid,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reminder_jobs_for_owner(uuid,integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.split_send_reminders(p_shared_expense_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  se record;
  participant record;
  queued_count integer := 0;
  job_id uuid;
BEGIN
  SELECT * INTO se
    FROM public.shared_expenses
   WHERE id = p_shared_expense_id;

  IF NOT FOUND OR se.owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  IF NOT se.reminder_enabled THEN
    RAISE EXCEPTION 'reminders_disabled';
  END IF;

  FOR participant IN
    SELECT *
      FROM public.shared_expense_participants
     WHERE shared_expense_id = p_shared_expense_id
       AND owner_user_id = auth.uid()
       AND status IN ('pending', 'partial', 'notified')
       AND phone_e164 IS NOT NULL
       AND opt_out_at IS NULL
       AND (last_reminded_at IS NULL OR last_reminded_at < now() - interval '24 hours')
       AND reminder_count < 5
  LOOP
    job_id := public.split_enqueue_message(
      p_shared_expense_id, participant.id, 'reminder', now()
    );
    IF job_id IS NOT NULL THEN
      UPDATE public.shared_expense_participants
         SET last_reminded_at = now(),
             reminder_count = reminder_count + 1,
             status = CASE
               WHEN status = 'pending' THEN 'notified'
               ELSE status
             END,
             updated_at = now()
       WHERE id = participant.id;
      queued_count := queued_count + 1;
    END IF;
  END LOOP;

  INSERT INTO public.shared_expense_events(
    shared_expense_id, owner_user_id, event_type, payload
  )
  VALUES (
    p_shared_expense_id, auth.uid(), 'reminders_scheduled',
    jsonb_build_object('count', queued_count, 'delivery_window', '24x7')
  );

  RETURN queued_count;
END
$$;

NOTIFY pgrst, 'reload schema';
