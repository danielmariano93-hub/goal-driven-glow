-- Entrega 2 do redesign Emocional: reconstrói apenas o passado que existe de
-- forma observável. Não inventa uso do app, planejamento, consistência ou
-- segurança antes de esses sinais terem sido instrumentados.
--
-- methodology_version distinto evita tratar a reconstrução parcial como a mesma
-- coisa que uma leitura completa feita em tempo real.

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
    select min(occurred_at) from public.investment_movements where user_id = v_uid
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
    -- limitada a 6,5, igual ao teto do motor atual quando não há uso observado.
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

    -- Patrimônio: somente aportes já registrados até a semana. Não usa o valor
    -- atual do investimento para não vazar informação futura para o passado.
    select
      count(distinct occurred_at)::int,
      coalesce(sum(amount),0)::numeric
    into v_contribution_days, v_contributions
    from public.investment_movements
    where user_id = v_uid
      and kind in ('application','deposit','contribution')
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

    -- Dívidas: principal conhecido menos pagamentos aplicados até a data. Não
    -- reconstrói peso sobre ativos porque o patrimônio histórico não é confiável.
    select
      coalesce(sum(coalesce(principal_amount, original_amount, 0)),0)::numeric,
      min(coalesce(start_date, created_at::date))
    into v_debt_original, v_debt_first
    from public.debts
    where user_id = v_uid
      and coalesce(start_date, created_at::date) <= v_as_of;

    select coalesce(sum(coalesce(amount_applied, amount, 0)),0)::numeric into v_debt_paid
    from public.debt_payments
    where user_id = v_uid and paid_at <= v_as_of;

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

-- Helper interno para o job semanal reutilizar exatamente o RPC que alimenta a
-- tela, sem duplicar a coleta de dados. Apenas service_role pode escolher uid.
create or replace function public.behavioral_dashboard_snapshot_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  v_result := public.behavioral_dashboard_snapshot();
  perform set_config('request.jwt.claim.sub', coalesce(v_previous_sub,''), true);
  return v_result;
end;
$$;
revoke all on function public.behavioral_dashboard_snapshot_for_user(uuid) from public, anon, authenticated;
grant execute on function public.behavioral_dashboard_snapshot_for_user(uuid) to service_role;

-- Preenche uma única vez o histórico reconstruível dos usuários existentes.
do $$
declare r record;
begin
  for r in select id from auth.users loop
    perform public.behavior_observed_backfill_v2(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
