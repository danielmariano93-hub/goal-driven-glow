-- behavior_observed.v2
-- Adds first-party usage signals, reserve classification, and a richer canonical
-- behavioral dashboard snapshot. Scores remain explainable and confidence-aware.

begin;

create table if not exists public.behavioral_app_activity_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  total_views integer not null default 0 check (total_views >= 0),
  home_views integer not null default 0 check (home_views >= 0),
  movements_views integer not null default 0 check (movements_views >= 0),
  planning_views integer not null default 0 check (planning_views >= 0),
  reports_views integer not null default 0 check (reports_views >= 0),
  goals_views integer not null default 0 check (goals_views >= 0),
  investments_views integer not null default 0 check (investments_views >= 0),
  debts_views integer not null default 0 check (debts_views >= 0),
  nino_views integer not null default 0 check (nino_views >= 0),
  emotions_views integer not null default 0 check (emotions_views >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.behavioral_app_activity_daily enable row level security;

drop policy if exists behavioral_app_activity_select_own on public.behavioral_app_activity_daily;
create policy behavioral_app_activity_select_own
  on public.behavioral_app_activity_daily
  for select to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.behavioral_app_activity_daily from public, anon, authenticated;
grant select on public.behavioral_app_activity_daily to authenticated;
grant all on public.behavioral_app_activity_daily to service_role;

alter table public.investments
  add column if not exists reserve_role text not null default 'unspecified';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'investments_reserve_role_check'
  ) then
    alter table public.investments
      add constraint investments_reserve_role_check
      check (reserve_role in ('unspecified','emergency_reserve','long_term'));
  end if;
end $$;

create or replace function public.behavioral_record_app_activity(p_surface text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_surface text := lower(coalesce(p_surface, 'other'));
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_surface not in ('home','movements','planning','reports','goals','investments','debts','nino','emotions','other') then
    v_surface := 'other';
  end if;

  insert into public.behavioral_app_activity_daily(user_id, day, total_views, first_seen_at, last_seen_at)
  values (v_uid, v_day, 1, now(), now())
  on conflict (user_id, day) do update set
    total_views = public.behavioral_app_activity_daily.total_views + 1,
    last_seen_at = now();

  update public.behavioral_app_activity_daily
     set home_views = home_views + case when v_surface='home' then 1 else 0 end,
         movements_views = movements_views + case when v_surface='movements' then 1 else 0 end,
         planning_views = planning_views + case when v_surface='planning' then 1 else 0 end,
         reports_views = reports_views + case when v_surface='reports' then 1 else 0 end,
         goals_views = goals_views + case when v_surface='goals' then 1 else 0 end,
         investments_views = investments_views + case when v_surface='investments' then 1 else 0 end,
         debts_views = debts_views + case when v_surface='debts' then 1 else 0 end,
         nino_views = nino_views + case when v_surface='nino' then 1 else 0 end,
         emotions_views = emotions_views + case when v_surface='emotions' then 1 else 0 end
   where user_id=v_uid and day=v_day;
end;
$$;

revoke all on function public.behavioral_record_app_activity(text) from public, anon;
grant execute on function public.behavioral_record_app_activity(text) to authenticated;

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
         and status = 'confirmed'
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
           and status = 'confirmed'
           and type::text = 'expense'
           and coalesce(movement_kind::text,'transaction') = 'transaction'
           and occurred_at >= now() - interval '180 days'
         group by 1
         order by 1
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

notify pgrst, 'reload schema';
commit;
