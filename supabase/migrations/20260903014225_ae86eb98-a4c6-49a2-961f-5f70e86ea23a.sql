-- =====================================================================
-- Uma verdade canônica de dívida paga (debt_obligation.v1) em todos os
-- consumidores de situação/proatividade do Nino.
-- =====================================================================

-- 1) Reconciliação idempotente: ciclo pago encerra alerta, sinal e sugestão.
CREATE OR REPLACE FUNCTION public.nino_reconcile_debt_situations(
  _user_id uuid,
  _as_of date DEFAULT CURRENT_DATE
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner uuid;
  v_keys text[] := '{}';
  v_sit_ids uuid[] := '{}';
  v_debt_ids uuid[] := '{}';
  v_closed int := 0;
BEGIN
  v_owner := coalesce(_user_id, auth.uid());
  IF v_owner IS NULL THEN RETURN 0; END IF;
  IF auth.uid() IS NOT NULL AND v_owner <> auth.uid() THEN RETURN 0; END IF;

  -- Ciclos correntes já pagos, direto do motor canônico.
  SELECT coalesce(array_agg(st.debt_id), '{}')
    INTO v_debt_ids
    FROM public.debt_obligation_state(v_owner, _as_of, 7) st
   WHERE coalesce(st.current_cycle_status, 'unknown') = 'paid';

  IF array_length(v_debt_ids, 1) IS NULL THEN RETURN 0; END IF;

  SELECT coalesce(array_agg(k), '{}') INTO v_keys
    FROM (
      SELECT 'debt_due_soon:' || d::text AS k FROM unnest(v_debt_ids) d
      UNION ALL SELECT 'debt_overdue:' || d::text FROM unnest(v_debt_ids) d
      UNION ALL SELECT 'future:debt:' || d::text FROM unnest(v_debt_ids) d
    ) x;

  -- Situações do Nino: expira, preservando o histórico da linha.
  WITH closed AS (
    UPDATE public.financial_situations s
       SET status = 'expired', resolved_at = now(), updated_at = now()
     WHERE s.user_id = v_owner
       AND s.status NOT IN ('expired', 'resolved', 'suppressed')
       AND s.situation_key = ANY(v_keys)
    RETURNING s.id, s.situation_key
  )
  SELECT coalesce(array_agg(id), '{}'), count(*)::int
    INTO v_sit_ids, v_closed
    FROM closed;

  -- Itens de inteligência derivados da mesma situação.
  UPDATE public.nino_intelligence_items i
     SET status = 'expired', updated_at = now()
   WHERE i.user_id = v_owner
     AND i.status IN ('candidate', 'active')
     AND (
       EXISTS (SELECT 1 FROM unnest(v_sit_ids) s WHERE i.dedup_key = 'diagnosis:situation:' || s::text)
       OR EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE i.logical_topic_key = 'situation:' || k)
     );

  -- Sugestões proativas ainda não entregues.
  UPDATE public.pending_proactive_suggestions p
     SET status = 'dismissed', dismissed_at = now(),
         defer_reason = 'debt_cycle_paid'
   WHERE p.user_id = v_owner
     AND p.status = 'pending'
     AND (
       EXISTS (SELECT 1 FROM unnest(v_sit_ids) s WHERE p.dedup_key = 'diagnosis:situation:' || s::text)
       OR EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE p.dedup_key = 'diagnosis:' || k OR p.logical_dedup_key = k)
       OR EXISTS (SELECT 1 FROM unnest(v_debt_ids) d
                   WHERE p.dedup_key LIKE '%debt_due:' || d::text
                      OR p.dedup_key LIKE '%debt_due_soon:' || d::text
                      OR p.dedup_key LIKE '%debt_overdue:' || d::text)
     );

  -- Sinais do dia que representam o ciclo pago.
  DELETE FROM public.proactive_signals ps
   WHERE ps.user_id = v_owner
     AND ps.as_of >= _as_of - 1
     AND (
       EXISTS (SELECT 1 FROM unnest(v_debt_ids) d WHERE ps.signal_key = 'debt_due:' || d::text)
       OR EXISTS (SELECT 1 FROM unnest(v_sit_ids) s WHERE ps.signal_key = 'diagnosis:' || s::text)
     );

  -- Situações proativas multi-domínio construídas sobre esses sinais (apenas o
  -- ciclo corrente; o histórico de dias anteriores é preservado).
  DELETE FROM public.proactive_situations pst
   WHERE pst.user_id = v_owner
     AND pst.as_of >= _as_of - 1
     AND pst.last_delivered_at IS NULL
     AND EXISTS (
       SELECT 1 FROM unnest(v_debt_ids) d
        WHERE pst.fingerprint LIKE '%' || d::text || '%'
     );

  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.nino_reconcile_debt_situations(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nino_reconcile_debt_situations(uuid, date) TO authenticated, service_role;

-- 2) Detector de dívida: limpeza corrigida (`situation_key`, não `dedupe_key`)
--    e reconciliação canônica antes de detectar.
CREATE OR REPLACE FUNCTION public.nino_diag_detect_debt_alerts(
  _user_id uuid,
  _as_of date DEFAULT CURRENT_DATE,
  _run_mode text DEFAULT 'live'::text,
  _run_id uuid DEFAULT NULL::uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  r record;
  v_detected int := 0;
  v_days int;
begin
  if _run_mode = 'backtest' then
    return 0;
  end if;

  -- Ciclo pago sai de cena ANTES de qualquer detecção.
  perform public.nino_reconcile_debt_situations(_user_id, _as_of);

  for r in
    select * from public.debt_obligation_state(_user_id, _as_of, 7)
     where installment_amount is not null
       and installment_amount > 0
       and situation in ('em_atraso', 'vence_em_breve')
       -- Parcela do ciclo corrente já paga NUNCA vira alerta.
       and coalesce(current_cycle_status, 'unknown') not in ('paid')
  loop
    if r.situation = 'em_atraso' then
      v_days := greatest(1, coalesce(r.days_overdue, 1));
      perform public.nino_diag_put_situation(
        _user_id, _run_mode, _run_id, _as_of,
        'recurring_commitment_pressure', 'debt_overdue:' || r.debt_id::text,
        'active', 'now',
        case when r.overdue_installments >= 2 or v_days >= 15 then 'critical' else 'attention' end,
        0.9,
        r.next_due_date, _as_of,
        r.overdue_amount, r.installment_amount, r.overdue_amount, null, r.overdue_amount,
        'Dívida "' || r.name || '" com ' || r.overdue_installments || ' parcela' ||
          case when r.overdue_installments > 1 then 's' else '' end || ' sem pagamento registrado',
        'A parcela de ' || public.nino_diag_brl(r.installment_amount) ||
          ' venceu em ' || to_char(r.next_due_date, 'DD/MM') || ' e nenhum pagamento foi registrado (' || v_days || ' dias).',
        'Total em aberto nessa dívida: ' || public.nino_diag_brl(r.overdue_amount) ||
          '. Se você já pagou, registre para o Nino parar de contar como atraso.',
        null, (_as_of + 7)::timestamptz,
        jsonb_build_object('debt_id', r.debt_id, 'name', r.name, 'creditor', r.creditor,
                           'situation', 'em_atraso', 'overdue_installments', r.overdue_installments,
                           'installment_amount', r.installment_amount,
                           'installments_paid', r.installments_paid,
                           'installments_total', r.installments_total,
                           'current_cycle_status', r.current_cycle_status,
                           'current_cycle_due_date', r.current_cycle_due_date,
                           'next_due_date', r.next_due_date,
                           'days_overdue', v_days,
                           'formula_version', r.formula_version),
        jsonb_build_object('evidence_type', 'debt_schedule', 'metric_key', 'overdue_amount', 'value', r.overdue_amount),
        jsonb_build_object('key', 'debt_overdue:pay', 'type', 'review_debt',
                           'title', 'Ver a dívida', 'route', '/app/dividas', 'priority', 95)
      );
      v_detected := v_detected + 1;

    elsif r.situation = 'vence_em_breve' and r.next_due_date is not null then
      v_days := greatest(0, coalesce(r.days_to_due, 0));
      perform public.nino_diag_put_situation(
        _user_id, _run_mode, _run_id, _as_of,
        'recurring_commitment_pressure', 'debt_due_soon:' || r.debt_id::text,
        'active', 'future', 'attention', 0.85,
        _as_of, r.next_due_date,
        r.installment_amount, r.installment_amount, null, null, r.installment_amount,
        'Parcela de "' || r.name || '" vence ' ||
          case when v_days = 0 then 'hoje' when v_days = 1 then 'amanhã'
               else 'em ' || v_days || ' dias' end,
        'São ' || public.nino_diag_brl(r.installment_amount) ||
          ' com vencimento em ' || to_char(r.next_due_date, 'DD/MM') || '.',
        'Essa saída já entra no seu planejamento dos próximos dias.',
        null, (r.next_due_date + 2)::timestamptz,
        jsonb_build_object('debt_id', r.debt_id, 'name', r.name, 'creditor', r.creditor,
                           'situation', 'vence_em_breve', 'days_until_due', v_days,
                           'installment_amount', r.installment_amount,
                           'installments_paid', r.installments_paid,
                           'installments_total', r.installments_total,
                           'current_cycle_status', r.current_cycle_status,
                           'current_cycle_due_date', r.current_cycle_due_date,
                           'next_due_date', r.next_due_date,
                           'formula_version', r.formula_version),
        jsonb_build_object('evidence_type', 'debt_schedule', 'metric_key', 'installment_amount', 'value', r.installment_amount),
        jsonb_build_object('key', 'debt_due_soon:pay', 'type', 'review_debt',
                           'title', 'Ver a dívida', 'route', '/app/dividas', 'priority', 88)
      );
      v_detected := v_detected + 1;
    end if;
  end loop;

  -- Situações de dívida que já não são verdade saem da tela do Nino.
  -- A coluna correta é `situation_key`; com `dedupe_key` a instrução falhava
  -- e nenhum alerta antigo era expirado depois do pagamento.
  update public.financial_situations s
     set status = 'expired', resolved_at = now(), updated_at = now()
   where s.user_id = _user_id
     and s.status = 'active'
     and (s.situation_key like 'debt_due_soon:%' or s.situation_key like 'debt_overdue:%')
     and not exists (
       select 1 from public.debt_obligation_state(_user_id, _as_of, 7) st
        where s.situation_key in ('debt_due_soon:' || st.debt_id::text, 'debt_overdue:' || st.debt_id::text)
          and st.situation in ('em_atraso', 'vence_em_breve')
          and coalesce(st.current_cycle_status, 'unknown') <> 'paid'
     );

  return v_detected;
end;
$$;

-- 3) Detector futuro: dívida derivada do estado canônico, com data civil real
--    e sem recriar aviso de ciclo pago.
CREATE OR REPLACE FUNCTION public.nino_evaluate_future_situations(
  _user_id uuid,
  _as_of date,
  _run_mode text,
  _run_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare r record; v_count int:=0; v_eval jsonb; v_action jsonb; v_summary text; begin
 perform public.nino_reconcile_debt_situations(_user_id, _as_of);
 for r in
  select 'bill' kind,s.id source_id,s.credit_card_id context_id,s.due_date event_date,greatest(s.outstanding_amount,0) amount,'Fatura vence em breve' headline, coalesce(c.name,'seu cartão') label from public.credit_card_statements s left join public.credit_cards c on c.id=s.credit_card_id where s.user_id=_user_id and s.due_date between _as_of+1 and _as_of+15 and s.outstanding_amount>0
  union all select 'installment',(array_agg(i.id order by i.due_date))[1],i.credit_card_id,min(i.due_date),sum(i.amount),'Parcelas já comprometem os próximos dias', coalesce(max(c.name),'seu cartão') from public.credit_card_installments i left join public.credit_cards c on c.id=i.credit_card_id where i.user_id=_user_id and i.due_date between _as_of+1 and _as_of+30 and i.status not in ('paid','cancelled') group by i.credit_card_id
  union all select 'recurring',(array_agg(o.id order by o.due_date))[1],null,min(o.due_date),sum(rr.amount),'Compromissos recorrentes estão próximos', 'compromissos recorrentes' from public.recurring_occurrences o join public.recurring_rules rr on rr.id=o.recurring_rule_id where o.user_id=_user_id and o.due_date between _as_of+1 and _as_of+15 and o.status='planned' group by o.user_id
  -- Dívida: fonte única `debt_obligation.v1`. Ciclo pago não vira aviso e a
  -- data é o vencimento civil real (nunca `least(due_day, 28)`).
  union all select 'debt', st.debt_id, null, dd.d, st.installment_amount, 'Parcela de dívida se aproxima', coalesce(st.creditor, st.name, 'sua dívida')
    from public.debt_obligation_state(_user_id, _as_of, 7) st
    cross join lateral (select coalesce(st.current_cycle_due_date, st.next_due_date) as d) dd
   where coalesce(st.installment_amount, 0) > 0
     and coalesce(st.current_cycle_status, 'unknown') not in ('paid', 'partial')
     and dd.d between _as_of+1 and _as_of+15
  union all select 'goal',g.id,null,least(g.target_date,_as_of+30),greatest(g.target_amount-coalesce((select sum(c.amount) from public.goal_contributions c where c.goal_id=g.id),0),0),'Sua meta pede um próximo aporte', coalesce(g.name,'sua meta') from public.goals g where g.user_id=_user_id and g.status='active' and g.target_date>=_as_of and g.target_amount>coalesce((select sum(c.amount) from public.goal_contributions c where c.goal_id=g.id),0)
 loop
  v_eval:=jsonb_build_object('future_kind',r.kind,'source_id',r.source_id,'card_id',r.context_id,'opportunity_date',r.event_date,'goal_id',case when r.kind='goal' then r.source_id else null end);
  v_action:=public.nino_diag_select_action(case when r.kind='goal' then 'goal_feasibility' else 'anticipation' end,'active',v_eval,r.amount);
  v_summary := case r.kind
    when 'bill' then 'A fatura de '||r.label||' fecha em R$ '||to_char(r.amount,'FM999G999G999D00')||' e vence em '||to_char(r.event_date,'DD/MM')||'.'
    when 'installment' then 'As parcelas de '||r.label||' somam R$ '||to_char(r.amount,'FM999G999G999D00')||' e a próxima cai em '||to_char(r.event_date,'DD/MM')||'.'
    when 'recurring' then 'Seus '||r.label||' somam R$ '||to_char(r.amount,'FM999G999G999D00')||' até '||to_char(r.event_date,'DD/MM')||'.'
    when 'debt' then 'A parcela de '||r.label||' é de R$ '||to_char(r.amount,'FM999G999G999D00')||' e vence em '||to_char(r.event_date,'DD/MM')||'.'
    else 'Para '||r.label||' faltam R$ '||to_char(r.amount,'FM999G999G999D00')||' até '||to_char(r.event_date,'DD/MM/YYYY')||'.'
  end;
  perform public.nino_diag_put_situation(_user_id,_run_mode,_run_id,_as_of,case when r.kind='goal' then 'goal_feasibility' else 'anticipation' end,'future:'||r.kind||':'||r.source_id::text,'active','future',case when r.amount>=1000 then 'attention' else 'info' end,.90,_as_of,r.event_date,r.amount,null,null,null,r.amount,r.headline,v_summary,'Esse valor pode reduzir o caixa disponível na data prevista.','Data prevista: '||to_char(r.event_date,'DD/MM/YYYY'),r.event_date::timestamptz+interval '1 day',v_eval,jsonb_build_object('evidence_type','future_commitment','value',r.amount,'event_date',r.event_date),v_action); v_count:=v_count+1;
 end loop;
 update public.financial_situations set status='expired',resolved_at=now(),updated_at=now() where user_id=_user_id and run_mode=_run_mode and temporal_scope='future' and valid_until<now() and status not in ('expired','resolved','suppressed');
 return v_count; end
$$;

-- 4) Registro de pagamento reconcilia na hora (sem esperar o job periódico).
CREATE OR REPLACE FUNCTION public.record_debt_payment(
  p_debt_id uuid,
  p_account_id uuid,
  p_paid_at date,
  p_amount numeric,
  p_interest_amount numeric DEFAULT 0,
  p_fee_amount numeric DEFAULT 0,
  p_installments_covered integer DEFAULT 0,
  p_notes text DEFAULT NULL::text,
  p_idempotency_key text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_debt public.debts;
  v_applied numeric;
  v_payment_id uuid;
  v_transaction_id uuid;
  v_installments_covered integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_debt FROM public.debts
   WHERE id = p_debt_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'debt_not_found'; END IF;
  IF p_amount <= 0 OR p_interest_amount < 0 OR p_fee_amount < 0
     OR p_interest_amount + p_fee_amount > p_amount THEN
    RAISE EXCEPTION 'invalid_payment_composition';
  END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = v_user AND active
  ) THEN RAISE EXCEPTION 'account_not_found'; END IF;

  v_applied := p_amount - p_interest_amount - p_fee_amount;
  IF v_applied > v_debt.outstanding_balance THEN
    RAISE EXCEPTION 'payment_exceeds_outstanding_balance';
  END IF;

  v_installments_covered := greatest(0, coalesce(p_installments_covered, 0));
  IF v_installments_covered = 0
     AND coalesce(v_debt.installment_amount, 0) > 0
     AND v_applied >= coalesce(v_debt.installment_amount, 0) * 0.95 THEN
    v_installments_covered := least(
      coalesce(v_debt.installments_total, 2147483647) - coalesce(v_debt.installments_paid, 0),
      greatest(1, floor(v_applied / greatest(v_debt.installment_amount, 0.01))::integer)
    );
    v_installments_covered := greatest(1, v_installments_covered);
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_payment_id FROM public.debt_payments
     WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'payment_id', v_payment_id);
    END IF;
  END IF;

  INSERT INTO public.transactions(
    user_id, account_id, type, status, amount, occurred_at, description,
    payment_method, movement_kind
  ) VALUES (
    v_user, p_account_id, 'expense', 'confirmed', v_applied,
    coalesce(p_paid_at, current_date), 'Pagamento de dívida: ' || v_debt.name,
    'account', 'debt_payment'
  ) RETURNING id INTO v_transaction_id;

  IF p_interest_amount > 0 THEN
    INSERT INTO public.transactions(
      user_id, account_id, type, status, amount, occurred_at, description,
      payment_method, movement_kind
    ) VALUES (
      v_user, p_account_id, 'expense', 'confirmed', p_interest_amount,
      coalesce(p_paid_at, current_date), 'Juros da dívida: ' || v_debt.name,
      'account', 'transaction'
    );
  END IF;
  IF p_fee_amount > 0 THEN
    INSERT INTO public.transactions(
      user_id, account_id, type, status, amount, occurred_at, description,
      payment_method, movement_kind
    ) VALUES (
      v_user, p_account_id, 'expense', 'confirmed', p_fee_amount,
      coalesce(p_paid_at, current_date), 'Tarifas da dívida: ' || v_debt.name,
      'account', 'transaction'
    );
  END IF;

  INSERT INTO public.debt_payments(
    user_id, debt_id, account_id, paid_at, amount, amount_applied,
    interest_amount, fee_amount, installments_covered, notes,
    transaction_id, idempotency_key
  ) VALUES (
    v_user, p_debt_id, p_account_id, coalesce(p_paid_at, current_date),
    p_amount, v_applied, p_interest_amount, p_fee_amount,
    v_installments_covered, nullif(p_notes, ''),
    v_transaction_id, p_idempotency_key
  ) RETURNING id INTO v_payment_id;

  UPDATE public.debts
     SET outstanding_balance = greatest(0, outstanding_balance - v_applied),
         installments_paid = least(
           coalesce(installments_total, 2147483647),
           coalesce(installments_paid, 0) + v_installments_covered
         ),
         status = CASE WHEN greatest(0, outstanding_balance - v_applied) = 0
                       THEN 'settled'::public.debt_status ELSE status END,
         updated_at = now()
   WHERE id = p_debt_id;

  -- Alerta de ciclo pago não sobrevive ao pagamento.
  PERFORM public.nino_reconcile_debt_situations(v_user, current_date);

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'payment_id', v_payment_id,
    'transaction_id', v_transaction_id, 'amount_applied', v_applied,
    'installments_covered', v_installments_covered
  );
END;
$$;

-- 5) Backfill idempotente para todos os usuários com dívida ativa.
DO $$
DECLARE u uuid;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM public.debts WHERE status = 'active' LOOP
    PERFORM public.nino_reconcile_debt_situations(u, CURRENT_DATE);
    INSERT INTO public.financial_snapshot_refresh_queue AS q (user_id, marked_at)
    VALUES (u, now())
    ON CONFLICT (user_id) DO UPDATE SET marked_at = now(), last_error = NULL;
  END LOOP;
END $$;