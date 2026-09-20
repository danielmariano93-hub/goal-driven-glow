-- Single authenticated read model for the behavioral dashboard.
-- Avoids multiple independent PostgREST reads leaving the UI in safe mode
-- when only one auxiliary source is temporarily unavailable.

begin;

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
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select jsonb_build_object(
    'server_now', now(),
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
        select *
          from public.behavioral_assessments
         where user_id = v_uid
         order by created_at desc
         limit 24
      ) x
    ), '[]'::jsonb),
    'experiments', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.started_at desc)
      from (
        select *
          from public.behavior_experiments
         where user_id = v_uid
         order by started_at desc
         limit 30
      ) x
    ), '[]'::jsonb),
    'templates', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at asc)
      from (
        select *
          from public.behavior_experiment_templates
         where active = true
         order by created_at asc
      ) x
    ), '[]'::jsonb),
    'hypotheses', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.updated_at desc)
      from (
        select id, kind, title, explanation, confidence, evidence, status, user_feedback,
               created_at, updated_at
          from public.behavior_hypotheses
         where user_id = v_uid
           and status in ('pending','confirmed','partial')
         order by updated_at desc
         limit 12
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
        'categorized', count(*) filter (where category_id is not null)::int
      )
        from public.transactions
       where user_id = v_uid
         and status = 'confirmed'
         and type::text = 'expense'
         and occurred_at >= now() - interval '90 days'
    ), jsonb_build_object('count', 0, 'categorized', 0))
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.behavioral_dashboard_snapshot() from public;
revoke all on function public.behavioral_dashboard_snapshot() from anon;
grant execute on function public.behavioral_dashboard_snapshot() to authenticated;

notify pgrst, 'reload schema';

commit;
