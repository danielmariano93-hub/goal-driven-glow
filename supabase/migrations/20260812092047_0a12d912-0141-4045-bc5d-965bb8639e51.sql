create or replace function public.nino_diag_detect_debt_alerts(
  _user_id uuid,
  _as_of date default current_date,
  _run_mode text default 'live',
  _run_id uuid default null
) returns integer
language plpgsql security definer set search_path=public as $$
declare
  r record;
  v_detected int := 0;
  v_anchor date;
  v_paid int;
  v_due_cycles int;
  v_overdue_cycles int;
  v_next_due date;
  v_days int;
  v_overdue_amount numeric;
begin
  if _run_mode = 'backtest' then
    return 0;
  end if;

  for r in
    select d.*,
           greatest(
             coalesce(d.installments_paid,0),
             coalesce((select sum(coalesce(p.installments_covered,1))
                         from public.debt_payments p where p.debt_id=d.id),0)
           )::int as paid_registered
      from public.debts d
     where d.user_id=_user_id
       and d.status='active'
       and coalesce(d.installment_amount,0) > 0
       and coalesce(d.outstanding_balance,0) > 0
  loop
    v_anchor := coalesce(
      r.first_due_date,
      case when r.due_day between 1 and 31
        then make_date(
               extract(year from coalesce(r.start_date, r.created_at::date))::int,
               extract(month from coalesce(r.start_date, r.created_at::date))::int,
               least(r.due_day, 28))
        else r.start_date end
    );
    if v_anchor is null then
      continue;
    end if;

    v_paid := r.paid_registered;
    v_due_cycles := greatest(0,
      (extract(year from _as_of)::int - extract(year from v_anchor)::int) * 12
      + (extract(month from _as_of)::int - extract(month from v_anchor)::int)
      + case when extract(day from _as_of) >= extract(day from v_anchor) then 1 else 0 end);
    if r.installments_total is not null then
      v_due_cycles := least(v_due_cycles, r.installments_total);
    end if;

    v_overdue_cycles := greatest(0, v_due_cycles - v_paid);
    v_next_due := (v_anchor + make_interval(months => v_paid))::date;

    if v_overdue_cycles > 0 then
      v_days := greatest(1, (_as_of - v_next_due));
      v_overdue_amount := round(least(
        v_overdue_cycles * r.installment_amount,
        coalesce(r.outstanding_balance, v_overdue_cycles * r.installment_amount)
      )::numeric, 2);

      perform public.nino_diag_put_situation(
        _user_id, _run_mode, _run_id, _as_of,
        'recurring_commitment_pressure', 'debt_overdue:' || r.id::text,
        'active', 'now',
        case when v_overdue_cycles >= 2 or v_days >= 15 then 'critical' else 'attention' end,
        0.9,
        v_next_due, _as_of,
        v_overdue_amount, r.installment_amount, v_overdue_amount, null, v_overdue_amount,
        'Dívida "' || r.name || '" com ' || v_overdue_cycles || ' parcela' ||
          case when v_overdue_cycles > 1 then 's' else '' end || ' sem pagamento registrado',
        'A parcela de ' || public.nino_diag_brl(r.installment_amount) ||
          ' venceu em ' || to_char(v_next_due,'DD/MM') || ' e nenhum pagamento foi registrado (' || v_days || ' dias).',
        'Total em aberto nessa dívida: ' || public.nino_diag_brl(v_overdue_amount) ||
          '. Se você já pagou, registre para o Nino parar de contar como atraso.',
        null, (_as_of + 7)::timestamptz,
        jsonb_build_object('debt_id',r.id,'name',r.name,'creditor',r.creditor,
                           'situation','em_atraso','overdue_installments',v_overdue_cycles,
                           'overdue_amount',v_overdue_amount,'days_overdue',v_days,
                           'installment_amount',r.installment_amount,
                           'installments_paid',v_paid,'installments_total',r.installments_total,
                           'next_due_date',v_next_due,'formula_version','debt_status.v1'),
        jsonb_build_object('evidence_type','debt_schedule','metric_key','overdue_amount','value',v_overdue_amount),
        jsonb_build_object('key','debt_overdue:register_payment','type','review_debt',
                           'title','Registrar pagamento','route','/app/dividas','priority',95)
      );
      v_detected := v_detected + 1;

    elsif v_next_due is not null
      and v_next_due >= _as_of
      and v_next_due <= _as_of + 7
      and (r.installments_total is null or v_paid < r.installments_total)
    then
      v_days := (v_next_due - _as_of);
      perform public.nino_diag_put_situation(
        _user_id, _run_mode, _run_id, _as_of,
        'recurring_commitment_pressure', 'debt_due_soon:' || r.id::text,
        'active', 'future', 'attention', 0.85,
        _as_of, v_next_due,
        r.installment_amount, r.installment_amount, null, null, r.installment_amount,
        'Parcela de "' || r.name || '" vence ' ||
          case when v_days = 0 then 'hoje' when v_days = 1 then 'amanhã'
               else 'em ' || v_days || ' dias' end,
        'São ' || public.nino_diag_brl(r.installment_amount) || ' com vencimento em ' ||
          to_char(v_next_due,'DD/MM') || '.',
        'Deixar vencer aumenta o custo da dívida e trava seu caixa no mês seguinte.',
        null, (v_next_due + 3)::timestamptz,
        jsonb_build_object('debt_id',r.id,'name',r.name,'creditor',r.creditor,
                           'situation','vence_em_breve','days_until_due',v_days,
                           'installment_amount',r.installment_amount,
                           'installments_paid',v_paid,'installments_total',r.installments_total,
                           'next_due_date',v_next_due,'formula_version','debt_status.v1'),
        jsonb_build_object('evidence_type','debt_schedule','metric_key','installment_amount','value',r.installment_amount),
        jsonb_build_object('key','debt_due_soon:pay','type','review_debt',
                           'title','Ver a dívida','route','/app/dividas','priority',88)
      );
      v_detected := v_detected + 1;
    end if;
  end loop;

  return v_detected;
end $$;

revoke all on function public.nino_diag_detect_debt_alerts(uuid,date,text,uuid) from public, anon, authenticated;

create or replace function public.nino_refresh_diagnosis(
  _user_id uuid,
  _as_of date default current_date,
  _run_mode text default 'live',
  _source text default 'engine'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_eval jsonb; v_snapshot uuid; v_projected int:=0; v_communications int:=0;
  v_future int:=0; v_debts int:=0;
begin
  v_eval := public.nino_evaluate_financial_situations(_user_id,_as_of,_run_mode,_source);
  v_future := public.nino_evaluate_future_situations(_user_id,_as_of,_run_mode,(v_eval->>'run_id')::uuid);
  v_debts := public.nino_diag_detect_debt_alerts(_user_id,_as_of,_run_mode,(v_eval->>'run_id')::uuid);
  v_snapshot := public.nino_assemble_diagnosis(_user_id,_as_of,_run_mode);
  if _run_mode='live' then
    v_projected := public.nino_project_diagnosis(_user_id,v_snapshot);
    v_communications := public.nino_project_diagnosis_communications(_user_id,v_snapshot);
  end if;
  update public.nino_diagnosis_runs
     set projected_items=v_projected, finished_at=coalesce(finished_at,now())
   where id=(v_eval->>'run_id')::uuid;
  return v_eval||jsonb_build_object('snapshot_id',v_snapshot,'projected_items',v_projected,
    'future_situations',v_future,'debt_alerts',v_debts,'communications',v_communications);
end $$;

revoke all on function public.nino_refresh_diagnosis(uuid,date,text,text) from public, anon, authenticated;