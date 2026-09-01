-- nino_behavioral_timing.v1 — camada de MOMENTO (quando intervir).
-- Nenhum valor financeiro nasce aqui: o evento referencia o fato econômico.

CREATE TABLE IF NOT EXISTS public.nino_behavioral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  economic_event_id uuid,
  economic_event_table text,
  occurred_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  materiality numeric NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_key text NOT NULL,
  processed_at timestamptz,
  processing_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nino_behavioral_events_type_chk CHECK (event_type IN (
    'MONEY_IN','LARGE_SPEND','FLEXIBLE_SPEND_CLUSTER','CREDIT_CARD_CLOSE',
    'CREDIT_CARD_DUE_SOON','DEBT_INSTALLMENT_DUE','GOAL_OPPORTUNITY','CASH_RECOVERY',
    'CASH_RISK','BEHAVIOR_BREAKTHROUGH','BEHAVIOR_RELAPSE','COMMITMENT_WINDOW',
    'PERIOD_TRANSITION','GOAL_CONTRIBUTION','DEBT_PAYMENT','INVESTMENT_MOVEMENT'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS nino_behavioral_events_dedup_uq
  ON public.nino_behavioral_events (user_id, dedup_key);
CREATE INDEX IF NOT EXISTS nino_behavioral_events_pending_idx
  ON public.nino_behavioral_events (user_id, processed_at, occurred_at DESC);
CREATE INDEX IF NOT EXISTS nino_behavioral_events_type_idx
  ON public.nino_behavioral_events (event_type, occurred_at DESC);

GRANT SELECT ON public.nino_behavioral_events TO authenticated;
GRANT ALL ON public.nino_behavioral_events TO service_role;
ALTER TABLE public.nino_behavioral_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own behavioral events" ON public.nino_behavioral_events;
CREATE POLICY "own behavioral events" ON public.nino_behavioral_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_nino_behavioral_events_touch ON public.nino_behavioral_events;
CREATE TRIGGER trg_nino_behavioral_events_touch
  BEFORE UPDATE ON public.nino_behavioral_events
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- Política de janelas: configurável, nunca hardcoded em vários arquivos.
CREATE TABLE IF NOT EXISTS public.nino_behavioral_timing_windows (
  event_type text PRIMARY KEY,
  label text NOT NULL,
  open_after_hours numeric NOT NULL DEFAULT 0,
  valid_for_hours numeric NOT NULL DEFAULT 24,
  min_evidence_count integer NOT NULL DEFAULT 1,
  relative_floor_pct numeric NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.nino_behavioral_timing_windows TO authenticated;
GRANT ALL ON public.nino_behavioral_timing_windows TO service_role;
ALTER TABLE public.nino_behavioral_timing_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timing windows readable" ON public.nino_behavioral_timing_windows;
CREATE POLICY "timing windows readable" ON public.nino_behavioral_timing_windows
  FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_nino_timing_windows_touch ON public.nino_behavioral_timing_windows;
CREATE TRIGGER trg_nino_timing_windows_touch
  BEFORE UPDATE ON public.nino_behavioral_timing_windows
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

INSERT INTO public.nino_behavioral_timing_windows
  (event_type, label, open_after_hours, valid_for_hours, min_evidence_count, relative_floor_pct, notes)
VALUES
  ('MONEY_IN','Entrada de dinheiro',0,36,1,0.03,'Janela curta: antes de a folga se misturar ao mês.'),
  ('LARGE_SPEND','Gasto material',0,48,1,0.05,'Só quando houver ação útil; sem sermão retrospectivo.'),
  ('FLEXIBLE_SPEND_CLUSTER','Concentração de gastos flexíveis',0,72,5,0.05,'Exige amostra mínima.'),
  ('CREDIT_CARD_CLOSE','Fechamento de fatura',0,72,1,0.05,NULL),
  ('CREDIT_CARD_DUE_SOON','Vencimento de fatura próximo',0,120,1,0.03,NULL),
  ('DEBT_INSTALLMENT_DUE','Parcela de dívida próxima',0,120,1,0.03,NULL),
  ('GOAL_OPPORTUNITY','Folga com meta ativa',0,72,1,0.03,NULL),
  ('CASH_RECOVERY','Recuperação de caixa',0,72,1,0.03,NULL),
  ('CASH_RISK','Risco de caixa',0,96,1,0.02,NULL),
  ('BEHAVIOR_BREAKTHROUGH','Comportamento repetido',0,168,3,0,'Exige repetição real (3 ciclos).'),
  ('BEHAVIOR_RELAPSE','Recaída de padrão',0,120,2,0.03,NULL),
  ('COMMITMENT_WINDOW','Janela do compromisso',0,48,1,0,'Evento real vence cadência genérica.'),
  ('PERIOD_TRANSITION','Virada de período',0,48,5,0,'Só com dado suficiente.'),
  ('GOAL_CONTRIBUTION','Aporte em meta',0,72,1,0,NULL),
  ('DEBT_PAYMENT','Pagamento de dívida',0,72,1,0,NULL),
  ('INVESTMENT_MOVEMENT','Movimento de investimento',0,72,1,0,NULL)
ON CONFLICT (event_type) DO NOTHING;

-- Papéis distintos: priority_score (importância) x timing_score (momento).
ALTER TABLE public.proactive_situations
  ADD COLUMN IF NOT EXISTS timing_score numeric,
  ADD COLUMN IF NOT EXISTS timing_trigger text,
  ADD COLUMN IF NOT EXISTS timing_window text,
  ADD COLUMN IF NOT EXISTS defer_until timestamptz;

ALTER TABLE public.proactive_decisions
  ADD COLUMN IF NOT EXISTS timing_score numeric,
  ADD COLUMN IF NOT EXISTS timing_trigger text,
  ADD COLUMN IF NOT EXISTS defer_until timestamptz;

-- ------------------------------------------------------------------
-- Gatilhos: apenas REGISTRAM o evento. Nenhuma IA, nenhum cálculo aqui.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_mark_behavioral_event(
  _user_id uuid, _event_type text, _occurred_at timestamptz,
  _economic_event_id uuid, _economic_event_table text,
  _materiality numeric, _payload jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _user_id IS NULL OR _event_type IS NULL THEN RETURN; END IF;
  INSERT INTO public.nino_behavioral_events (
    user_id, event_type, economic_event_id, economic_event_table,
    occurred_at, materiality, payload, dedup_key
  ) VALUES (
    _user_id, _event_type, _economic_event_id, _economic_event_table,
    coalesce(_occurred_at, now()), coalesce(abs(_materiality), 0),
    coalesce(_payload, '{}'::jsonb),
    _event_type || ':' || coalesce(_economic_event_id::text, to_char(coalesce(_occurred_at, now()), 'YYYY-MM-DD'))
  )
  ON CONFLICT (user_id, dedup_key) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.nino_mark_behavioral_event(uuid, text, timestamptz, uuid, text, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nino_mark_behavioral_event(uuid, text, timestamptz, uuid, text, numeric, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.nino_tx_behavioral_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_kind text := coalesce(NEW.movement_kind, 'transaction');
  v_event text;
BEGIN
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF NEW.settles_card_id IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.type = 'income' THEN
    v_event := 'MONEY_IN';
  ELSIF NEW.type = 'expense' AND v_kind = 'transaction' AND NEW.transfer_group_id IS NULL THEN
    v_event := 'LARGE_SPEND';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.nino_mark_behavioral_event(
    NEW.user_id, v_event,
    (NEW.occurred_at::timestamp AT TIME ZONE 'America/Sao_Paulo'),
    NEW.id, 'transactions', NEW.amount,
    jsonb_build_object(
      'type', NEW.type,
      'movement_kind', v_kind,
      'transfer_group_id', NEW.transfer_group_id,
      'category_id', NEW.category_id,
      'credit_card_id', NEW.credit_card_id,
      'account_id', NEW.account_id,
      'origin', NEW.origin,
      'occurred_at', NEW.occurred_at,
      'posted_at', NEW.posted_at
    )
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nino_tx_behavioral_event ON public.transactions;
CREATE TRIGGER trg_nino_tx_behavioral_event
  AFTER INSERT OR UPDATE OF status, amount, type, movement_kind ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.nino_tx_behavioral_event();

CREATE OR REPLACE FUNCTION public.nino_statement_behavioral_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(NEW.status, '') NOT IN ('closed', 'fechada') THEN RETURN NEW; END IF;
  PERFORM public.nino_mark_behavioral_event(
    NEW.user_id, 'CREDIT_CARD_CLOSE', now(), NEW.id, 'credit_card_statements',
    coalesce(NEW.total_amount, 0),
    jsonb_build_object('credit_card_id', NEW.credit_card_id, 'due_date', NEW.due_date,
                       'closing_date', NEW.closing_date, 'status', NEW.status)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nino_statement_behavioral_event ON public.credit_card_statements;
CREATE TRIGGER trg_nino_statement_behavioral_event
  AFTER INSERT OR UPDATE OF status ON public.credit_card_statements
  FOR EACH ROW EXECUTE FUNCTION public.nino_statement_behavioral_event();

CREATE OR REPLACE FUNCTION public.nino_goal_contribution_behavioral_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.nino_mark_behavioral_event(
    NEW.user_id, 'GOAL_CONTRIBUTION', coalesce(NEW.created_at, now()), NEW.id,
    'goal_contributions', coalesce(NEW.amount, 0),
    jsonb_build_object('goal_id', NEW.goal_id)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nino_goal_contribution_behavioral_event ON public.goal_contributions;
CREATE TRIGGER trg_nino_goal_contribution_behavioral_event
  AFTER INSERT ON public.goal_contributions
  FOR EACH ROW EXECUTE FUNCTION public.nino_goal_contribution_behavioral_event();

CREATE OR REPLACE FUNCTION public.nino_debt_payment_behavioral_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.nino_mark_behavioral_event(
    NEW.user_id, 'DEBT_PAYMENT', coalesce(NEW.created_at, now()), NEW.id,
    'debt_payments', coalesce(NEW.amount, 0),
    jsonb_build_object('debt_id', NEW.debt_id)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nino_debt_payment_behavioral_event ON public.debt_payments;
CREATE TRIGGER trg_nino_debt_payment_behavioral_event
  AFTER INSERT ON public.debt_payments
  FOR EACH ROW EXECUTE FUNCTION public.nino_debt_payment_behavioral_event();

CREATE OR REPLACE FUNCTION public.nino_investment_movement_behavioral_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.nino_mark_behavioral_event(
    NEW.user_id, 'INVESTMENT_MOVEMENT', coalesce(NEW.created_at, now()), NEW.id,
    'investment_movements', coalesce(NEW.amount, 0),
    jsonb_build_object('investment_id', NEW.investment_id, 'kind', NEW.kind)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nino_investment_movement_behavioral_event ON public.investment_movements;
CREATE TRIGGER trg_nino_investment_movement_behavioral_event
  AFTER INSERT ON public.investment_movements
  FOR EACH ROW EXECUTE FUNCTION public.nino_investment_movement_behavioral_event();

-- ------------------------------------------------------------------
-- Admin: "o Nino está intervindo no momento certo?"
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_v3_behavioral_timing(
  _user_id uuid DEFAULT NULL, _days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_days int := greatest(1, least(180, coalesce(_days, 30)));
  v_since timestamptz := now() - make_interval(days => v_days);
BEGIN
  PERFORM public._require_perm('cockpit.read');

  RETURN jsonb_build_object(
    'contract_version', 'nino_behavioral_timing.v1',
    'period_days', v_days,
    'scope', CASE WHEN _user_id IS NULL THEN 'global' ELSE 'user' END,
    'totals', jsonb_build_object(
      'events', (SELECT count(*) FROM public.nino_behavioral_events
                 WHERE (_user_id IS NULL OR user_id = _user_id) AND occurred_at >= v_since),
      'pending', (SELECT count(*) FROM public.nino_behavioral_events
                  WHERE (_user_id IS NULL OR user_id = _user_id) AND processed_at IS NULL),
      'delivered', (SELECT count(*) FROM public.proactive_decisions
                    WHERE (_user_id IS NULL OR user_id = _user_id) AND created_at >= v_since AND decision = 'deliver'),
      'deferred', (SELECT count(*) FROM public.proactive_decisions
                   WHERE (_user_id IS NULL OR user_id = _user_id) AND created_at >= v_since AND decision = 'defer'),
      'suppressed', (SELECT count(*) FROM public.proactive_decisions
                     WHERE (_user_id IS NULL OR user_id = _user_id) AND created_at >= v_since AND decision = 'suppress')
    ),
    'events_by_trigger', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT event_type AS trigger, count(*) AS total,
               count(*) FILTER (WHERE processed_at IS NOT NULL) AS processed,
               round(avg(materiality)::numeric, 2) AS avg_materiality,
               max(occurred_at) AS last_at
        FROM public.nino_behavioral_events
        WHERE (_user_id IS NULL OR user_id = _user_id) AND occurred_at >= v_since
        GROUP BY event_type ORDER BY count(*) DESC
      ) t), '[]'::jsonb),
    'decisions_by_trigger', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT coalesce(timing_trigger, 'unknown') AS trigger, decision, count(*) AS total,
               round(avg(timing_score)::numeric, 1) AS avg_timing_score,
               round(avg(priority_score)::numeric, 1) AS avg_priority_score
        FROM public.proactive_decisions
        WHERE (_user_id IS NULL OR user_id = _user_id) AND created_at >= v_since
        GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 60
      ) t), '[]'::jsonb),
    'defer_reasons', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT reason, count(*) AS total, min(defer_until) AS next_window
        FROM public.proactive_decisions
        WHERE (_user_id IS NULL OR user_id = _user_id) AND created_at >= v_since AND decision = 'defer'
        GROUP BY reason ORDER BY count(*) DESC LIMIT 20
      ) t), '[]'::jsonb),
    'outcome_by_trigger', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT coalesce(metadata->>'trigger', 'unknown') AS trigger,
               coalesce(metadata->>'window', 'unknown') AS window,
               count(*) AS total,
               count(*) FILTER (WHERE signal = 'acted') AS acted,
               count(*) FILTER (WHERE signal = 'dismissed') AS dismissed,
               round(avg(nullif((metadata->>'hours_to_action')::numeric, 0))::numeric, 2) AS avg_hours_to_action
        FROM public.nino_learning_events
        WHERE (_user_id IS NULL OR user_id = _user_id) AND occurred_at >= v_since
          AND event_type = 'timing_outcome'
        GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 60
      ) t), '[]'::jsonb),
    'principle_by_trigger', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT coalesce(metadata->>'trigger', 'unknown') AS trigger,
               coalesce(metadata->>'principle', 'unknown') AS principle,
               coalesce(metadata->>'strategy', 'unknown') AS strategy,
               count(*) AS total,
               count(*) FILTER (WHERE signal = 'acted') AS acted
        FROM public.nino_learning_events
        WHERE (_user_id IS NULL OR user_id = _user_id) AND occurred_at >= v_since
          AND event_type = 'timing_outcome'
        GROUP BY 1, 2, 3 ORDER BY count(*) DESC LIMIT 60
      ) t), '[]'::jsonb),
    'recent_events', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT event_type AS trigger, occurred_at, detected_at, materiality,
               processed_at, processing_result
        FROM public.nino_behavioral_events
        WHERE (_user_id IS NULL OR user_id = _user_id)
        ORDER BY detected_at DESC LIMIT 30
      ) t), '[]'::jsonb),
    'windows', coalesce((
      SELECT jsonb_agg(row_to_json(t)) FROM (
        SELECT event_type, label, open_after_hours, valid_for_hours,
               min_evidence_count, relative_floor_pct, enabled
        FROM public.nino_behavioral_timing_windows ORDER BY event_type
      ) t), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_v3_behavioral_timing(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_v3_behavioral_timing(uuid, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';