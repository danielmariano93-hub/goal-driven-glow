-- behavioral_evolution.v1.1 — harden experiment math + safe proactive hooks.
-- Proactivity is generated only from explicit user-declared signals or
-- completed experiments. Statistical hypotheses remain confirmation-first.

begin;

-- The dedicated kind introduced in the first migration is intentionally not
-- used: existing behavioral kinds already carry the correct preference gates,
-- attention budget and narrative policy. Keeping a second unused kind would
-- create policy drift.
delete from public.communication_catalog where kind = 'behavior_coach_highlight';

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
          and t.status = 'confirmed'
          and t.type::text = 'expense'
          and coalesce(t.movement_kind, 'transaction') = 'transaction'
          and coalesce(t.behavioral_day, t.occurred_at) = d.day::date
     );

  elsif v_exp.tracking_kind = 'spend_reduction_pct' then
    -- Baseline is frozen when the experiment starts. Current spend is divided
    -- by whole calendar days elapsed so the first hours of day 1 cannot create
    -- a fake 90% reduction (or acceleration).
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
         and t.status = 'confirmed'
         and t.type::text = 'expense'
         and coalesce(t.movement_kind, 'transaction') = 'transaction'
         and coalesce(t.behavioral_day, t.occurred_at) >= v_exp.started_at::date
         and coalesce(t.behavioral_day, t.occurred_at) <= least(current_date, v_exp.ends_at::date);
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

-- Explicit moment signal: a user has just said both "money feels heavy" and
-- "urge to spend is very high". Queue a gentle pause suggestion through the
-- normal dispatcher. It is not a diagnosis and it does not bypass opt-outs,
-- quiet hours or attention caps because it reuses the existing
-- `emotional_spending` behavioral communication contract.
create or replace function public.queue_declared_money_mood_highlight()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_key text;
begin
  if new.financial_calm_score is null or new.spending_urge_score is null then
    return new;
  end if;
  if new.financial_calm_score > 4 or new.spending_urge_score < 8 then
    return new;
  end if;

  v_day := (new.occurred_at at time zone 'America/Sao_Paulo')::date;
  v_key := 'declared-money-mood:' || new.user_id::text || ':' || v_day::text;

  insert into public.pending_proactive_suggestions(
    user_id, kind, severity, title, body, action, evidence, channel_ready,
    dedup_key, logical_dedup_key, status, expires_at, next_attempt_at
  ) values (
    new.user_id,
    'emotional_spending',
    'attention',
    'Talvez valha criar uma pequena pausa hoje',
    'Você marcou pouca tranquilidade com dinheiro e uma vontade alta de gastar. Se aparecer uma compra não planejada, teste uma pausa curta antes de decidir — sem proibição e sem culpa.',
    jsonb_build_object('type','behavior_coach','route','/app/emocoes#experimentos'),
    jsonb_build_object(
      'source','declared_money_mood',
      'financial_calm_score',new.financial_calm_score,
      'financial_control_score',new.financial_control_score,
      'spending_urge_score',new.spending_urge_score,
      'context_key',new.context_key,
      'measurement_version',new.measurement_version,
      'non_diagnostic',true,
      'priority_score',68
    ),
    'both', v_key, v_key, 'pending', now() + interval '12 hours', now()
  )
  on conflict (user_id, dedup_key) do update
     set evidence = excluded.evidence,
         body = excluded.body,
         action = excluded.action,
         expires_at = excluded.expires_at,
         next_attempt_at = least(public.pending_proactive_suggestions.next_attempt_at, excluded.next_attempt_at)
   where public.pending_proactive_suggestions.status in ('pending','deferred','expired');

  return new;
end;
$$;

drop trigger if exists trg_declared_money_mood_highlight on public.emotional_checkins;
create trigger trg_declared_money_mood_highlight
after insert or update of financial_calm_score, financial_control_score, spending_urge_score, context_key
on public.emotional_checkins
for each row execute function public.queue_declared_money_mood_highlight();

-- A completed experiment is objective product evidence. Queue recognition via
-- the existing `financial_discipline` behavior kind so the same communication
-- policy, consent and cooldown rules continue to apply.
create or replace function public.queue_behavior_experiment_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if new.status <> 'completed' or old.status = 'completed' then return new; end if;
  v_key := 'behavior-experiment-complete:' || new.id::text;

  insert into public.pending_proactive_suggestions(
    user_id, kind, severity, title, body, action, evidence, channel_ready,
    dedup_key, logical_dedup_key, status, expires_at, next_attempt_at
  ) values (
    new.user_id,
    'financial_discipline',
    'info',
    'Seu experimento terminou',
    new.title || ' chegou ao fim. Veja o resultado e compare o antes e depois antes de decidir se esse hábito merece continuar.',
    jsonb_build_object('type','review_experiment','route','/app/emocoes#experimentos'),
    jsonb_build_object(
      'source','behavior_experiment',
      'experiment_id',new.id,
      'template_slug',new.template_slug,
      'dimension',new.dimension,
      'progress',new.progress,
      'result_value',new.result_value,
      'result_delta_pct',new.result_delta_pct,
      'priority_score',55
    ),
    'both', v_key, v_key, 'pending', now() + interval '7 days', now()
  ) on conflict (user_id, dedup_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_behavior_experiment_completion on public.behavior_experiments;
create trigger trg_behavior_experiment_completion
after update of status on public.behavior_experiments
for each row execute function public.queue_behavior_experiment_completion();

notify pgrst, 'reload schema';
commit;