-- O schema canônico de transactions usa status='posted'. As funções de
-- experimentos ainda filtravam o valor legado 'confirmed', que compila mas
-- falha em runtime por ser enum inválido. Mantém toda a matemática original e
-- corrige apenas a fonte de verdade do status.

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
       and t.status = 'posted'
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
          and t.status = 'posted'
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
         and t.status = 'posted'
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

notify pgrst, 'reload schema';
