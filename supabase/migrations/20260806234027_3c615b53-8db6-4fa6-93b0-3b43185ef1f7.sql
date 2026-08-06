-- 1. Ações com rotas válidas (deep links suportados pelo roteador do app)
create or replace function public.nino_diag_select_action(_situation_type text, _status text, _evaluation jsonb default '{}'::jsonb, _impact numeric default null::numeric)
returns jsonb language sql stable set search_path to 'public' as $function$
select case
 when _status in ('resolved','expired','suppressed') then '{}'::jsonb
 when _situation_type='behavioral_pattern' and _status='observed' then jsonb_build_object('key','understand_pattern','type','learn','title','Entender o padrão','route','/app/nino?section=aprendizados','explanation','Veja as evidências antes de tratar o padrão como confirmado','priority',55)
 when _situation_type='behavioral_pattern' then jsonb_build_object('key','review_pattern_spend','type','review','title','Ver os gastos do padrão','route','/app/lancamentos','explanation','Confira os lançamentos que sustentam este padrão','priority',60)
 when _situation_type='data_quality_issue' then jsonb_build_object('key','classify_transactions','type','classify','title','Classificar lançamentos','route','/app/lancamentos?filtro=sem-categoria','explanation','Melhorar a classificação aumenta a confiança das leituras','priority',85)
 when _situation_type='duplicate_review' then jsonb_build_object('key','review_duplicates','type','review','title','Revisar duplicidades','route','/app/lancamentos?revisar=duplicidades','explanation','Confirme quais lançamentos representam a mesma compra','priority',90)
 when _situation_type='goal_feasibility' then jsonb_build_object('key','recalibrate_goal','type','plan','title','Recalibrar meta','route',coalesce('/app/metas?goal='||nullif(_evaluation->>'goal_id','')||'&action=recalibrate','/app/metas'),'explanation','Ajuste prazo ou aporte para tornar a meta viável','estimated_impact',_impact,'priority',80)
 when _situation_type='card_cycle_pressure' or _evaluation->>'future_kind' in ('bill','installment') then jsonb_build_object('key','review_card','type','review','title','Revisar fatura e parcelas','route',coalesce('/app/cartoes?card='||nullif(_evaluation->>'card_id',''),'/app/cartoes'),'explanation','Antecipe o impacto antes do vencimento','estimated_impact',_impact,'priority',85)
 when _situation_type='cash_flow_imbalance' then jsonb_build_object('key','review_month_pressure','type','review','title','Revisar os gastos que pressionaram o mês','route','/app/relatorios?foco=categorias&periodo=atual','explanation','Veja quais categorias e lançamentos mais contribuíram para a diferença entre receitas e despesas.','estimated_impact',_impact,'priority',80)
 when _situation_type='anticipation' then jsonb_build_object('key','plan_ahead','type','plan','title','Planejar agora','route','/app/planejamento','explanation','Organize o caixa antes da data prevista','estimated_impact',_impact,'priority',80)
 when _situation_type='spending_pace_change' and _status='improving' then jsonb_build_object('key','review_improvement','type','review','title','Ver o que melhorou','route','/app/relatorios','explanation','Entenda o comportamento que ajudou o período','priority',45)
 else jsonb_build_object('key','review_details','type','review','title','Ver detalhes','route','/app/relatorios','explanation','Confira os fatos usados nesta leitura','estimated_impact',_impact,'priority',60)
end
$function$;

-- 2. Correção idempotente e restrita das ações já persistidas com rota inexistente
update public.financial_situation_actions
   set route = '/app/metas?goal=' || substring(route from '^/app/metas/([0-9a-fA-F-]{36})$') || '&action=recalibrate'
 where route ~ '^/app/metas/[0-9a-fA-F-]{36}$';

update public.financial_situation_actions
   set route = '/app/cartoes?card=' || substring(route from '^/app/cartoes/([0-9a-fA-F-]{36})$')
 where route ~ '^/app/cartoes/[0-9a-fA-F-]{36}$';

-- 3. Feedback idempotente por situação/feedback/superfície/dia
create or replace function public.my_nino_situation_feedback(_situation_id uuid, _feedback text, _surface text default 'nino'::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_dup boolean;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  if _feedback not in ('useful','not_useful','dismiss','acted') then return jsonb_build_object('ok',false,'error','invalid_feedback'); end if;
  if not exists(select 1 from public.financial_situations where id=_situation_id and user_id=v_uid) then
    return jsonb_build_object('ok',false,'error','not_found');
  end if;

  select exists(
    select 1 from public.financial_situation_feedback f
     where f.user_id=v_uid and f.situation_id=_situation_id and f.feedback=_feedback
       and coalesce(f.surface,'') = coalesce(_surface,'')
       and (f.created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date
  ) into v_dup;

  if v_dup then
    return jsonb_build_object('ok',true,'deduplicated',true);
  end if;

  insert into public.financial_situation_feedback(user_id,situation_id,surface,feedback)
  values(v_uid,_situation_id,_surface,_feedback);

  insert into public.financial_situation_events(user_id,situation_id,event_type,narrative,metadata)
  values(v_uid,_situation_id,
    case when _feedback='acted' then 'acted' else 'feedback' end,
    case _feedback
      when 'acted' then 'Você abriu a ação recomendada.'
      when 'useful' then 'Você marcou esta leitura como útil.'
      when 'dismiss' then 'Você dispensou esta leitura.'
      else 'Você enviou feedback sobre esta leitura.' end,
    jsonb_build_object('feedback',_feedback,'surface',_surface));

  if _feedback = 'acted' then
    update public.financial_situation_actions
       set status='accepted'
     where situation_id=_situation_id and user_id=v_uid and status='proposed';
  end if;

  return jsonb_build_object('ok',true,'deduplicated',false);
end $function$;

-- 4. Montagem do diagnóstico considera feedback e cooldown
create or replace function public.nino_diag_feedback_suppressed(_user_id uuid)
returns setof uuid language sql stable set search_path to 'public' as $function$
  select distinct f.situation_id
    from public.financial_situation_feedback f
   where f.user_id = _user_id
     and (
       (f.feedback in ('not_useful','dismiss') and f.created_at > now() - interval '7 days')
       or (f.feedback = 'useful'
           and (f.created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date)
     )
$function$;

create or replace function public.nino_assemble_diagnosis(_user_id uuid, _as_of date default CURRENT_DATE, _run_mode text default 'live'::text)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_primary public.financial_situations; v_supporting uuid[]:='{}'; v_action uuid; v_state text:='stable'; v_conf numeric:=0; v_snapshot uuid; v_quality jsonb; v_payload jsonb; v_narrative jsonb; v_counter jsonb; v_max int:=3; v_min numeric:=.60; v_suppressed uuid[]:='{}'; begin
 perform public.nino_diag_resolve_conflicts(_user_id,_run_mode); select max_supporting,min_primary_confidence into v_max,v_min from public.nino_diagnosis_config where singleton;
 select coalesce(array_agg(s),'{}') into v_suppressed from public.nino_diag_feedback_suppressed(_user_id) s;

 select * into v_primary from public.financial_situations s where s.user_id=_user_id and s.run_mode=_run_mode and s.status in ('active','confirmed','improving','worsening') and s.temporal_scope in ('now','future') and s.situation_type not in ('data_quality_issue','duplicate_review','shared_payment_confirmation','behavioral_pattern') and s.confidence>=v_min and (s.valid_until is null or s.valid_until>now()) and (s.severity='critical' or not (s.id = any(v_suppressed))) order by case s.severity when 'critical' then 4 when 'attention' then 3 when 'positive' then 2 else 1 end desc,s.relevance_score desc limit 1;
 if v_primary.id is not null then update public.financial_situations set narrative_role='primary',one_line_summary=coalesce(one_line_summary,headline) where id=v_primary.id; select id into v_action from public.financial_situation_actions where situation_id=v_primary.id and status in ('proposed','accepted','in_progress') order by priority desc limit 1; v_state:=case v_primary.severity when 'critical' then 'critical' when 'attention' then 'attention' when 'positive' then 'positive' else 'stable' end; v_conf:=v_primary.confidence; elsif not exists(select 1 from public.transactions where user_id=_user_id and status='confirmed') then v_state:='insufficient_data'; end if;
 select coalesce(array_agg(id order by role_order,relevance_score desc),'{}') into v_supporting from (select s.id,s.relevance_score,case s.narrative_role when 'counterpoint' then 1 else 2 end role_order from public.financial_situations s where s.user_id=_user_id and s.run_mode=_run_mode and s.id is distinct from v_primary.id and s.status in ('active','confirmed','improving','worsening') and s.temporal_scope in ('now','future') and s.situation_type not in ('data_quality_issue','duplicate_review','shared_payment_confirmation','behavioral_pattern') and (s.valid_until is null or s.valid_until>now()) and (s.severity='critical' or not (s.id = any(v_suppressed))) order by role_order,relevance_score desc limit v_max) q;
 select to_jsonb(s) into v_counter from public.financial_situations s where s.id=any(v_supporting) and s.narrative_role='counterpoint' order by s.relevance_score desc limit 1;
 v_narrative:=jsonb_build_object('conclusion',v_primary.headline,'cause',v_primary.cause_summary,'counterpoint',v_counter->>'one_line_summary','consequence',v_primary.consequence_summary,'forecast',v_primary.forecast_summary,'action',(select to_jsonb(a) from public.financial_situation_actions a where a.id=v_action));
 v_quality:=jsonb_build_object('uncategorized_count',coalesce((select (evaluation->>'uncategorized_count')::int from public.financial_situations where user_id=_user_id and run_mode=_run_mode and situation_type='data_quality_issue' order by updated_at desc limit 1),0));
 v_payload:=jsonb_build_object('narrative',v_narrative,'primary_situation',(select to_jsonb(s) from public.financial_situations s where s.id=v_primary.id),'primary_action',(select to_jsonb(a) from public.financial_situation_actions a where a.id=v_action),'supporting_situations',coalesce((select jsonb_agg(to_jsonb(s) order by array_position(v_supporting,s.id)) from public.financial_situations s where s.id=any(v_supporting)),'[]'));
 if _run_mode='live' then update public.nino_diagnosis_snapshots set is_current=false where user_id=_user_id and run_mode='live' and is_current; end if;
 insert into public.nino_diagnosis_snapshots(user_id,run_mode,as_of,overall_state,primary_situation_id,supporting_situation_ids,primary_action_id,forecast,data_quality,confidence,rationale,payload,contract_version,is_current) values(_user_id,_run_mode,_as_of,v_state,v_primary.id,v_supporting,v_action,jsonb_build_object('summary',v_primary.forecast_summary),v_quality,v_conf,jsonb_build_object('primary_score',v_primary.relevance_score,'supporting_roles',(select coalesce(jsonb_object_agg(id,narrative_role),'{}') from public.financial_situations where id=any(v_supporting)),'conflict_resolution','counterpoints_preserved','feedback_suppressed',coalesce(array_length(v_suppressed,1),0)),v_payload,'nino_diagnosis_contract.v1.1',_run_mode='live') returning id into v_snapshot; return v_snapshot; end $function$;

revoke all on function public.nino_diag_feedback_suppressed(uuid) from public;
grant execute on function public.nino_diag_feedback_suppressed(uuid) to service_role;