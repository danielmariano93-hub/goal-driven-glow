-- Planejamento e Controle ficavam em "Base parcial" para sempre: o motor só contava ciclo de meta com
-- `closed_at`/`final_status`, mas desde `goal_history.v2` os ciclos nunca são "fechados" (o gasto é sempre
-- recalculado do livro). Agora um ciclo cujo mês já terminou conta como fechado, com o gasto calculado
-- do livro canônico (despesa confirmada, movimento comum, na categoria e no período do ciclo).
create or replace function public.behavioral_finished_cycles(p_uid uuid, p_as_of date default null)
returns table(start_date date, end_date date, target numeric, actual numeric, final_status text, closed_at timestamptz)
language sql stable security definer set search_path to 'public' as $fn$
  select c.start_date, c.end_date, c.target_snapshot::numeric, s.actual::numeric,
         coalesce(c.final_status, case when s.actual <= c.target_snapshot then 'met' else 'missed' end),
         coalesce(c.closed_at, (c.end_date + 1)::timestamptz)
    from public.category_spending_goal_cycles c
    cross join lateral (
      select coalesce(sum(t.amount), 0)::numeric(14,2) as actual
        from public.transactions t
       where t.user_id = c.user_id and t.category_id = c.category_id
         and t.status::text = 'confirmed' and t.type::text = 'expense'
         and coalesce(t.movement_kind::text, 'transaction') = 'transaction'
         and t.occurred_at::date between c.start_date and c.end_date
    ) s
   where c.user_id = p_uid and c.category_id is not null and c.target_snapshot > 0
     and c.end_date < coalesce(p_as_of + 1, (now() at time zone 'America/Sao_Paulo')::date)
   order by c.end_date desc
   limit 12;
$fn$;

-- behavioral_dashboard_snapshot() e behavioral_dashboard_snapshot_for_user(uuid): 'goal_cycles' passa a vir da função acima.
do $do$
declare d text; fn text;
begin
  foreach fn in array array['public.behavioral_dashboard_snapshot()','public.behavioral_dashboard_snapshot_for_user(uuid)'] loop
    d := pg_get_functiondef(fn::regprocedure);
    if d like '%behavioral_finished_cycles%' then continue; end if;
    d := regexp_replace(d, '''goal_cycles'',\s*coalesce\(\([\s\S]*?\), ''\[\]''::jsonb\),', '''goal_cycles'', coalesce((select jsonb_agg(jsonb_build_object(''start_date'', f.start_date, ''end_date'', f.end_date, ''target_snapshot'', f.target, ''actual_spend'', f.actual, ''projected_spend'', null, ''final_status'', f.final_status, ''closed_at'', f.closed_at) order by f.end_date desc) from public.behavioral_finished_cycles(v_uid) f), ''[]''::jsonb),');
    if d not like '%behavioral_finished_cycles%' then raise exception 'patch_not_applied for %', fn; end if;
    execute d;
  end loop;
  -- reconstrução semanal (Controle) com a mesma regra, para a data de cada semana
  d := pg_get_functiondef('public.behavior_observed_backfill_v2(uuid)'::regprocedure);
  if d not like '%behavioral_finished_cycles%' then
    d := regexp_replace(d, 'with cycles as \(\s*select target_snapshot::numeric as target,\s*actual_spend::numeric as actual\s*from public\.category_spending_goal_cycles[\s\S]*?limit 12\)', 'with cycles as (select f.target as target, f.actual as actual from public.behavioral_finished_cycles(v_uid, v_as_of) f)');
    if d not like '%behavioral_finished_cycles%' then raise exception 'patch_not_applied backfill'; end if;
    execute d;
  end if;
end $do$;

-- Semanas já reconstruídas ganham a dimensão Controle quando havia ciclo terminado até aquela semana.
do $do$
declare r record; v_cycles int; v_hits int; v_over numeric; v_score numeric;
begin
  for r in select id, user_id, week_start from public.behavior_observed_snapshots
            where methodology_version = 'behavior_observed.v2_backfill' and not (dimensions ? 'control') loop
    select count(*)::int, count(*) filter (where f.target > 0 and f.actual <= f.target)::int,
           avg(case when f.target > 0 then greatest(0, f.actual / f.target - 1) else 0 end)
      into v_cycles, v_hits, v_over
      from public.behavioral_finished_cycles(r.user_id, r.week_start + 6) f;
    if v_cycles > 0 then
      v_score := greatest(0, least(10, (v_hits::numeric / v_cycles) * 10.0 - least(4.0, coalesce(v_over, 0) * 10.0)));
      update public.behavior_observed_snapshots
         set dimensions = dimensions || jsonb_build_object('control', jsonb_build_object(
               'score', round(v_score, 1), 'confidence', case when v_cycles >= 3 then 'high' else 'medium' end,
               'factors', jsonb_build_array(jsonb_build_object('key','closed_cycles','label','Ciclos de meta fechados dentro do limite','value',round(v_score,1),'weight',0.55)))),
             coverage = coalesce(coverage, 0) + 1
       where id = r.id;
    end if;
  end loop;
end $do$;
