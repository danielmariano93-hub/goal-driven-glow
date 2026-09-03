-- =====================================================================
-- debt_obligation.v1 — fonte canônica única do estado da obrigação
-- Espelha exatamente src/lib/engine/debtStatus.ts (debt_status.v3).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.civil_add_months(_anchor date, _months int)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT make_date(
    extract(year from (date_trunc('month', _anchor) + make_interval(months => _months)))::int,
    extract(month from (date_trunc('month', _anchor) + make_interval(months => _months)))::int,
    least(
      extract(day from _anchor)::int,
      extract(day from (date_trunc('month', _anchor) + make_interval(months => _months) + interval '1 month - 1 day'))::int
    )
  );
$$;

COMMENT ON FUNCTION public.civil_add_months(date, int) IS
  'Data civil: soma meses preservando o dia com clamp de fim de mês. Nunca usa timestamp/timezone.';

DROP FUNCTION IF EXISTS public.debt_obligation_state(uuid, date, int);

CREATE OR REPLACE FUNCTION public.debt_obligation_state(
  _user_id uuid,
  _as_of date DEFAULT CURRENT_DATE,
  _due_soon_days int DEFAULT 7
)
RETURNS TABLE (
  debt_id uuid,
  name text,
  creditor text,
  situation text,
  installment_amount numeric,
  outstanding numeric,
  installments_total int,
  installments_paid int,
  installments_expected int,
  overdue_installments int,
  overdue_amount numeric,
  days_overdue int,
  current_cycle_due_date date,
  current_cycle_status text,
  current_cycle_paid_amount numeric,
  current_cycle_paid_at date,
  source_payment_id uuid,
  next_due_date date,
  days_to_due int,
  derived_schedule boolean,
  formula_version text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  r record;
  v_installment numeric;
  v_total int;
  v_derived boolean;
  v_base int;
  v_from_payments int;
  v_cycle_due date;
  v_prev_cycle_due date;
  v_cycle_paid numeric;
  v_cycle_paid_at date;
  v_cycle_payment_id uuid;
  v_cycle_covered boolean;
  v_anchor date;
  v_anchor_covered int;
  v_covered int;
  v_expected int;
  v_overdue int;
  v_next date;
  v_upcoming date;
  v_days_to_due int;
  v_oldest_unpaid date;
  v_situation text;
  v_cycle_status text;
  i int;
  v_due date;
begin
  for r in
    select d.id, d.name, d.creditor, d.status, d.due_day, d.installment_amount,
           d.installments_total, d.installments_paid, d.first_due_date, d.start_date,
           d.outstanding_balance
      from public.debts d
     where d.user_id = _user_id
       and d.status = 'active'
       and coalesce(d.outstanding_balance, 0) > 0
  loop
    v_installment := round(coalesce(r.installment_amount, 0)::numeric, 2);
    v_total := r.installments_total;
    v_derived := (r.first_due_date is null and r.start_date is null and coalesce(r.due_day, 0) between 1 and 31);

    -- Parcelas cobertas: o maior entre o declarado e o inferido dos pagamentos.
    select coalesce(sum(
             case
               when coalesce(p.installments_covered, 0) > 0 then p.installments_covered
               when v_installment > 0
                 and coalesce(p.amount_applied, p.amount, 0) >= v_installment * 0.95
                 then greatest(1, floor(coalesce(p.amount_applied, p.amount, 0) / v_installment)::int)
               else 0
             end), 0)::int
      into v_from_payments
      from public.debt_payments p
     where p.debt_id = r.id;

    v_base := greatest(coalesce(r.installments_paid, 0), coalesce(v_from_payments, 0));
    if v_total is not null then v_base := least(v_base, v_total); end if;

    -- Ciclo corrente (só existe em agenda derivada de due_day).
    v_cycle_due := null;
    v_prev_cycle_due := null;
    v_cycle_covered := false;
    v_cycle_paid := 0;
    v_cycle_paid_at := null;
    v_cycle_payment_id := null;

    if v_derived then
      v_cycle_due := make_date(
        extract(year from _as_of)::int,
        extract(month from _as_of)::int,
        least(r.due_day, extract(day from (date_trunc('month', _as_of) + interval '1 month - 1 day'))::int));
      v_prev_cycle_due := public.civil_add_months(v_cycle_due, -1);

      select coalesce(sum(coalesce(p.amount_applied, p.amount, 0)), 0),
             max(p.paid_at),
             (array_agg(p.id order by p.paid_at desc, p.created_at desc))[1]
        into v_cycle_paid, v_cycle_paid_at, v_cycle_payment_id
        from public.debt_payments p
       where p.debt_id = r.id
         and p.paid_at > v_prev_cycle_due
         and p.paid_at <= _as_of
         and (
           coalesce(p.installments_covered, 0) > 0
           or (v_installment > 0 and coalesce(p.amount_applied, p.amount, 0) >= v_installment * 0.95)
         );

      v_cycle_covered := v_cycle_paid_at is not null;
    end if;

    -- Âncora da agenda (vencimento da 1ª parcela).
    v_anchor_covered := case when v_derived and v_cycle_covered then greatest(0, v_base - 1) else v_base end;
    if r.first_due_date is not null then
      v_anchor := r.first_due_date;
    elsif r.start_date is not null and coalesce(r.due_day, 0) between 1 and 31 then
      v_anchor := make_date(
        extract(year from r.start_date)::int,
        extract(month from r.start_date)::int,
        least(r.due_day, extract(day from (date_trunc('month', r.start_date) + interval '1 month - 1 day'))::int));
      if v_anchor < r.start_date then
        v_anchor := public.civil_add_months(v_anchor, 1);
      end if;
    elsif v_derived then
      v_anchor := public.civil_add_months(v_cycle_due, -v_anchor_covered);
    else
      v_anchor := r.start_date;
    end if;

    v_covered := v_base;

    if v_anchor is null or v_installment <= 0 then
      situation := 'indefinido';
      debt_id := r.id; name := r.name; creditor := r.creditor;
      installment_amount := nullif(v_installment, 0);
      outstanding := round(coalesce(r.outstanding_balance, 0)::numeric, 2);
      installments_total := v_total; installments_paid := v_covered;
      installments_expected := null; overdue_installments := 0; overdue_amount := 0;
      days_overdue := null; current_cycle_due_date := v_cycle_due;
      current_cycle_status := 'unknown'; current_cycle_paid_amount := round(coalesce(v_cycle_paid,0)::numeric,2);
      current_cycle_paid_at := v_cycle_paid_at; source_payment_id := v_cycle_payment_id;
      next_due_date := null; days_to_due := null; derived_schedule := v_derived;
      formula_version := 'debt_obligation.v1';
      return next;
      continue;
    end if;

    -- Parcelas cujo vencimento já passou.
    v_expected := 0;
    i := 1;
    loop
      exit when i > 600;
      v_due := public.civil_add_months(v_anchor, i - 1);
      exit when v_due > _as_of;
      v_expected := i;
      exit when v_total is not null and i >= v_total;
      i := i + 1;
    end loop;
    if v_total is not null then v_expected := least(v_expected, v_total); end if;

    v_overdue := greatest(0, v_expected - v_covered);
    v_next := case when v_total is not null and v_covered >= v_total
                   then null
                   else public.civil_add_months(v_anchor, least(coalesce(v_total, v_covered + 1), v_covered + 1) - 1) end;
    v_oldest_unpaid := case when v_overdue > 0 then public.civil_add_months(v_anchor, v_covered) else null end;

    v_upcoming := null;
    if v_total is null or v_covered < v_total then
      i := greatest(1, v_covered + 1);
      loop
        exit when i > coalesce(v_total, v_covered + 24);
        v_due := public.civil_add_months(v_anchor, i - 1);
        if v_due >= _as_of then v_upcoming := v_due; exit; end if;
        i := i + 1;
      end loop;
    end if;
    v_days_to_due := case when v_upcoming is null then null else (v_upcoming - _as_of) end;

    if v_overdue > 0 and v_oldest_unpaid is not null then
      v_situation := 'em_atraso';
    elsif v_days_to_due is not null and v_days_to_due <= _due_soon_days then
      v_situation := 'vence_em_breve';
    else
      v_situation := 'em_dia';
    end if;

    v_cycle_status := case
      when not v_derived then 'unknown'
      when v_cycle_covered and v_cycle_paid >= v_installment * 0.95 then 'paid'
      when v_cycle_covered then 'partial'
      when v_cycle_due < _as_of then 'overdue'
      else 'pending'
    end;

    debt_id := r.id; name := r.name; creditor := r.creditor;
    situation := v_situation;
    installment_amount := v_installment;
    outstanding := round(coalesce(r.outstanding_balance, 0)::numeric, 2);
    installments_total := v_total;
    installments_paid := v_covered;
    installments_expected := v_expected;
    overdue_installments := v_overdue;
    overdue_amount := round(least(coalesce(r.outstanding_balance, 0), v_overdue * v_installment)::numeric, 2);
    days_overdue := case when v_oldest_unpaid is null then null else (_as_of - v_oldest_unpaid) end;
    current_cycle_due_date := v_cycle_due;
    current_cycle_status := v_cycle_status;
    current_cycle_paid_amount := round(coalesce(v_cycle_paid, 0)::numeric, 2);
    current_cycle_paid_at := v_cycle_paid_at;
    source_payment_id := v_cycle_payment_id;
    next_due_date := case when v_situation = 'em_atraso' then v_oldest_unpaid else coalesce(v_upcoming, v_next) end;
    days_to_due := case when v_situation = 'em_atraso' then null else v_days_to_due end;
    derived_schedule := v_derived;
    formula_version := 'debt_obligation.v1';
    return next;
  end loop;
  return;
end;
$function$;

COMMENT ON FUNCTION public.debt_obligation_state(uuid, date, int) IS
  'debt_obligation.v1 — fonte canônica do estado da parcela (paga/pendente/parcial/atrasada). Espelho exato de src/lib/engine/debtStatus.ts. Consumidores: nino_diag_detect_debt_alerts, snapshot, agenda, proatividade.';

GRANT EXECUTE ON FUNCTION public.civil_add_months(date, int) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.debt_obligation_state(uuid, date, int) TO authenticated, service_role;

-- =====================================================================
-- Detector do Nino: deixa de reimplementar a regra e passa a LER a fonte
-- =====================================================================

CREATE OR REPLACE FUNCTION public.nino_diag_detect_debt_alerts(
  _user_id uuid,
  _as_of date DEFAULT CURRENT_DATE,
  _run_mode text DEFAULT 'live'::text,
  _run_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  r record;
  v_detected int := 0;
  v_days int;
begin
  if _run_mode = 'backtest' then
    return 0;
  end if;

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
  update public.financial_situations s
     set status = 'expired', updated_at = now()
   where s.user_id = _user_id
     and s.status = 'active'
     and (s.dedupe_key like 'debt_due_soon:%' or s.dedupe_key like 'debt_overdue:%')
     and not exists (
       select 1 from public.debt_obligation_state(_user_id, _as_of, 7) st
        where s.dedupe_key in ('debt_due_soon:' || st.debt_id::text, 'debt_overdue:' || st.debt_id::text)
          and st.situation in ('em_atraso', 'vence_em_breve')
          and coalesce(st.current_cycle_status, 'unknown') <> 'paid'
     );

  return v_detected;
end;
$function$;

-- =====================================================================
-- Short links: pgcrypto vive no schema extensions
-- =====================================================================

CREATE OR REPLACE FUNCTION public.create_short_link(
  _target_path text,
  _kind text DEFAULT 'generic',
  _ttl_days int DEFAULT 30,
  _user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid := COALESCE(_user_id, auth.uid());
  _token text;
  _path text := btrim(COALESCE(_target_path, ''));
BEGIN
  IF _path = '' OR left(_path, 1) <> '/' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target_path');
  END IF;
  IF auth.uid() IS NOT NULL AND _owner <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_owner');
  END IF;

  LOOP
    _token := lower(substr(replace(replace(
      encode(extensions.gen_random_bytes(8), 'base64'), '/', ''), '+', ''), 1, 8));
    EXIT WHEN length(_token) >= 6
      AND NOT EXISTS (SELECT 1 FROM public.short_links WHERE token = _token);
  END LOOP;

  INSERT INTO public.short_links (token, target_path, kind, user_id, expires_at)
  VALUES (_token, _path, COALESCE(NULLIF(btrim(_kind), ''), 'generic'), _owner,
          CASE WHEN _ttl_days IS NULL THEN NULL ELSE now() + make_interval(days => GREATEST(_ttl_days, 1)) END);

  RETURN jsonb_build_object('ok', true, 'token', _token, 'path', '/s/' || _token);
END;
$function$;

-- =====================================================================
-- Auditoria proativa: coluna que faltava (o insert inteiro era rejeitado)
-- =====================================================================

ALTER TABLE public.proactive_decisions
  ADD COLUMN IF NOT EXISTS timing_window text;

COMMENT ON COLUMN public.proactive_decisions.timing_window IS
  'Janela comportamental usada na decisão (mesmo contrato de proactive_situations.timing_window).';