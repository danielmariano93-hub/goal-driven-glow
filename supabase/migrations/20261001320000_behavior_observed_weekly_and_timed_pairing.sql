-- Entrega 2 do Emocional — fechamento.
--
-- 1) Status de transactions: o enum do repositório é ('confirmed','planned',
--    'superseded') e todo o núcleo financeiro (insights/executive/load.ts)
--    filtra 'confirmed'. As funções do PR #161 passaram a filtrar 'posted',
--    que não existe no enum versionado: o backfill (status::text) casava zero
--    linhas e os experimentos (status igual a posted) falhariam no cast. Para não
--    depender de qual rótulo o ambiente tem, o subsistema comportamental compara
--    em texto contra os dois rótulos de "lançamento efetivado" — nunca inclui
--    'planned' nem 'superseded'.
-- 2) Dashboard comportamental entrega as transações de gasto brutas com campos
--    de horário para o pareamento emoção × gasto por janela.
-- 3) Job semanal server-side: lista de usuários ativos (service_role apenas) e
--    agendamento semanal da Edge Function behavior-observed-weekly.

create or replace function public.behavioral_dashboard_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select jsonb_build_object(
    'server_now', now(),
    'methodology_version', 'behavior_observed.v2',
    'emotion_spend_pairing', 'emotion_spend_pairing.v2',
    'checkins', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.occurred_at desc)
      from (
        select id, occurred_at, mood, emotion_key, declared_emotion_key, trigger_label,
               notes, transaction_id, financial_calm_score, financial_control_score,
               spending_urge_score, context_key
          from public.emotional_checkins
         where user_id = v_uid
           and occurred_at >= now() - interval '180 days'
         order by occurred_at desc
         limit 240
      ) x
    ), '[]'::jsonb),
    'assessments', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select * from public.behavioral_assessments
         where user_id = v_uid
         order by created_at desc
         limit 24
      ) x
    ), '[]'::jsonb),
    'experiments', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.started_at desc)
      from (
        select * from public.behavior_experiments
         where user_id = v_uid
         order by started_at desc
         limit 30
      ) x
    ), '[]'::jsonb),
    'templates', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at asc)
      from (
        select * from public.behavior_experiment_templates
         where active = true
         order by created_at asc
      ) x
    ), '[]'::jsonb),
    'hypotheses', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.updated_at desc)
      from (
        select distinct on (kind)
               id, kind, title, explanation, confidence, evidence, status, user_feedback,
               created_at, updated_at
          from public.behavior_hypotheses
         where user_id = v_uid
           and status in ('pending','confirmed','partial')
         order by kind, updated_at desc
      ) x
    ), '[]'::jsonb),
    'financial_snapshot', coalesce((
      select to_jsonb(x)
      from (
        select payload, as_of_date, computed_at, available_balance
          from public.financial_current_snapshots
         where user_id = v_uid
         order by computed_at desc nulls last
         limit 1
      ) x
    ), 'null'::jsonb),
    'transaction_stats', coalesce((
      select jsonb_build_object(
        'count', count(*)::int,
        'categorized', count(*) filter (where category_id is not null)::int,
        'active_days', count(distinct coalesce(behavioral_day, occurred_at::date))::int,
        'first_at', min(occurred_at),
        'last_at', max(occurred_at)
      )
        from public.transactions
       where user_id = v_uid
         and status::text = 'confirmed'
         and type::text = 'expense'
         and coalesce(movement_kind::text,'transaction') = 'transaction'
         and occurred_at >= now() - interval '90 days'
    ), jsonb_build_object('count',0,'categorized',0,'active_days',0)),
    'expense_days', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.day asc)
      from (
        select coalesce(behavioral_day, occurred_at::date)::date as day,
               round(sum(amount)::numeric,2) as amount,
               count(*)::int as tx_count
          from public.transactions
         where user_id = v_uid
           and status::text = 'confirmed'
           and type::text = 'expense'
           and coalesce(movement_kind::text,'transaction') = 'transaction'
           and occurred_at >= now() - interval '180 days'
         group by 1
         order by 1
      ) x
    ), '[]'::jsonb),
    -- Gastos brutos com campos de horário para o pareamento por janela
    -- (`emotion_spend_pairing.v2`). O instante é derivado no motor canônico
    -- (expenseInstant); aqui só sai a evidência crua, sem regra duplicada.
    'expense_transactions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.occurred_at asc, x.id asc)
      from (
        select id, amount, occurred_at, local_occurred_at, occurred_at_time, created_at, origin::text as origin
          from public.transactions
         where user_id = v_uid
           and status::text = 'confirmed'
           and type::text = 'expense'
           and coalesce(movement_kind::text,'transaction') = 'transaction'
           and occurred_at >= (now() - interval '180 days')::date
           and (local_occurred_at is not null
                or occurred_at_time is not null
                or origin::text in ('manual','agent','split'))
         order by occurred_at desc, id desc
         limit 4000
      ) x
    ), '[]'::jsonb),
    'app_activity', coalesce((
      select jsonb_build_object(
        'active_days_30', count(*)::int,
        'total_views_30', coalesce(sum(total_views),0)::int,
        'financial_views_30', coalesce(sum(home_views+movements_views+planning_views+reports_views+goals_views+investments_views+debts_views),0)::int,
        'movement_views_30', coalesce(sum(movements_views),0)::int,
        'planning_views_30', coalesce(sum(planning_views+goals_views),0)::int,
        'first_day', min(day),
        'last_day', max(day)
      )
        from public.behavioral_app_activity_daily
       where user_id=v_uid and day >= (now() at time zone 'America/Sao_Paulo')::date - 29
    ), jsonb_build_object('active_days_30',0,'total_views_30',0,'financial_views_30',0,'movement_views_30',0,'planning_views_30',0)),
    'goal_cycles', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.end_date desc)
      from (
        select start_date,end_date,target_snapshot,actual_spend,projected_spend,final_status,closed_at
          from public.category_spending_goal_cycles
         where user_id=v_uid and closed_at is not null
         order by end_date desc
         limit 12
      ) x
    ), '[]'::jsonb),
    'planning_stats', jsonb_build_object(
      'active_recurring_rules', (select count(*)::int from public.recurring_rules where user_id=v_uid and status::text='active'),
      'active_category_goals', (select count(*)::int from public.category_spending_goals where user_id=v_uid and status='active')
    ),
    'investment_stats', jsonb_build_object(
      'current_value', coalesce((select sum(current_value) from public.investments where user_id=v_uid),0),
      'emergency_reserve_value', coalesce((select sum(current_value) from public.investments where user_id=v_uid and reserve_role='emergency_reserve'),0),
      'contributions_90d', coalesce((select sum(amount) from public.investment_movements where user_id=v_uid and kind in ('application','deposit','contribution') and occurred_at >= current_date-89),0),
      'contribution_days_90d', coalesce((select count(distinct occurred_at)::int from public.investment_movements where user_id=v_uid and kind in ('application','deposit','contribution') and occurred_at >= current_date-89),0)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.behavioral_dashboard_snapshot() from public, anon;
grant execute on function public.behavioral_dashboard_snapshot() to authenticated;

create or replace function public.behavior_experiment_start(p_template_slug text)
returns public.behavior_experiments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tpl public.behavior_experiment_templates;
  v_existing public.behavior_experiments;
  v_row public.behavior_experiments;
  v_baseline numeric;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_tpl from public.behavior_experiment_templates where slug = p_template_slug and active = true;
  if v_tpl.slug is null then raise exception 'template_not_found'; end if;
  select * into v_existing
    from public.behavior_experiments
   where user_id = v_uid and template_slug = p_template_slug and status = 'active'
   limit 1;
  if v_existing.id is not null then return v_existing; end if;

  if v_tpl.tracking_kind = 'spend_reduction_pct' then
    select coalesce(sum(t.amount), 0) / greatest(1, v_tpl.duration_days)::numeric
      into v_baseline
      from public.transactions t
     where t.user_id = v_uid
       and t.status::text = 'confirmed'
       and t.type::text = 'expense'
       and coalesce(t.movement_kind, 'transaction') = 'transaction'
       and coalesce(t.behavioral_day, t.occurred_at::date) >= current_date - v_tpl.duration_days
       and coalesce(t.behavioral_day, t.occurred_at::date) < current_date;
  end if;

  insert into public.behavior_experiments(
    user_id, template_slug, title, dimension, tracking_kind, target_value,
    baseline_value, ends_at, metadata
  ) values (
    v_uid, v_tpl.slug, v_tpl.title, v_tpl.dimension, v_tpl.tracking_kind,
    v_tpl.target_value, v_baseline, now() + make_interval(days => v_tpl.duration_days),
    jsonb_build_object('xp_reward', v_tpl.xp_reward, 'config', v_tpl.config, 'version', 'behavior_experiment.v1')
  ) returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.behavior_experiment_start(text) to authenticated;

create or replace function public.behavior_experiment_refresh(p_experiment_id uuid)
returns public.behavior_experiments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := auth.role();
  v_exp public.behavior_experiments;
  v_current numeric := 0;
  v_progress numeric := 0;
  v_elapsed_days numeric := 1;
  v_baseline numeric := 0;
  v_was_completed boolean := false;
begin
  select * into v_exp from public.behavior_experiments where id = p_experiment_id;
  if v_exp.id is null then raise exception 'experiment_not_found'; end if;
  if v_role <> 'service_role' and (v_uid is null or v_exp.user_id <> v_uid) then raise exception 'forbidden'; end if;
  if v_exp.status <> 'active' then return v_exp; end if;

  if now() > v_exp.ends_at then
    update public.behavior_experiments
       set status = 'expired', updated_at = now()
     where id = v_exp.id
     returning * into v_exp;
    return v_exp;
  end if;

  if v_exp.tracking_kind = 'checkin_count' then
    select count(distinct (occurred_at at time zone 'America/Sao_Paulo')::date)::numeric
      into v_current
      from public.emotional_checkins
     where user_id = v_exp.user_id
       and occurred_at >= v_exp.started_at
       and occurred_at <= now();

  elsif v_exp.tracking_kind = 'no_spend_days' then
    select count(*)::numeric
      into v_current
      from generate_series(
        v_exp.started_at::date,
        least(current_date - 1, v_exp.ends_at::date),
        interval '1 day'
      ) d(day)
     where not exists (
       select 1
         from public.transactions t
        where t.user_id = v_exp.user_id
          and t.status::text = 'confirmed'
          and t.type::text = 'expense'
          and coalesce(t.movement_kind, 'transaction') = 'transaction'
          and coalesce(t.behavioral_day, t.occurred_at::date) = d.day::date
     );

  elsif v_exp.tracking_kind = 'spend_reduction_pct' then
    v_baseline := coalesce(v_exp.baseline_value, 0);
    v_elapsed_days := greatest(
      1,
      (least(current_date, v_exp.ends_at::date) - v_exp.started_at::date + 1)::numeric
    );

    if v_baseline > 0 then
      select greatest(
        -100,
        least(
          100,
          (v_baseline - (coalesce(sum(t.amount), 0) / v_elapsed_days)) / v_baseline * 100
        )
      )
        into v_current
        from public.transactions t
       where t.user_id = v_exp.user_id
         and t.status::text = 'confirmed'
         and t.type::text = 'expense'
         and coalesce(t.movement_kind, 'transaction') = 'transaction'
         and coalesce(t.behavioral_day, t.occurred_at::date) >= v_exp.started_at::date
         and coalesce(t.behavioral_day, t.occurred_at::date) <= least(current_date, v_exp.ends_at::date);
    else
      v_current := 0;
    end if;

  else
    select coalesce(sum(value), 0)
      into v_current
      from public.behavior_experiment_events
     where experiment_id = v_exp.id
       and occurred_at >= v_exp.started_at;
  end if;

  v_progress := greatest(
    0,
    least(100, case when v_exp.target_value > 0 then (v_current / v_exp.target_value) * 100 else 0 end)
  );
  v_was_completed := v_progress >= 100;

  update public.behavior_experiments
     set current_value = round(v_current, 2),
         progress = round(v_progress, 2),
         status = case when v_was_completed then 'completed' else status end,
         completed_at = case when v_was_completed then coalesce(completed_at, now()) else completed_at end,
         result_value = case when v_was_completed then round(v_current, 2) else result_value end,
         result_delta_pct = case
           when v_was_completed and v_exp.tracking_kind = 'spend_reduction_pct' then round(v_current, 2)
           when v_was_completed and coalesce(v_exp.baseline_value, 0) <> 0
             then round((v_current - v_exp.baseline_value) / abs(v_exp.baseline_value) * 100, 2)
           else result_delta_pct
         end,
         updated_at = now()
   where id = v_exp.id
   returning * into v_exp;

  return v_exp;
end;
$$;

grant execute on function public.behavior_experiment_refresh(uuid) to authenticated, service_role;


create or replace function public.behavior_observed_backfill_v2(
  p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_first date;
  v_last date := (date_trunc('week', now() at time zone 'America/Sao_Paulo'))::date - 7;
  v_week date;
  v_as_of date;
  v_dimensions jsonb;
  v_coverage int;
  v_inserted int := 0;

  v_count int;
  v_direct_count int;
  v_legacy_count int;
  v_direct_avg numeric;
  v_legacy_avg numeric;
  v_score numeric;
  v_conf text;

  v_cycles int;
  v_hits int;
  v_overshoot numeric;

  v_contribution_days int;
  v_contributions numeric;
  v_income_90 numeric;
  v_regularity numeric;
  v_contribution_rate numeric;

  v_debt_original numeric;
  v_debt_paid numeric;
  v_debt_reduction numeric;
  v_debt_first date;
begin
  -- Usuário autenticado só reconstrói o próprio histórico; job/migração usam service_role/owner.
  if auth.role() = 'authenticated' and v_uid is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if auth.role() <> 'service_role' and auth.uid() is distinct from v_uid then
    raise exception 'forbidden';
  end if;

  select min(d) into v_first
  from (
    select min(occurred_at::date) as d from public.emotional_checkins where user_id = v_uid
    union all
    select min(start_date) from public.category_spending_goal_cycles where user_id = v_uid
    union all
    select min(coalesce(start_date, created_at::date)) from public.debts where user_id = v_uid
    union all
    select min(occurred_at) from public.investment_movements where user_id = v_uid and kind = 'aporte'
  ) evidence
  where d is not null;

  if v_first is null or v_first > v_last then
    return jsonb_build_object('inserted', 0, 'from', v_first, 'to', v_last);
  end if;

  v_week := date_trunc('week', v_first)::date;

  while v_week <= v_last loop
    v_as_of := v_week + 6;
    v_dimensions := '{}'::jsonb;
    v_coverage := 0;

    -- Consciência histórica: somente check-ins. A instrumentação de uso do app
    -- não existia no passado, então a confiança permanece baixa e a nota é
    -- limitada a 6,5, igual ao teto do motor atual quando há uma única fonte.
    select count(*)::int into v_count
    from public.emotional_checkins
    where user_id = v_uid
      and occurred_at::date between v_as_of - 29 and v_as_of;

    if v_count > 0 then
      v_score := least(6.5, least(10.0, (v_count::numeric / 8.0) * 10.0));
      v_dimensions := v_dimensions || jsonb_build_object(
        'awareness', jsonb_build_object(
          'score', round(v_score, 1),
          'confidence', 'low',
          'factors', jsonb_build_array(jsonb_build_object(
            'key', 'checkins', 'label', 'Check-ins no mês',
            'value', round(least(10.0, (v_count::numeric / 8.0) * 10.0), 1), 'weight', 0.25
          ))
        )
      );
      v_coverage := v_coverage + 1;
    end if;

    -- Tranquilidade: a escala direta tem prioridade; registros legados entram
    -- somente como estimativa, reproduzindo a regra do motor behavior_observed.v2.
    select
      count(*) filter (where financial_calm_score is not null)::int,
      count(*) filter (where financial_calm_score is null)::int,
      avg(financial_calm_score::numeric) filter (where financial_calm_score is not null),
      avg((greatest(0, least(10, mood::int * 2)))::numeric) filter (where financial_calm_score is null)
    into v_direct_count, v_legacy_count, v_direct_avg, v_legacy_avg
    from public.emotional_checkins
    where user_id = v_uid
      and occurred_at::date between v_as_of - 29 and v_as_of;

    if v_direct_count + v_legacy_count > 0 then
      if v_direct_avg is not null then
        if v_direct_count >= 3 or v_legacy_avg is null then
          v_score := v_direct_avg;
        else
          v_score := (v_direct_avg * 0.7 + v_legacy_avg * 0.3);
        end if;
      else
        v_score := v_legacy_avg;
      end if;
      v_conf := case when v_direct_count >= 10 then 'high' when v_direct_count >= 4 then 'medium' else 'low' end;
      v_dimensions := v_dimensions || jsonb_build_object(
        'calm', jsonb_build_object(
          'score', round(v_score, 1),
          'confidence', v_conf,
          'factors', jsonb_build_array(
            jsonb_build_object('key','direct','label','Tranquilidade informada nos check-ins','value',case when v_direct_avg is null then null else round(v_direct_avg,1) end,'weight',case when v_direct_count >= 3 then 1.0 else 0.7 end),
            jsonb_build_object('key','legacy','label','Check-ins antigos (estimativa)','value',case when v_legacy_avg is null then null else round(v_legacy_avg,1) end,'weight',case when v_direct_count >= 3 then 0.0 else 0.3 end)
          )
        )
      );
      v_coverage := v_coverage + 1;
    end if;

    -- Controle: só ciclos de meta que já estavam encerrados naquele momento.
    with cycles as (
      select target_snapshot::numeric as target, actual_spend::numeric as actual
      from public.category_spending_goal_cycles
      where user_id = v_uid
        and closed_at is not null
        and closed_at::date <= v_as_of
      order by end_date desc
      limit 12
    )
    select
      count(*)::int,
      count(*) filter (where target > 0 and actual <= target)::int,
      avg(case when target > 0 then greatest(0, actual / target - 1) else 0 end)
    into v_cycles, v_hits, v_overshoot
    from cycles;

    if v_cycles > 0 then
      v_score := greatest(0, least(10,
        (v_hits::numeric / v_cycles::numeric) * 10.0 - least(4.0, coalesce(v_overshoot,0) * 10.0)
      ));
      v_conf := case when v_cycles >= 3 then 'high' else 'medium' end;
      v_dimensions := v_dimensions || jsonb_build_object(
        'control', jsonb_build_object(
          'score', round(v_score, 1),
          'confidence', v_conf,
          'factors', jsonb_build_array(jsonb_build_object(
            'key','closed_cycles','label','Ciclos de meta fechados dentro do limite','value',round(v_score,1),'weight',0.55
          ))
        )
      );
      v_coverage := v_coverage + 1;
    end if;

    -- Patrimônio: somente aportes explicitamente classificados como "aporte".
    -- "compra" pode ser rebalanceamento/reinvestimento e não prova capital novo.
    -- Não usa valor atual do investimento para não vazar informação futura.
    select
      count(distinct occurred_at)::int,
      coalesce(sum(amount),0)::numeric
    into v_contribution_days, v_contributions
    from public.investment_movements
    where user_id = v_uid
      and kind = 'aporte'
      and occurred_at between v_as_of - 89 and v_as_of;

    select coalesce(sum(amount),0)::numeric into v_income_90
    from public.transactions
    where user_id = v_uid
      and status::text = 'confirmed'
      and type::text = 'income'
      and occurred_at between v_as_of - 89 and v_as_of;

    if v_contribution_days > 0 then
      v_regularity := least(10.0, (v_contribution_days::numeric / 6.0) * 10.0);
      v_contribution_rate := case when v_income_90 > 0
        then least(10.0, (v_contributions / v_income_90) * 50.0)
        else null end;
      v_score := case when v_contribution_rate is null
        then v_regularity
        else (v_regularity * 0.45 + v_contribution_rate * 0.30) / 0.75 end;
      v_conf := case when v_contribution_days >= 4 then 'high' when v_contribution_days >= 2 then 'medium' else 'low' end;
      v_dimensions := v_dimensions || jsonb_build_object(
        'wealth', jsonb_build_object(
          'score', round(v_score,1),
          'confidence', v_conf,
          'factors', jsonb_build_array(
            jsonb_build_object('key','contribution_days','label','Regularidade dos aportes (90d)','value',round(v_regularity,1),'weight',0.45),
            jsonb_build_object('key','contribution_rate','label','Aportes sobre a renda','value',case when v_contribution_rate is null then null else round(v_contribution_rate,1) end,'weight',0.30)
          )
        )
      );
      v_coverage := v_coverage + 1;
    end if;

    -- Dívidas: principal inicial conhecido menos pagamentos registrados até a
    -- data. Não reconstrói peso sobre ativos porque o patrimônio histórico não é
    -- confiável. A nota é, portanto, parcial e nunca ganha confiança alta.
    select
      coalesce(sum(initial_amount),0)::numeric,
      min(coalesce(start_date, created_at::date))
    into v_debt_original, v_debt_first
    from public.debts
    where user_id = v_uid
      and coalesce(start_date, created_at::date) <= v_as_of;

    select coalesce(sum(amount),0)::numeric into v_debt_paid
    from public.debt_payments
    where user_id = v_uid
      and paid_at::date <= v_as_of;

    if v_debt_original > 0 then
      v_debt_reduction := greatest(0, least(1, v_debt_paid / v_debt_original));
      v_score := greatest(0, least(10, 5.0 + v_debt_reduction * 15.0));
      v_conf := case when v_debt_first is not null and (v_as_of - v_debt_first) >= 20 then 'medium' else 'low' end;
      v_dimensions := v_dimensions || jsonb_build_object(
        'debt', jsonb_build_object(
          'score', round(v_score,1),
          'confidence', v_conf,
          'factors', jsonb_build_array(jsonb_build_object(
            'key','reduction','label','Redução do saldo devedor','value',round(v_score,1),'weight',null
          ))
        )
      );
      v_coverage := v_coverage + 1;
    end if;

    if v_coverage > 0 then
      insert into public.behavior_observed_snapshots(
        user_id, week_start, overall_score, coverage, confidence,
        methodology_version, dimensions, created_at, updated_at
      ) values (
        v_uid, v_week, null, v_coverage, 'low',
        'behavior_observed.v2_backfill', v_dimensions,
        (v_as_of::timestamp at time zone 'America/Sao_Paulo'),
        (v_as_of::timestamp at time zone 'America/Sao_Paulo')
      )
      on conflict (user_id, week_start) do nothing;
      if found then v_inserted := v_inserted + 1; end if;
    end if;

    v_week := v_week + 7;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'from', v_first, 'to', v_last, 'methodology_version', 'behavior_observed.v2_backfill');
end;
$$;

revoke all on function public.behavior_observed_backfill_v2(uuid) from public, anon;
grant execute on function public.behavior_observed_backfill_v2(uuid) to authenticated, service_role;

-- Privilégios explícitos do histórico semanal (RLS por usuário inalterada).
grant select, insert, update on public.behavior_observed_snapshots to authenticated;
grant all on public.behavior_observed_snapshots to service_role;

-- Usuários ativos para o snapshot semanal. Só service_role; nenhuma RLS muda.
create or replace function public.behavior_observed_active_users(
  p_since_days int default 45,
  p_after uuid default null,
  p_limit int default 500
)
returns table(user_id uuid)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
  select u.id
    from auth.users u
   where (p_after is null or u.id > p_after)
     and (
       exists (select 1 from public.transactions t
                where t.user_id = u.id
                  and t.created_at >= now() - make_interval(days => greatest(1, p_since_days)))
       or exists (select 1 from public.emotional_checkins c
                where c.user_id = u.id
                  and c.occurred_at >= now() - make_interval(days => greatest(1, p_since_days)))
       or exists (select 1 from public.behavioral_app_activity_daily a
                where a.user_id = u.id
                  and a.day >= current_date - greatest(1, p_since_days))
     )
   order by u.id
   limit least(2000, greatest(1, coalesce(p_limit, 500)));
end;
$$;
revoke all on function public.behavior_observed_active_users(int, uuid, int) from public, anon, authenticated;
grant execute on function public.behavior_observed_active_users(int, uuid, int) to service_role;

-- Disparo semanal (segunda 06:30 em São Paulo = 09:30 UTC). Segredo lido do
-- vault no momento do disparo, no mesmo padrão dos relatórios agendados.
create or replace function public.behavior_observed_weekly_tick()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  secret_value text;
  request_id bigint;
begin
  select decrypted_secret into secret_value
    from vault.decrypted_secrets
   where name in ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
   order by case name when 'INTERNAL_CRON_SECRET' then 0 when 'meunino_cron_secret' then 1 else 2 end,
            created_at desc
   limit 1;
  if nullif(secret_value, '') is null then
    raise exception 'cron_secret_missing';
  end if;
  select net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/behavior-observed-weekly',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', secret_value),
    body := jsonb_build_object('source','weekly_cron')
  ) into request_id;
  return request_id;
end;
$function$;
revoke all on function public.behavior_observed_weekly_tick() from public, anon, authenticated;
grant execute on function public.behavior_observed_weekly_tick() to service_role;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'behavior-observed-weekly') then
    perform cron.unschedule('behavior-observed-weekly');
  end if;
  perform cron.schedule(
    'behavior-observed-weekly',
    '30 9 * * 1',
    'select public.behavior_observed_weekly_tick();'
  );
end;
$do$;

notify pgrst, 'reload schema';
