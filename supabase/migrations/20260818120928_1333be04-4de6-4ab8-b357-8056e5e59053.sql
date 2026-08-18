create or replace function public.nino_diag_detect_category_goal_alerts(
  _user_id uuid,
  _as_of date default current_date,
  _run_mode text default 'live',
  _run_id uuid default null
) returns integer
language plpgsql security definer set search_path=public as $$
declare
  r record;
  v_detected int := 0;
  v_start date; v_end date;
  v_limit numeric; v_spent numeric; v_projected numeric;
  v_days_total int; v_days_elapsed int; v_days_left int;
  v_over numeric; v_projected_over numeric; v_daily numeric;
  v_name text;
begin
  for r in
    select g.*, c.name as category_name
      from public.category_spending_goals g
      left join public.categories c on c.id = g.category_id
     where g.user_id = _user_id
       and g.status = 'active'
       and coalesce(g.computed_limit,0) > 0
  loop
    if coalesce(r.period_type, r.frequency) = 'monthly' or r.frequency = 'monthly' then
      v_start := greatest(date_trunc('month', _as_of)::date, r.start_date);
      v_end := least((date_trunc('month', _as_of) + interval '1 month - 1 day')::date,
                     coalesce(r.recurrence_end_date, (date_trunc('month', _as_of) + interval '1 month - 1 day')::date));
    else
      v_start := r.start_date;
      v_end := coalesce(r.end_date, r.start_date);
    end if;

    if v_start is null or v_end is null or _as_of < v_start or _as_of > v_end then
      continue;
    end if;

    select coalesce(sum(t.amount),0) into v_spent
      from public.transactions t
     where t.user_id = _user_id
       and t.status = 'confirmed'
       and t.type = 'expense'
       and coalesce(t.movement_kind,'transaction') = 'transaction'
       and t.category_id = r.category_id
       and t.occurred_at between v_start and _as_of;

    v_limit := r.computed_limit;
    v_days_total := greatest(1, (v_end - v_start) + 1);
    v_days_elapsed := greatest(1, (_as_of - v_start) + 1);
    v_days_left := greatest(0, v_end - _as_of);
    v_projected := round((v_spent / v_days_elapsed) * v_days_total, 2);
    v_over := greatest(0, v_spent - v_limit);
    v_projected_over := greatest(0, v_projected - v_limit);
    v_daily := case when v_days_left > 0 then round(greatest(0, v_limit - v_spent) / v_days_left, 2) else 0 end;
    v_name := coalesce(r.category_name, 'esta categoria');

    if v_over > 0 then
      perform public.nino_diag_put_situation(
        _user_id, _run_mode, _run_id, _as_of,
        'goal_feasibility',
        'category_goal_breach:' || r.id::text || ':' || to_char(v_start,'YYYY-MM-DD'),
        'worsening', 'now', 'critical', 0.95,
        v_start, _as_of, v_spent, v_limit, v_spent - v_limit,
        case when v_limit > 0 then ((v_spent - v_limit) / v_limit) * 100 else null end,
        v_over,
        'Você passou o teto de ' || v_name || ' em ' || public.nino_diag_brl(v_over),
        'A meta previa até ' || public.nino_diag_brl(v_limit) || ' no período e você já gastou '
          || public.nino_diag_brl(v_spent) || '.',
        case when v_days_left > 0
             then 'Faltam ' || v_days_left || ' dia(s) no período: cada novo gasto aumenta o excesso.'
             else 'O período está encerrando acima do teto combinado.' end,
        case when v_days_left > 0
             then 'Mantido o ritmo, o período deve fechar em ' || public.nino_diag_brl(v_projected) || '.'
             else null end,
        (_as_of + 3)::timestamptz,
        jsonb_build_object('goal_id',r.id,'goal_kind','category_spending','category_id',r.category_id,
                          'category_name',v_name,'limit',v_limit,'spent',v_spent,
                          'overage',v_over,'projected',v_projected,'period_start',v_start,'period_end',v_end,
                          'days_left',v_days_left),
        jsonb_build_object('evidence_type','category_goal','metric_key','category_goal_spend','value',v_spent),
        jsonb_build_object('key','category_goal:review','type','review_goal',
                           'title','Ver o plano do Nino para ' || v_name,
                           'route','/app/metas/categoria/' || r.id::text,'priority',92)
      );
      v_detected := v_detected + 1;

    elsif v_days_elapsed >= 3 and v_days_left > 0 and v_projected_over > 0 and v_projected_over >= v_limit * 0.05 then
      perform public.nino_diag_put_situation(
        _user_id, _run_mode, _run_id, _as_of,
        'goal_feasibility',
        'category_goal_risk:' || r.id::text || ':' || to_char(v_start,'YYYY-MM-DD'),
        'active', 'future', 'attention', 0.82,
        v_start, _as_of, v_spent, v_limit, v_projected - v_limit,
        case when v_limit > 0 then ((v_projected - v_limit) / v_limit) * 100 else null end,
        v_projected_over,
        'No ritmo atual, ' || v_name || ' fecha ' || public.nino_diag_brl(v_projected_over) || ' acima do teto',
        'Você gastou ' || public.nino_diag_brl(v_spent) || ' em ' || v_days_elapsed
          || ' dia(s), o que projeta ' || public.nino_diag_brl(v_projected) || ' até o fim do período.',
        'Para fechar dentro do teto, o limite diário passa a ser '
          || public.nino_diag_brl(v_daily) || ' nos próximos ' || v_days_left || ' dia(s).',
        'Ainda dá tempo de corrigir sem cortes drásticos.',
        (_as_of + 3)::timestamptz,
        jsonb_build_object('goal_id',r.id,'goal_kind','category_spending','category_id',r.category_id,
                          'category_name',v_name,'limit',v_limit,'spent',v_spent,
                          'projected',v_projected,'projected_overage',v_projected_over,
                          'daily_allowance',v_daily,'period_start',v_start,'period_end',v_end,
                          'days_left',v_days_left),
        jsonb_build_object('evidence_type','category_goal','metric_key','category_goal_projection','value',v_projected),
        jsonb_build_object('key','category_goal:adjust','type','review_goal',
                           'title','Ajustar o ritmo de ' || v_name,
                           'route','/app/metas/categoria/' || r.id::text,'priority',86)
      );
      v_detected := v_detected + 1;
    end if;
  end loop;

  return v_detected;
end $$;

revoke all on function public.nino_diag_detect_category_goal_alerts(uuid,date,text,uuid) from public, anon, authenticated;

create or replace function public.nino_refresh_diagnosis(
  _user_id uuid,
  _as_of date default current_date,
  _run_mode text default 'live',
  _source text default 'engine'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_eval jsonb; v_snapshot uuid; v_projected int:=0; v_communications int:=0;
  v_future int:=0; v_debts int:=0; v_emotional int:=0; v_cat_goals int:=0; v_run_id uuid;
begin
  v_eval := public.nino_evaluate_financial_situations(_user_id,_as_of,_run_mode,_source);
  v_run_id := (v_eval->>'run_id')::uuid;
  v_future := public.nino_evaluate_future_situations(_user_id,_as_of,_run_mode,v_run_id);
  v_debts := public.nino_diag_detect_debt_alerts(_user_id,_as_of,_run_mode,v_run_id);
  v_emotional := public.nino_diag_detect_emotional_gap(_user_id,_as_of,_run_mode,v_run_id);
  v_cat_goals := public.nino_diag_detect_category_goal_alerts(_user_id,_as_of,_run_mode,v_run_id);
  v_snapshot := public.nino_assemble_diagnosis(_user_id,_as_of,_run_mode);
  if _run_mode='live' then
    v_projected := public.nino_project_diagnosis(_user_id,v_snapshot);
    v_communications := public.nino_project_diagnosis_communications(_user_id,v_snapshot);
  end if;
  update public.nino_diagnosis_runs
     set projected_items=v_projected, finished_at=coalesce(finished_at,now())
   where id=v_run_id;
  return v_eval||jsonb_build_object('snapshot_id',v_snapshot,'projected_items',v_projected,
    'future_situations',v_future,'debt_alerts',v_debts,'emotional_alerts',v_emotional,
    'category_goal_alerts',v_cat_goals,'communications',v_communications);
end $$;

revoke all on function public.nino_refresh_diagnosis(uuid,date,text,text) from public, anon, authenticated;