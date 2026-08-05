-- ---------------------------------------------------------------------------
-- 5. DIAGNÓSTICO CONSOLIDADO E PROJEÇÕES
-- ---------------------------------------------------------------------------

create or replace function public.nino_assemble_diagnosis(
  _user_id uuid,
  _as_of date default current_date,
  _run_mode text default 'live'
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_primary public.financial_situations;
  v_supporting uuid[] := '{}'::uuid[];
  v_primary_action uuid;
  v_state text := 'stable';
  v_confidence numeric := 0;
  v_snapshot uuid;
  v_quality jsonb;
  v_payload jsonb;
  v_max_supporting int := 3;
  v_min_conf numeric := 0.60;
begin
  select max_supporting, min_primary_confidence
    into v_max_supporting, v_min_conf
    from public.nino_diagnosis_config where singleton=true;

  select * into v_primary
    from public.financial_situations s
   where s.user_id=_user_id and s.run_mode=_run_mode
     and s.status in ('active','confirmed','improving','worsening')
     -- Uma situação futura pode ser o assunto principal quando já exige decisão agora
     -- (ex.: pressão de caixa antes do vencimento). O score continua controlando a relevância.
     and s.temporal_scope in ('now','future')
     and s.situation_type not in ('data_quality_issue','duplicate_review','shared_payment_confirmation','behavioral_pattern')
     and s.confidence>=v_min_conf
     and (s.valid_until is null or s.valid_until>now())
   order by
     case s.severity when 'critical' then 4 when 'attention' then 3 when 'positive' then 2 else 1 end desc,
     s.relevance_score desc, s.updated_at desc
   limit 1;

  select coalesce(array_agg(id order by relevance_score desc),'{}'::uuid[])
    into v_supporting
    from (
      select s.id, s.relevance_score
        from public.financial_situations s
       where s.user_id=_user_id and s.run_mode=_run_mode
         and s.status in ('active','confirmed','improving','worsening')
         and s.temporal_scope in ('now','future')
         and (v_primary.id is null or s.id<>v_primary.id)
         and s.situation_type not in ('data_quality_issue','duplicate_review','shared_payment_confirmation')
         and (s.valid_until is null or s.valid_until>now())
       order by s.relevance_score desc
       limit v_max_supporting
    ) x;

  if v_primary.id is not null then
    select id into v_primary_action
      from public.financial_situation_actions
     where situation_id=v_primary.id and status in ('proposed','accepted','in_progress')
     order by priority desc, created_at desc limit 1;
    v_state := case v_primary.severity when 'critical' then 'critical'
              when 'attention' then 'attention'
              when 'positive' then 'positive' else 'stable' end;
    v_confidence := v_primary.confidence;
  elsif not exists (select 1 from public.transactions where user_id=_user_id and status='confirmed') then
    v_state := 'insufficient_data';
    v_confidence := 0;
  end if;

  select jsonb_build_object(
    'uncategorized_count', coalesce((select (evaluation->>'uncategorized_count')::int
      from public.financial_situations where user_id=_user_id and run_mode=_run_mode
       and situation_type='data_quality_issue' and status in ('observed','active') order by updated_at desc limit 1),0),
    'duplicate_groups', coalesce((select (evaluation->>'pair_count')::int
      from public.financial_situations where user_id=_user_id and run_mode=_run_mode
       and situation_type='duplicate_review' and status in ('observed','active') order by updated_at desc limit 1),0)
  ) into v_quality;

  select jsonb_build_object(
    'primary_situation', (select to_jsonb(s) from public.financial_situations s where s.id=v_primary.id),
    'primary_action', (select to_jsonb(a) from public.financial_situation_actions a where a.id=v_primary_action),
    'supporting_situations', coalesce((select jsonb_agg(to_jsonb(s) order by s.relevance_score desc)
      from public.financial_situations s where s.id=any(coalesce(v_supporting,'{}'::uuid[]))),'[]'::jsonb),
    'captured_at', now()
  ) into v_payload;

  if _run_mode='live' then
    update public.nino_diagnosis_snapshots set is_current=false
     where user_id=_user_id and run_mode='live' and is_current;
  end if;

  insert into public.nino_diagnosis_snapshots(
    user_id, run_mode, as_of, overall_state, primary_situation_id,
    supporting_situation_ids, primary_action_id, forecast, data_quality,
    confidence, rationale, payload, contract_version, is_current
  ) values (
    _user_id, _run_mode, _as_of, v_state, v_primary.id,
    coalesce(v_supporting,'{}'::uuid[]), v_primary_action,
    jsonb_build_object('summary',v_primary.forecast_summary), v_quality,
    v_confidence,
    jsonb_build_object('primary_score',v_primary.relevance_score,
                       'primary_type',v_primary.situation_type,
                       'supporting_count',coalesce(array_length(v_supporting,1),0)),
    coalesce(v_payload,'{}'::jsonb),
    'nino_diagnosis_contract.v1', _run_mode='live'
  ) returning id into v_snapshot;

  return v_snapshot;
end $$;

create or replace function public.nino_project_diagnosis(
  _user_id uuid,
  _snapshot_id uuid
) returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_count int := 0;
  r record;
  v_kind public.nino_item_kind;
  v_role public.nino_temporal_role;
  v_category text;
  v_action jsonb;
  v_evidence jsonb;
  v_group_size int;
begin
  -- Legado deixa de disputar a verdade atual. Nada é apagado.
  update public.nino_intelligence_items
     set status='superseded', superseded_at=now(),
         suppression_reason=coalesce(suppression_reason,'superseded_by_diagnosis_core_v1'),
         updated_at=now()
   where user_id=_user_id and status='active' and source<>'financial_diagnosis';

  update public.nino_intelligence_items
     set status='superseded', superseded_at=now(), updated_at=now()
   where user_id=_user_id and status='active' and source='financial_diagnosis';

  for r in
    select s.*,
           a.id action_id, a.title action_title, a.route action_route,
           a.action_type, a.explanation action_explanation,
           e.metadata evidence_metadata
      from public.financial_situations s
      left join lateral (
        select * from public.financial_situation_actions x
         where x.situation_id=s.id and x.status in ('proposed','accepted','in_progress')
         order by x.priority desc limit 1
      ) a on true
      left join lateral (
        select metadata from public.financial_situation_evidence x
         where x.situation_id=s.id order by x.created_at desc limit 1
      ) e on true
     where s.user_id=_user_id and s.run_mode='live'
       and s.status in ('active','confirmed','improving','worsening','observed')
       and (s.valid_until is null or s.valid_until>now())
       and (
         s.temporal_scope in ('now','future')
         or (s.situation_type in ('behavioral_pattern','debt_progress') and s.temporal_scope='historical')
       )
     order by s.relevance_score desc
  loop
    v_kind := case r.situation_type
      when 'cash_flow_imbalance' then 'risk'::public.nino_item_kind
      when 'liquidity_pressure' then 'risk'::public.nino_item_kind
      when 'card_cycle_pressure' then 'risk'::public.nino_item_kind
      when 'goal_feasibility' then 'risk'::public.nino_item_kind
      when 'investment_drawdown' then 'risk'::public.nino_item_kind
      when 'recurring_commitment_pressure' then 'risk'::public.nino_item_kind
      when 'spending_pace_change' then 'change'::public.nino_item_kind
      when 'category_shift' then 'change'::public.nino_item_kind
      when 'debt_progress' then 'achievement'::public.nino_item_kind
      when 'behavioral_pattern' then 'pattern'::public.nino_item_kind
      when 'anticipation' then case when r.severity in ('critical','attention') then 'risk'::public.nino_item_kind else 'opportunity'::public.nino_item_kind end
      when 'shared_payment_confirmation' then 'pending_confirmation'::public.nino_item_kind
      else 'data_quality'::public.nino_item_kind
    end;

    v_role := case r.temporal_scope when 'future' then 'future'::public.nino_temporal_role
              when 'historical' then 'historical'::public.nino_temporal_role
              else 'now'::public.nino_temporal_role end;

    v_category := case when r.situation_type in ('data_quality_issue','duplicate_review','shared_payment_confirmation')
                       then 'operational' else 'intelligence' end;

    v_action := case when r.action_route is null then null else jsonb_build_object(
      'label',r.action_title,'route',r.action_route,'type',r.action_type,
      'action_id',r.action_id) end;
    v_evidence := coalesce(r.evaluation,'{}'::jsonb)
      || coalesce(r.evidence_metadata,'{}'::jsonb)
      || jsonb_build_object('situation_id',r.id,'diagnosis_snapshot_id',_snapshot_id,
                            'situation_type',r.situation_type,'relevance_score',r.relevance_score);
    v_group_size := greatest(1,coalesce((r.evaluation->>'pair_count')::int,1));

    insert into public.nino_intelligence_items(
      user_id, kind, temporal_role, status, priority, severity,
      title, summary, explanation, facts, evidence,
      primary_action, source, source_period_start, source_period_end,
      valid_from, valid_until, confidence, data_quality,
      dedup_key, formula_version, narrative_version, created_by,
      logical_topic_key, category, group_key, group_size,
      impact_amount, impact_pct, selection_reason,
      superseded_at, suppression_reason, updated_at
    ) values (
      _user_id, v_kind, v_role, 'active', r.relevance_score,
      case r.severity when 'critical' then 'critical' when 'attention' then 'attention' else 'info' end,
      r.headline, coalesce(r.cause_summary,''),
      trim(coalesce(r.consequence_summary,'') || case when r.forecast_summary is not null then ' '||r.forecast_summary else '' end),
      '[]'::jsonb, v_evidence, v_action, 'financial_diagnosis',
      r.period_start, r.period_end, r.valid_from, r.valid_until,
      r.confidence, case when v_category='operational' then 'attention' else 'ok' end,
      'diagnosis:situation:'||r.id::text, 'financial_situation.v1',
      'nino_diagnosis_narrative.v1','diagnosis_core',
      'situation:'||r.situation_key, v_category,
      case when r.situation_type='duplicate_review' then 'duplicate_review_summary' else r.situation_type end,
      v_group_size, r.impact_amount, r.percentage_delta,
      jsonb_build_object('diagnosis_snapshot_id',_snapshot_id,'score',r.relevance_score,
                         'situation_type',r.situation_type,'confidence',r.confidence),
      null, null, now()
    )
    on conflict (user_id,dedup_key) do update set
      kind=excluded.kind, temporal_role=excluded.temporal_role, status='active',
      priority=excluded.priority, severity=excluded.severity,
      title=excluded.title, summary=excluded.summary, explanation=excluded.explanation,
      evidence=excluded.evidence, primary_action=excluded.primary_action,
      source_period_start=excluded.source_period_start,
      source_period_end=excluded.source_period_end,
      valid_from=excluded.valid_from, valid_until=excluded.valid_until,
      confidence=excluded.confidence, data_quality=excluded.data_quality,
      formula_version=excluded.formula_version,
      narrative_version=excluded.narrative_version,
      logical_topic_key=excluded.logical_topic_key, category=excluded.category,
      group_key=excluded.group_key, group_size=excluded.group_size,
      impact_amount=excluded.impact_amount, impact_pct=excluded.impact_pct,
      selection_reason=excluded.selection_reason,
      superseded_at=null, suppression_reason=null, updated_at=now();
    v_count := v_count+1;
  end loop;

  return v_count;
end $$;

create or replace function public.nino_project_diagnosis_communications(
  _user_id uuid,
  _snapshot_id uuid
) returns integer
language plpgsql security definer set search_path=public as $$
declare r record; v_count int:=0; v_action jsonb; v_channel text; v_communication_mode text;
begin
  select communication_mode into v_communication_mode
    from public.nino_diagnosis_config where singleton=true;
  if coalesce(v_communication_mode,'disabled')='disabled' then return 0; end if;

  update public.pending_proactive_suggestions
     set status='dismissed', defer_reason='superseded_by_diagnosis_core_v1'
   where user_id=_user_id and status in ('pending','ready','deferred')
     and dedup_key not like 'diagnosis:%';

  for r in
    select s.*, a.title action_title, a.route action_route, a.action_type
      from public.financial_situations s
      join public.financial_situation_actions a on a.situation_id=s.id
       and a.status in ('proposed','accepted','in_progress')
     where s.user_id=_user_id and s.run_mode='live'
       and s.status in ('active','worsening','confirmed')
       and s.confidence>=0.70 and s.relevance_score>=70
       and (s.temporal_scope='future' or s.severity='critical')
       and (s.valid_until is null or s.valid_until>now())
     order by s.relevance_score desc limit 2
  loop
    v_action := jsonb_build_object('label',r.action_title,'route',r.action_route,'type',r.action_type,
                                   'situation_id',r.id,'diagnosis_snapshot_id',_snapshot_id);
    v_channel := case
      when v_communication_mode='full'
       and (r.severity='critical' or (r.temporal_scope='future' and r.valid_until<=now()+interval '48 hours'))
      then 'both'
      else 'app'
    end;

    insert into public.pending_proactive_suggestions(
      user_id, kind, severity, title, body, action, evidence,
      channel_ready, dedup_key, logical_dedup_key, status,
      expires_at, next_attempt_at
    ) values (
      _user_id, r.situation_type,
      case r.severity when 'critical' then 'critical' when 'attention' then 'attention' else 'info' end,
      r.headline,
      trim(coalesce(r.cause_summary,'') || case when r.forecast_summary is not null then ' '||r.forecast_summary else '' end),
      v_action,
      r.evaluation || jsonb_build_object('situation_id',r.id,'diagnosis_snapshot_id',_snapshot_id),
      v_channel,
      'diagnosis:'||r.situation_key,
      'diagnosis:'||r.situation_key,
      'pending', coalesce(r.valid_until,now()+interval '3 days'), now()
    )
    on conflict (user_id,dedup_key) do update set
      title=excluded.title, body=excluded.body, action=excluded.action,
      evidence=excluded.evidence, channel_ready=excluded.channel_ready,
      severity=excluded.severity, expires_at=excluded.expires_at,
      status=case when public.pending_proactive_suggestions.status='dispatched'
                  then 'dispatched' else 'pending' end,
      next_attempt_at=case when public.pending_proactive_suggestions.status='dispatched'
                           then public.pending_proactive_suggestions.next_attempt_at else now() end;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.nino_refresh_diagnosis(
  _user_id uuid,
  _as_of date default current_date,
  _run_mode text default 'live',
  _source text default 'engine'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_eval jsonb;
  v_snapshot uuid;
  v_projected int:=0;
  v_communications int:=0;
begin
  v_eval := public.nino_evaluate_financial_situations(_user_id,_as_of,_run_mode,_source);
  v_snapshot := public.nino_assemble_diagnosis(_user_id,_as_of,_run_mode);
  if _run_mode='live' then
    v_projected := public.nino_project_diagnosis(_user_id,v_snapshot);
    v_communications := public.nino_project_diagnosis_communications(_user_id,v_snapshot);
  end if;
  update public.nino_diagnosis_runs
     set projected_items=v_projected, finished_at=coalesce(finished_at,now())
   where id=(v_eval->>'run_id')::uuid;
  return v_eval || jsonb_build_object('snapshot_id',v_snapshot,'projected_items',v_projected,
                                      'communications',v_communications);
end $$;

-- Contrato canônico direto, útil para novas superfícies, agente e auditoria.
create or replace function public.nino_diagnosis_context_for_user(_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_snapshot public.nino_diagnosis_snapshots;
  v_enabled boolean;
  v_mode text;
begin
  if _user_id is null then return jsonb_build_object('ok',false,'error','missing_user'); end if;
  select enabled, rollout_mode into v_enabled, v_mode
    from public.nino_diagnosis_config where singleton=true;
  if not coalesce(v_enabled,false) or v_mode='legacy' then
    return jsonb_build_object('ok',true,'contract','nino_diagnosis_contract.v1',
      'mode','legacy','snapshot_id',null,'as_of',now(),'overall_state','insufficient_data',
      'primary_situation',null,'supporting_situations','[]'::jsonb,'primary_action',null,
      'patterns','[]'::jsonb,'anticipations','[]'::jsonb,'operational_tasks','[]'::jsonb,
      'forecast','{}'::jsonb,'data_quality','{}'::jsonb,'confidence',0,
      'rationale','{}'::jsonb,'snapshot_payload','{}'::jsonb);
  end if;
  select * into v_snapshot from public.nino_diagnosis_snapshots
   where user_id=_user_id and run_mode='live' and is_current
   order by created_at desc limit 1;
  if v_snapshot.id is null then
    return jsonb_build_object('ok',true,'contract','nino_diagnosis_contract.v1',
      'snapshot_id',null,'as_of',now(),'overall_state','insufficient_data','primary_situation',null,
      'supporting_situations','[]'::jsonb,'primary_action',null,
      'patterns','[]'::jsonb,'anticipations','[]'::jsonb,
      'operational_tasks','[]'::jsonb,'forecast','{}'::jsonb,
      'data_quality','{}'::jsonb,'confidence',0,'rationale','{}'::jsonb,
      'snapshot_payload','{}'::jsonb);
  end if;
  return jsonb_build_object(
    'ok',true,'contract',v_snapshot.contract_version,'snapshot_id',v_snapshot.id,
    'as_of',v_snapshot.created_at,'overall_state',v_snapshot.overall_state,
    'primary_situation',(select to_jsonb(s) from public.financial_situations s where s.id=v_snapshot.primary_situation_id),
    'supporting_situations',coalesce((select jsonb_agg(to_jsonb(s) order by s.relevance_score desc)
      from public.financial_situations s where s.id=any(v_snapshot.supporting_situation_ids)),'[]'::jsonb),
    'primary_action',(select to_jsonb(a) from public.financial_situation_actions a where a.id=v_snapshot.primary_action_id),
    'patterns',coalesce((select jsonb_agg(to_jsonb(s) order by s.relevance_score desc)
      from public.financial_situations s where s.user_id=_user_id and s.run_mode='live'
       and s.situation_type='behavioral_pattern' and s.status in ('observed','confirmed','active')),'[]'::jsonb),
    'anticipations',coalesce((select jsonb_agg(to_jsonb(s) order by s.period_end)
      from public.financial_situations s where s.user_id=_user_id and s.run_mode='live'
       and s.situation_type='anticipation' and s.status in ('active','confirmed')),'[]'::jsonb),
    'operational_tasks',coalesce((select jsonb_agg(to_jsonb(s) order by s.relevance_score desc)
      from public.financial_situations s where s.user_id=_user_id and s.run_mode='live'
       and s.situation_type in ('data_quality_issue','duplicate_review','shared_payment_confirmation')
       and s.status in ('observed','active','confirmed')),'[]'::jsonb),
    'forecast',v_snapshot.forecast,'data_quality',v_snapshot.data_quality,
    'confidence',v_snapshot.confidence,'rationale',v_snapshot.rationale,
    'snapshot_payload',v_snapshot.payload
  );
end $$;

create or replace function public.my_nino_diagnosis_context()
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  return public.nino_diagnosis_context_for_user(v_uid);
end $$;

-- Feedback e ações fecham o ciclo de aprendizado no domínio de situações.
create or replace function public.my_nino_item_act(_item_id uuid, _surface text default 'nino')
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_situation_id uuid; v_opportunity_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  update public.nino_intelligence_items
     set acted_at=coalesce(acted_at,now()), updated_at=now()
   where id=_item_id and user_id=v_uid
   returning nullif(evidence->>'situation_id','')::uuid,
             nullif(evidence->>'opportunity_id','')::uuid
        into v_situation_id,v_opportunity_id;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;

  insert into public.nino_item_exposures(user_id,item_id,surface,acted_at,outcome,shown_at)
  values(v_uid,_item_id,_surface,now(),'acted',now());

  if v_situation_id is not null then
    insert into public.financial_situation_feedback(user_id,situation_id,item_id,surface,feedback)
    values(v_uid,v_situation_id,_item_id,_surface,'acted');
    update public.financial_situation_actions
       set status=case when status='proposed' then 'accepted' else status end, updated_at=now()
     where situation_id=v_situation_id and status in ('proposed','accepted','in_progress');
  end if;
  if v_opportunity_id is not null then
    update public.anticipation_outcomes set acted=true,updated_at=now()
     where user_id=v_uid and opportunity_id=v_opportunity_id;
  end if;
  return jsonb_build_object('ok',true,'situation_id',v_situation_id);
end $$;

-- Preserva a decisão de duplicidade legada antes de substituir o RPC público.
do $$
begin
  if to_regprocedure('public.my_nino_duplicate_decision_legacy(text,text)') is null
     and to_regprocedure('public.my_nino_duplicate_decision(text,text)') is not null then
    alter function public.my_nino_duplicate_decision(text,text) rename to my_nino_duplicate_decision_legacy;
  end if;
end $$;

create or replace function public.my_nino_duplicate_decision(_pair_key text, _decision text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_result jsonb; v_enabled boolean; v_mode text;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  select enabled,rollout_mode into v_enabled,v_mode from public.nino_diagnosis_config where singleton=true;
  if not coalesce(v_enabled,false) or v_mode='legacy' then
    return public.my_nino_duplicate_decision_legacy(_pair_key,_decision);
  end if;
  if coalesce(_pair_key,'')='' or _decision not in ('distinct','duplicate','ignored') then
    return jsonb_build_object('ok',false,'error','invalid_input');
  end if;
  insert into public.nino_duplicate_decisions(user_id,pair_key,decision)
  values(v_uid,_pair_key,_decision)
  on conflict(user_id,pair_key) do update set decision=excluded.decision,updated_at=now();

  v_result:=public.nino_refresh_diagnosis(v_uid,current_date,'live','duplicate_decision');
  return jsonb_build_object('ok',true,'pair_key',_pair_key,'decision',_decision,
                            'diagnosis_snapshot_id',v_result->>'snapshot_id');
end $$;

create or replace function public.my_nino_item_feedback(
  _item_id uuid,
  _feedback text,
  _surface text default 'nino'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_situation_id uuid; v_opportunity_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  if _feedback not in ('useful','not_useful','dismiss') then
    return jsonb_build_object('ok',false,'error','invalid_feedback');
  end if;
  select nullif(evidence->>'situation_id','')::uuid,
         nullif(evidence->>'opportunity_id','')::uuid
    into v_situation_id,v_opportunity_id
    from public.nino_intelligence_items where id=_item_id and user_id=v_uid;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;

  insert into public.nino_item_exposures(user_id,item_id,surface,feedback,outcome,shown_at)
  values(v_uid,_item_id,_surface,_feedback,_feedback,now());

  if v_situation_id is not null then
    insert into public.financial_situation_feedback(user_id,situation_id,item_id,surface,feedback)
    values(v_uid,v_situation_id,_item_id,_surface,_feedback);
  end if;
  if v_opportunity_id is not null then
    update public.anticipation_outcomes
       set user_feedback=_feedback, interacted=true, updated_at=now()
     where user_id=v_uid and opportunity_id=v_opportunity_id;
  end if;
  if _feedback='dismiss' then
    update public.nino_intelligence_items
       set status='dismissed',dismissed_at=now(),updated_at=now()
     where id=_item_id and user_id=v_uid;
    if v_situation_id is not null then
      update public.financial_situations
         set status='suppressed',resolved_at=now(),updated_at=now()
       where id=v_situation_id and user_id=v_uid;
      update public.financial_situation_actions
         set status='dismissed',updated_at=now()
       where situation_id=v_situation_id and status in ('proposed','accepted','in_progress');
    end if;
  end if;
  return jsonb_build_object('ok',true,'situation_id',v_situation_id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. COMPATIBILIDADE, TICK, BACKTEST E ROLLBACK
-- ---------------------------------------------------------------------------

-- Preserva as funções legadas para rollback sem depender de um novo deploy.
do $$
begin
  if to_regprocedure('public.nino_legacy_rebuild_items(uuid,text)') is null
     and to_regprocedure('public.nino_rebuild_items(uuid,text)') is not null then
    alter function public.nino_rebuild_items(uuid,text) rename to nino_legacy_rebuild_items;
  end if;
  if to_regprocedure('public.nino_legacy_intelligence_tick()') is null
     and to_regprocedure('public.nino_intelligence_tick()') is not null then
    alter function public.nino_intelligence_tick() rename to nino_legacy_intelligence_tick;
  end if;
  if to_regprocedure('public.my_nino_refresh_legacy()') is null
     and to_regprocedure('public.my_nino_refresh()') is not null then
    alter function public.my_nino_refresh() rename to my_nino_refresh_legacy;
  end if;
end $$;

create or replace function public.nino_rebuild_items(
  _user_id uuid,
  _created_by text default 'engine'
) returns integer
language plpgsql security definer set search_path=public as $$
declare v_enabled boolean; v_mode text; v_result jsonb;
begin
  select enabled,rollout_mode into v_enabled,v_mode from public.nino_diagnosis_config where singleton=true;
  if not coalesce(v_enabled,false) or v_mode='legacy' then
    return public.nino_legacy_rebuild_items(_user_id,_created_by);
  end if;
  v_result:=public.nino_refresh_diagnosis(_user_id,current_date,
    case when v_mode='shadow' then 'shadow' else 'live' end,_created_by);
  return coalesce((v_result->>'projected_items')::int,0);
end $$;

create or replace function public.my_nino_refresh()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid();
  v_result jsonb;
  v_active int;
  v_enabled boolean;
  v_mode text;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  select enabled,rollout_mode into v_enabled,v_mode from public.nino_diagnosis_config where singleton=true;
  if not coalesce(v_enabled,false) or v_mode='legacy' then
    return public.my_nino_refresh_legacy();
  end if;
  v_result:=public.nino_refresh_diagnosis(v_uid,current_date,'live','manual');
  select count(*)::int into v_active from public.nino_intelligence_items
   where user_id=v_uid and source='financial_diagnosis' and status='active';
  return jsonb_build_object(
    'ok',true,'at',now(),'items',v_active,'facts_processed',coalesce((v_result->>'detected')::int,0),
    'counts',jsonb_build_object(
      'created',coalesce((v_result->>'detected')::int,0),
      'updated',0,'superseded',coalesce((v_result->>'resolved')::int,0),
      'expired',0,'grouped',0,'suppressed',0,'active_total',v_active
    ),
    'diagnosis_snapshot_id',v_result->>'snapshot_id',
    'communications',coalesce((v_result->>'communications')::int,0),
    'contract','nino_diagnosis_contract.v1'
  );
end $$;

create or replace function public.nino_diagnosis_tick()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare r record; v_ok int:=0; v_failed int:=0; v_errors jsonb:='[]'::jsonb;
begin
  for r in select id from auth.users loop
    begin
      perform public.nino_refresh_diagnosis(r.id,current_date,'live','scheduled');
      v_ok:=v_ok+1;
    exception when others then
      v_failed:=v_failed+1;
      v_errors:=v_errors||jsonb_build_object('user_id',r.id,'error',sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok',v_failed=0,'processed',v_ok,'failed',v_failed,'errors',v_errors,
                            'contract','nino_diagnosis_contract.v1','at',now());
end $$;

create or replace function public.nino_intelligence_tick()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_enabled boolean; v_mode text;
begin
  select enabled,rollout_mode into v_enabled,v_mode from public.nino_diagnosis_config where singleton=true;
  if not coalesce(v_enabled,false) or v_mode='legacy' then
    return public.nino_legacy_intelligence_tick();
  end if;
  if v_mode='shadow' then
    return jsonb_build_object('ok',true,'mode','shadow','note','Use nino_diagnosis_backtest para homologação histórica.');
  end if;
  return public.nino_diagnosis_tick();
end $$;

create or replace function public.nino_diagnosis_backtest(
  _user_id uuid,
  _from date,
  _to date,
  _step_days int default 7
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d date; v_count int:=0; v_snapshots jsonb:='[]'::jsonb; v_result jsonb; v_snapshot uuid;
begin
  if current_user not in ('postgres','service_role','supabase_admin')
     and auth.uid() is distinct from _user_id
     and not exists (select 1 from public.user_roles where user_id=auth.uid() and role::text in ('admin','platform_admin')) then
    raise exception 'forbidden';
  end if;
  if _from is null or _to is null or _from>_to then raise exception 'invalid backtest range'; end if;
  if _step_days<1 or _step_days>31 then raise exception 'step_days must be between 1 and 31'; end if;
  delete from public.nino_diagnosis_snapshots where user_id=_user_id and run_mode='backtest' and as_of between _from and _to;
  delete from public.financial_situations where user_id=_user_id and run_mode='backtest'
    and period_end between _from and _to;
  for d in select generate_series(_from::timestamp,_to::timestamp,make_interval(days=>_step_days))::date loop
    v_result:=public.nino_evaluate_financial_situations(_user_id,d,'backtest','backtest');
    v_snapshot:=public.nino_assemble_diagnosis(_user_id,d,'backtest');
    v_snapshots:=v_snapshots||jsonb_build_object(
      'as_of',d,'snapshot_id',v_snapshot,
      'overall_state',(select overall_state from public.nino_diagnosis_snapshots where id=v_snapshot),
      'primary_headline',(select s.headline from public.nino_diagnosis_snapshots n
        left join public.financial_situations s on s.id=n.primary_situation_id where n.id=v_snapshot)
    );
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('ok',true,'runs',v_count,'from',_from,'to',_to,'snapshots',v_snapshots);
end $$;

create or replace function public.nino_diagnosis_rollback()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_restored int:=0;
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    if v_uid is null then raise exception 'unauthenticated'; end if;
    if not exists (select 1 from public.user_roles where user_id=v_uid and role::text in ('admin','platform_admin')) then
      raise exception 'forbidden';
    end if;
  end if;
  update public.nino_diagnosis_config
     set enabled=false,rollout_mode='legacy',communication_mode='disabled',updated_at=now()
   where singleton=true;
  update public.nino_intelligence_items
     set status='superseded',superseded_at=now(),updated_at=now()
   where source='financial_diagnosis' and status='active';
  update public.nino_intelligence_items
     set status='active',superseded_at=null,suppression_reason=null,updated_at=now()
   where status='superseded' and suppression_reason='superseded_by_diagnosis_core_v1'
     and (valid_until is null or valid_until>now());
  get diagnostics v_restored=row_count;
  update public.pending_proactive_suggestions
     set status='dismissed',defer_reason='diagnosis_core_rollback'
   where dedup_key like 'diagnosis:%' and status in ('pending','ready','deferred');
  return jsonb_build_object('ok',true,'mode','legacy','legacy_items_restored',v_restored,'at',now());
end $$;

-- Segurança das funções públicas e internas.
revoke all on function public.nino_legacy_rebuild_items(uuid,text) from public, anon, authenticated;
revoke all on function public.nino_legacy_intelligence_tick() from public, anon, authenticated;
revoke all on function public.my_nino_refresh_legacy() from public, anon, authenticated;
revoke all on function public.my_nino_duplicate_decision_legacy(text,text) from public, anon, authenticated;
revoke all on function public.nino_diagnosis_context_for_user(uuid) from public, anon, authenticated;
revoke all on function public.my_nino_diagnosis_context() from public, anon;
revoke all on function public.my_nino_refresh() from public, anon;
revoke all on function public.my_nino_item_act(uuid,text) from public, anon;
revoke all on function public.my_nino_item_feedback(uuid,text,text) from public, anon;
revoke all on function public.my_nino_duplicate_decision(text,text) from public, anon;
revoke all on function public.nino_diagnosis_backtest(uuid,date,date,int) from public, anon;
revoke all on function public.nino_diagnosis_rollback() from public, anon;
revoke all on function public.nino_guard_diagnosis_snapshot_immutable() from public, anon, authenticated;
revoke all on function public.nino_guard_legacy_surface_write() from public, anon, authenticated;
revoke all on function public.nino_guard_legacy_proactive_write() from public, anon, authenticated;
revoke all on function public.nino_assemble_diagnosis(uuid,date,text) from public, anon, authenticated;
revoke all on function public.nino_project_diagnosis(uuid,uuid) from public, anon, authenticated;
revoke all on function public.nino_project_diagnosis_communications(uuid,uuid) from public, anon, authenticated;
revoke all on function public.nino_refresh_diagnosis(uuid,date,text,text) from public, anon, authenticated;
revoke all on function public.nino_diagnosis_tick() from public, anon, authenticated;
revoke all on function public.nino_intelligence_tick() from public, anon, authenticated;
revoke all on function public.nino_rebuild_items(uuid,text) from public, anon, authenticated;
grant execute on function public.nino_diagnosis_context_for_user(uuid) to service_role;
grant execute on function public.my_nino_diagnosis_context() to authenticated;
grant execute on function public.my_nino_refresh() to authenticated;
grant execute on function public.my_nino_item_act(uuid,text) to authenticated;
grant execute on function public.my_nino_item_feedback(uuid,text,text) to authenticated;
grant execute on function public.my_nino_duplicate_decision(text,text) to authenticated;
grant execute on function public.nino_diagnosis_backtest(uuid,date,date,int) to authenticated;
grant execute on function public.nino_diagnosis_rollback() to authenticated;
grant execute on function public.nino_diagnosis_tick() to service_role;
grant execute on function public.nino_intelligence_tick() to service_role;
grant execute on function public.nino_rebuild_items(uuid,text) to service_role;

-- Stage 6: filas legadas deixam de alimentar novas comunicações. Mantém histórico.
update public.pending_proactive_suggestions
   set status='dismissed', defer_reason='superseded_by_diagnosis_core_v1'
 where status in ('pending','ready','deferred')
   and dedup_key not like 'diagnosis:%';

-- Backfill inicial em produção. A migration é atômica: qualquer falha por usuário
-- impede o commit, evitando publicar um núcleo parcialmente inicializado.
do $$
declare
  v_result jsonb;
  v_users int;
  v_processed int;
  v_failed int;
begin
  select count(*)::int into v_users from auth.users;
  v_result := public.nino_diagnosis_tick();
  v_processed := coalesce((v_result->>'processed')::int, 0);
  v_failed := coalesce((v_result->>'failed')::int, 0);

  if v_failed > 0 then
    raise exception 'nino_diagnosis_initialization_failed: %', v_result;
  end if;
  if v_users > 0 and v_processed <> v_users then
    raise exception 'nino_diagnosis_initialization_incomplete: users=%, processed=%, result=%',
      v_users, v_processed, v_result;
  end if;
end $$;

-- O núcleo só se torna a fonte ativa depois de todos os usuários terem sido
-- inicializados com sucesso. WhatsApp proativo permanece em app_only até a
-- homologação operacional; a capacidade full já está instalada e versionada.
update public.nino_diagnosis_config
   set rollout_mode='active', communication_mode='app_only', updated_at=now()
 where singleton=true;