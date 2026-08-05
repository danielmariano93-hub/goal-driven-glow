-- ---------------------------------------------------------------------------
-- 3. HELPERS DETERMINÍSTICOS
-- ---------------------------------------------------------------------------

create or replace function public.nino_diag_brl(_value numeric)
returns text language sql immutable set search_path=public as $$
  select public.nino_brl(coalesce(_value,0));
$$;

create or replace function public.nino_diag_pct(_value numeric)
returns text language sql immutable set search_path=public as $$
  select public.nino_num(coalesce(_value,0)) || '%';
$$;

create or replace function public.nino_diag_score(
  _severity text,
  _confidence numeric,
  _impact numeric,
  _impact_pct numeric,
  _temporal_scope text,
  _actionable boolean,
  _positive boolean default false
) returns integer
language sql immutable set search_path=public as $$
  select greatest(1, least(100, (
    case _severity when 'critical' then 82 when 'attention' then 66 when 'positive' then 48 else 42 end
    + least(10, (abs(coalesce(_impact,0))/250)::int)
    + least(8, (abs(coalesce(_impact_pct,0))/8)::int)
    + (coalesce(_confidence,0.5)*8)::int
    + case when _temporal_scope='future' then 5 else 0 end
    + case when _actionable then 5 else 0 end
    - case when _positive then 6 else 0 end
  )::int));
$$;

create or replace function public.nino_diag_put_situation(
  _user_id uuid,
  _run_mode text,
  _run_id uuid,
  _as_of date,
  _situation_type text,
  _situation_key text,
  _status text,
  _temporal_scope text,
  _severity text,
  _confidence numeric,
  _period_start date,
  _period_end date,
  _current_value numeric,
  _baseline_value numeric,
  _absolute_delta numeric,
  _percentage_delta numeric,
  _impact_amount numeric,
  _headline text,
  _cause text,
  _consequence text,
  _forecast text,
  _valid_until timestamptz,
  _evaluation jsonb,
  _evidence jsonb,
  _action jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_id uuid;
  v_key text := _situation_key || case when _run_mode='live' then '' else ':' || _as_of::text end;
  v_score int;
  v_actionable boolean := coalesce(_action->>'route','') <> '';
  v_action_key text := coalesce(_action->>'key', _situation_type || ':primary');
  v_positive boolean := _severity='positive' or _status='improving';
begin
  v_score := public.nino_diag_score(_severity, _confidence, _impact_amount, _percentage_delta,
                                     _temporal_scope, v_actionable, v_positive);

  insert into public.financial_situations(
    user_id, run_mode, situation_key, situation_type, status, temporal_scope,
    severity, confidence, relevance_score, period_start, period_end,
    current_value, baseline_value, absolute_delta, percentage_delta, impact_amount,
    headline, cause_summary, consequence_summary, forecast_summary,
    evaluation, valid_from, valid_until, formula_version, last_evaluation_run_id,
    resolved_at, updated_at
  ) values (
    _user_id, _run_mode, v_key, _situation_type, _status, _temporal_scope,
    _severity, greatest(0,least(1,coalesce(_confidence,0.5))), v_score,
    _period_start, _period_end, _current_value, _baseline_value,
    _absolute_delta, _percentage_delta, _impact_amount,
    _headline, _cause, _consequence, _forecast,
    coalesce(_evaluation,'{}'::jsonb), now(), _valid_until,
    'financial_situation.v1', _run_id, null, now()
  )
  on conflict (user_id, run_mode, situation_key) do update set
    situation_type=excluded.situation_type,
    status=excluded.status,
    temporal_scope=excluded.temporal_scope,
    severity=excluded.severity,
    confidence=excluded.confidence,
    relevance_score=excluded.relevance_score,
    period_start=excluded.period_start,
    period_end=excluded.period_end,
    current_value=excluded.current_value,
    baseline_value=excluded.baseline_value,
    absolute_delta=excluded.absolute_delta,
    percentage_delta=excluded.percentage_delta,
    impact_amount=excluded.impact_amount,
    headline=excluded.headline,
    cause_summary=excluded.cause_summary,
    consequence_summary=excluded.consequence_summary,
    forecast_summary=excluded.forecast_summary,
    evaluation=excluded.evaluation,
    valid_from=excluded.valid_from,
    valid_until=excluded.valid_until,
    formula_version=excluded.formula_version,
    last_evaluation_run_id=excluded.last_evaluation_run_id,
    resolved_at=null,
    updated_at=now()
  returning id into v_id;

  insert into public.financial_situation_evidence(
    situation_id, evaluation_run_id, evidence_type, metric_key, value, contribution_amount,
    contribution_pct, confidence, metadata
  ) values (
    v_id, _run_id, coalesce(_evidence->>'evidence_type','aggregate'), _evidence->>'metric_key',
    nullif(_evidence->>'value','')::numeric,
    nullif(_evidence->>'contribution_amount','')::numeric,
    nullif(_evidence->>'contribution_pct','')::numeric,
    _confidence, coalesce(_evidence,'{}'::jsonb)
  );

  if v_actionable then
    -- Mantém o mesmo action_id e preserva decisões já tomadas pelo usuário.
    -- Ações antigas que deixaram de ser a recomendação atual apenas expiram.
    update public.financial_situation_actions
       set status='expired', updated_at=now()
     where situation_id=v_id and action_key<>v_action_key and status='proposed';

    insert into public.financial_situation_actions(
      situation_id, action_key, action_type, title, explanation,
      estimated_impact, route, priority, status, expires_at, metadata
    ) values (
      v_id,
      v_action_key,
      coalesce(_action->>'type','review'),
      coalesce(_action->>'title','Ver detalhes'),
      _action->>'explanation',
      nullif(_action->>'estimated_impact','')::numeric,
      _action->>'route',
      coalesce(nullif(_action->>'priority','')::int, 70),
      'proposed', _valid_until, coalesce(_action,'{}'::jsonb)
    )
    on conflict (situation_id, action_key) do update set
      action_type=excluded.action_type,
      title=excluded.title,
      explanation=excluded.explanation,
      estimated_impact=excluded.estimated_impact,
      route=excluded.route,
      priority=excluded.priority,
      status=case when public.financial_situation_actions.status in ('accepted','in_progress','done','dismissed')
                  then public.financial_situation_actions.status else 'proposed' end,
      expires_at=excluded.expires_at,
      metadata=excluded.metadata,
      updated_at=now();
  else
    update public.financial_situation_actions
       set status='expired', updated_at=now()
     where situation_id=v_id and status='proposed';
  end if;

  update public.financial_situations s
     set relevance_score=greatest(1,least(100,
       s.relevance_score
       + 3*(select count(*) from public.financial_situation_feedback f where f.situation_id=s.id and f.feedback='useful' and f.created_at>now()-interval '90 days')
       - 8*(select count(*) from public.financial_situation_feedback f where f.situation_id=s.id and f.feedback in ('not_useful','dismiss') and f.created_at>now()-interval '90 days')
     ))
   where s.id=v_id;

  return v_id;
end $$;

revoke all on function public.nino_diag_put_situation(uuid,text,uuid,date,text,text,text,text,text,numeric,date,date,numeric,numeric,numeric,numeric,numeric,text,text,text,text,timestamptz,jsonb,jsonb,jsonb) from public, anon, authenticated;