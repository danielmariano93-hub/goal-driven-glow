-- ============================================================================
-- Onda 2 — ciclo real do cartão (card_cycle.v2)
-- ============================================================================

-- 1) Função canônica de ciclo. Espelha src/lib/engine/cardExposure.ts::cycleFor
CREATE OR REPLACE FUNCTION public.card_cycle_for(
  p_closing_day smallint,
  p_due_day smallint,
  p_date date
)
RETURNS TABLE (
  competence_month date,
  period_start date,
  period_end date,
  closing_date date,
  due_date date,
  fallback boolean
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_closing int := COALESCE(p_closing_day, 0);
  v_due int := COALESCE(p_due_day, 0);
  v_closing_month date;
  v_prev_closing date;
  v_due_month date;
BEGIN
  IF p_date IS NULL THEN
    RETURN;
  END IF;

  -- Fallback: sem fechamento válido, o ciclo é o mês calendário.
  IF v_closing < 1 OR v_closing > 31 THEN
    period_start := date_trunc('month', p_date)::date;
    period_end := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
    closing_date := period_end;
    competence_month := period_start;
    IF v_due BETWEEN 1 AND 31 THEN
      due_date := LEAST(
        period_start + (v_due - 1),
        period_end
      );
    ELSE
      due_date := period_end;
    END IF;
    fallback := true;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Mês de fechamento: o próprio mês se a compra ocorreu até o fechamento.
  v_closing_month := date_trunc('month', p_date)::date;
  IF EXTRACT(DAY FROM p_date)::int > LEAST(
       v_closing,
       EXTRACT(DAY FROM (v_closing_month + interval '1 month - 1 day'))::int
     ) THEN
    v_closing_month := (v_closing_month + interval '1 month')::date;
  END IF;

  closing_date := LEAST(
    v_closing_month + (v_closing - 1),
    (v_closing_month + interval '1 month - 1 day')::date
  );
  v_prev_closing := LEAST(
    (v_closing_month - interval '1 month')::date + (v_closing - 1),
    (v_closing_month - interval '1 day')::date
  );
  period_start := v_prev_closing + 1;
  period_end := closing_date;

  -- Vencimento: mesmo mês do fechamento se o dia é maior; senão, mês seguinte.
  IF v_due BETWEEN 1 AND 31 THEN
    v_due_month := CASE WHEN v_due > v_closing
      THEN v_closing_month
      ELSE (v_closing_month + interval '1 month')::date END;
  ELSE
    v_due := v_closing;
    v_due_month := (v_closing_month + interval '1 month')::date;
  END IF;
  due_date := LEAST(
    v_due_month + (v_due - 1),
    (v_due_month + interval '1 month - 1 day')::date
  );

  competence_month := date_trunc('month', due_date)::date;
  fallback := false;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.card_cycle_for(smallint, smallint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.card_cycle_for(smallint, smallint, date) TO authenticated, service_role;

-- 2) Backfill de period_start/period_end/closing_date nas faturas existentes.
-- A competência é o mês do vencimento: o fechamento está no mês anterior quando
-- due_day <= closing_day, e no próprio mês quando due_day > closing_day.
WITH base AS (
  SELECT s.id,
         c.closing_day,
         c.due_day,
         CASE
           WHEN COALESCE(c.due_day, 0) > COALESCE(c.closing_day, 0)
             THEN s.competence_month
           ELSE (s.competence_month - interval '1 month')::date
         END AS closing_month
  FROM public.credit_card_statements s
  JOIN public.credit_cards c ON c.id = s.credit_card_id
  WHERE c.closing_day BETWEEN 1 AND 31
), calc AS (
  SELECT b.id,
         LEAST(
           b.closing_month + (b.closing_day - 1),
           (b.closing_month + interval '1 month - 1 day')::date
         ) AS closing_date,
         LEAST(
           (b.closing_month - interval '1 month')::date + (b.closing_day - 1),
           (b.closing_month - interval '1 day')::date
         ) + 1 AS period_start
  FROM base b
)
UPDATE public.credit_card_statements s
SET period_start = calc.period_start,
    period_end = calc.closing_date,
    closing_date = COALESCE(s.closing_date, calc.closing_date),
    updated_at = now()
FROM calc
WHERE calc.id = s.id
  AND (s.period_start IS DISTINCT FROM calc.period_start
       OR s.period_end IS DISTINCT FROM calc.closing_date
       OR s.closing_date IS NULL);

-- 3) Absorção determinística: SOMENTE por vínculo item↔parcela em fatura
--    fechada/paga. Nunca por competência.
CREATE OR REPLACE FUNCTION public.sync_installment_absorption(p_statement_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- absorve as parcelas com item em fatura fechada/paga
  UPDATE public.credit_card_installments i
  SET absorbed_by_statement_id = s.id,
      absorbed_at = COALESCE(i.absorbed_at, now()),
      updated_at = now()
  FROM public.credit_card_statement_items it
  JOIN public.credit_card_statements s ON s.id = it.statement_id
  WHERE it.installment_id = i.id
    AND s.status IN ('closed', 'paid', 'settled', 'closed_paid', 'approved')
    AND (p_statement_id IS NULL OR s.id = p_statement_id)
    AND i.absorbed_by_statement_id IS DISTINCT FROM s.id;

  -- desfaz absorções sem lastro (sem item, ou item de fatura não fechada)
  UPDATE public.credit_card_installments i
  SET absorbed_by_statement_id = NULL,
      absorbed_at = NULL,
      updated_at = now()
  WHERE i.absorbed_by_statement_id IS NOT NULL
    AND (p_statement_id IS NULL OR i.absorbed_by_statement_id = p_statement_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.credit_card_statement_items it
      JOIN public.credit_card_statements s ON s.id = it.statement_id
      WHERE it.installment_id = i.id
        AND s.id = i.absorbed_by_statement_id
        AND s.status IN ('closed', 'paid', 'settled', 'closed_paid', 'approved')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_installment_absorption(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_installment_absorption(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_sync_installment_absorption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'credit_card_statements' THEN
    PERFORM public.sync_installment_absorption(NEW.id);
    RETURN NEW;
  END IF;
  PERFORM public.sync_installment_absorption(COALESCE(NEW.statement_id, OLD.statement_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_absorption_on_statement_status ON public.credit_card_statements;
CREATE TRIGGER trg_absorption_on_statement_status
AFTER UPDATE OF status ON public.credit_card_statements
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_installment_absorption();

DROP TRIGGER IF EXISTS trg_absorption_on_statement_items ON public.credit_card_statement_items;
CREATE TRIGGER trg_absorption_on_statement_items
AFTER INSERT OR DELETE OR UPDATE OF installment_id ON public.credit_card_statement_items
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_installment_absorption();

SELECT public.sync_installment_absorption(NULL);

-- 4) competence_date pelo ciclo real, apenas para compras que ainda NÃO estão
--    em nenhuma fatura (nunca reescrever histórico já conciliado).
WITH alvo AS (
  SELECT t.id, cy.competence_month
  FROM public.transactions t
  JOIN public.credit_cards c ON c.id = t.credit_card_id
  CROSS JOIN LATERAL public.card_cycle_for(c.closing_day, c.due_day, t.occurred_at) cy
  WHERE t.credit_card_id IS NOT NULL
    AND t.settles_card_id IS NULL
    AND c.closing_day BETWEEN 1 AND 31
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_card_statement_items it
      WHERE it.legacy_transaction_id = t.id
    )
    AND t.competence_date IS DISTINCT FROM cy.competence_month
)
UPDATE public.transactions t
SET competence_date = alvo.competence_month
FROM alvo
WHERE alvo.id = t.id;