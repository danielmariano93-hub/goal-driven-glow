-- Leitura comportamental por usuário explícito (job semanal, service_role; o
-- usuário autenticado só lê o próprio uid). Substitui o helper que usava
-- set_config de claim JWT. Parâmetro: p_uid (o runtime chama com p_uid).
-- Status de lançamento: 'confirmed' (o enum só tem confirmed/planned/superseded).
drop function if exists public.behavioral_dashboard_snapshot_for_user(uuid);

create function public.behavioral_dashboard_snapshot_for_user(p_uid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := p_uid;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from v_uid then raise exception 'forbidden'; end if;

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

revoke all on function public.behavioral_dashboard_snapshot_for_user(uuid) from public, anon;
grant execute on function public.behavioral_dashboard_snapshot_for_user(uuid) to authenticated, service_role;
