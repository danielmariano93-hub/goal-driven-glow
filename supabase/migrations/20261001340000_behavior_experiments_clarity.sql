-- Experimentos mais claros: o Nino detecta sozinho o que dá para detectar,
-- o usuário pode vincular um lançamento real como prova, e cada contagem
-- guarda a evidência (de onde veio). Status de lançamento: 'confirmed'.

alter table public.behavior_experiment_events
  add column if not exists source text not null default 'manual',
  add column if not exists ref_type text,
  add column if not exists ref_key text,
  add column if not exists label text;

create unique index if not exists behavior_experiment_events_ref_uidx
  on public.behavior_experiment_events (experiment_id, ref_type, ref_key)
  where ref_key is not null;

-- Textos explicativos dos modelos vivem no código (src/lib/behavioral/experimentCopy.ts, por slug).

-- Detecta e grava evidências automáticas (idempotente) e recalcula o experimento.
create or replace function public.behavior_experiment_sync_auto(p_experiment_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp public.behavior_experiments;
  v_added int := 0;
  v_n int;
  k int;
  v_ws date;
begin
  select * into v_exp from public.behavior_experiments where id = p_experiment_id;
  if v_exp.id is null or v_exp.status <> 'active' then return 0; end if;

  if v_exp.template_slug = 'small-wealth-moves' then
    insert into public.behavior_experiment_events(experiment_id, user_id, value, source, ref_type, ref_key, label, note)
    select v_exp.id, v_exp.user_id, 1, 'auto', 'transaction', t.id::text, 'Aporte em investimento',
           left(coalesce(nullif(t.friendly_description,''), t.description, 'Aporte'), 120)
      from public.transactions t
     where t.user_id = v_exp.user_id
       and t.status::text = 'confirmed'
       and t.movement_kind::text = 'investment_application'
       and t.occurred_at::date >= v_exp.started_at::date
       and t.occurred_at::date <= current_date
    on conflict do nothing;
    get diagnostics v_added = row_count;

  elsif v_exp.template_slug = 'weekly-money-review' then
    for k in 0..(ceil((v_exp.ends_at::date - v_exp.started_at::date) / 7.0)::int - 1) loop
      v_ws := v_exp.started_at::date + (k * 7);
      exit when v_ws > current_date;
      v_n := 0;
      select 1 into v_n
        from public.behavioral_app_activity_daily a
       where a.user_id = v_exp.user_id
         and a.day between v_ws and v_ws + 6
       having sum(a.reports_views) > 0 and sum(a.planning_views + a.goals_views) > 0;
      if coalesce(v_n, 0) > 0 then
        insert into public.behavior_experiment_events(experiment_id, user_id, value, source, ref_type, ref_key, label, note)
        values (v_exp.id, v_exp.user_id, 1, 'auto', 'week', v_ws::text, 'Revisão da semana de ' || to_char(v_ws, 'DD/MM'),
                'Você abriu Relatórios e Planejamento ou Metas nesta semana.')
        on conflict do nothing;
        if found then v_added := v_added + 1; end if;
      end if;
    end loop;
  end if;
  return v_added;
end;
$$;
revoke all on function public.behavior_experiment_sync_auto(uuid) from public, anon;
grant execute on function public.behavior_experiment_sync_auto(uuid) to authenticated, service_role;

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

  -- evidências automáticas (aportes, revisões) entram antes do recálculo
  perform public.behavior_experiment_sync_auto(v_exp.id);

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

-- Lançamentos candidatos para vincular como prova (últimos do período do experimento).
create or replace function public.behavior_experiment_candidates(p_experiment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_exp public.behavior_experiments;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_exp from public.behavior_experiments where id = p_experiment_id and user_id = v_uid;
  if v_exp.id is null then raise exception 'experiment_not_found'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.occurred_at desc)
    from (
      select t.id, t.occurred_at::date as occurred_at, t.amount, t.type::text as type,
             left(coalesce(nullif(t.friendly_description,''), t.description, 'Lançamento'), 80) as description
        from public.transactions t
       where t.user_id = v_uid
         and t.status::text = 'confirmed'
         and t.type::text in ('expense','transfer')
         and t.movement_kind::text not in ('card_payment','refund','adjustment')
         and t.occurred_at::date >= v_exp.started_at::date
         and not exists (select 1 from public.behavior_experiment_events e
                          where e.experiment_id = v_exp.id and e.ref_type = 'transaction' and e.ref_key = t.id::text and e.value > 0)
       order by t.occurred_at desc
       limit 30
    ) x
  ), '[]'::jsonb);
end;
$$;
grant execute on function public.behavior_experiment_candidates(uuid) to authenticated;

-- Vincula um lançamento real ao experimento (prova da ação).
create or replace function public.behavior_experiment_link(p_experiment_id uuid, p_transaction_id uuid, p_note text default null)
returns public.behavior_experiments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_exp public.behavior_experiments;
  v_tx public.transactions;
  v_label text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_exp from public.behavior_experiments where id = p_experiment_id and user_id = v_uid;
  if v_exp.id is null or v_exp.status <> 'active' then raise exception 'active_experiment_not_found'; end if;
  if v_exp.template_slug not in ('small-wealth-moves','pause-before-buying') then raise exception 'experiment_does_not_accept_links'; end if;
  select * into v_tx from public.transactions where id = p_transaction_id and user_id = v_uid and status::text = 'confirmed';
  if v_tx.id is null then raise exception 'transaction_not_found'; end if;
  if v_tx.occurred_at::date < v_exp.started_at::date then raise exception 'transaction_before_experiment'; end if;
  v_label := case v_exp.template_slug when 'small-wealth-moves' then 'Ação de patrimônio' else 'Pausa antes da compra' end;
  insert into public.behavior_experiment_events(experiment_id, user_id, value, source, ref_type, ref_key, label, note)
  values (v_exp.id, v_uid, 1, 'linked', 'transaction', v_tx.id::text, v_label,
          left(coalesce(nullif(trim(p_note),''), nullif(v_tx.friendly_description,''), v_tx.description, 'Lançamento'), 120))
  on conflict (experiment_id, ref_type, ref_key) where ref_key is not null
  do update set value = 1, source = 'linked', label = excluded.label, note = excluded.note, occurred_at = now()
  where public.behavior_experiment_events.value = 0;
  return public.behavior_experiment_refresh(v_exp.id);
end;
$$;
grant execute on function public.behavior_experiment_link(uuid, uuid, text) to authenticated;

-- Conclui o roteiro guiado de 5 minutos da semana atual do experimento.
create or replace function public.behavior_experiment_complete_review(p_experiment_id uuid)
returns public.behavior_experiments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_exp public.behavior_experiments;
  v_ws date;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_exp from public.behavior_experiments where id = p_experiment_id and user_id = v_uid;
  if v_exp.id is null or v_exp.status <> 'active' or v_exp.template_slug <> 'weekly-money-review' then raise exception 'active_experiment_not_found'; end if;
  v_ws := v_exp.started_at::date + (((current_date - v_exp.started_at::date) / 7) * 7);
  insert into public.behavior_experiment_events(experiment_id, user_id, value, source, ref_type, ref_key, label, note)
  values (v_exp.id, v_uid, 1, 'guided', 'week', v_ws::text, 'Revisão da semana de ' || to_char(v_ws, 'DD/MM'), 'Você concluiu o roteiro guiado de 5 minutos.')
  on conflict do nothing;
  return public.behavior_experiment_refresh(v_exp.id);
end;
$$;
grant execute on function public.behavior_experiment_complete_review(uuid) to authenticated;

-- Desfaz um vínculo feito por engano (remoção lógica: value=0, source='removed') (só eventos vinculados/manuais do próprio usuário).
create or replace function public.behavior_experiment_unlink(p_event_id uuid)
returns public.behavior_experiments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ev public.behavior_experiment_events;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_ev from public.behavior_experiment_events where id = p_event_id and user_id = v_uid and source in ('linked','manual');
  if v_ev.id is null then raise exception 'event_not_found'; end if;
  update public.behavior_experiment_events set value = 0, source = 'removed' where id = v_ev.id;
  return public.behavior_experiment_refresh(v_ev.experiment_id);
end;
$$;
grant execute on function public.behavior_experiment_unlink(uuid) to authenticated;

notify pgrst, 'reload schema';
