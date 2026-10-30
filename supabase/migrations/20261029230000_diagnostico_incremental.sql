-- Diagnóstico incremental: o tick (antes a cada 30 min para todos, sempre completo) recalculava 12 usuários
-- ~48x/dia e gravava um snapshot novo mesmo sem nada ter mudado. A entrega proativa só roda de hora em hora.
--  1) o tick roda de hora em hora (minuto 2, antes da entrega proativa do minuto 17);
--  2) pula o usuário sem mudança desde o último snapshot atual, enquanto ele for do dia e tiver < 6 h;
--  3) dívida e lacuna emocional (dependem do calendário) só recalculam no 1º ciclo do dia ou quando
--     dívidas/pagamentos/check-ins mudaram. Exclusões não aparecem em updated_at: o limite de 6 h cobre.

create or replace function public.nino_diag_changed_since(_user_id uuid, _since timestamptz, _scope text default 'all')
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case _scope
    when 'debts' then
      exists (select 1 from public.debts where user_id=_user_id and updated_at > _since)
      or exists (select 1 from public.debt_payments where user_id=_user_id and created_at > _since)
    when 'emotional' then
      exists (select 1 from public.emotional_checkins where user_id=_user_id and created_at > _since)
    else
      exists (select 1 from public.transactions where user_id=_user_id and (updated_at > _since or created_at > _since))
      or exists (select 1 from public.debts where user_id=_user_id and updated_at > _since)
      or exists (select 1 from public.debt_payments where user_id=_user_id and created_at > _since)
      or exists (select 1 from public.recurring_entries where user_id=_user_id and updated_at > _since)
      or exists (select 1 from public.credit_cards where user_id=_user_id and updated_at > _since)
      or exists (select 1 from public.accounts where user_id=_user_id and updated_at > _since)
      or exists (select 1 from public.goals where user_id=_user_id and updated_at > _since)
      or exists (select 1 from public.emotional_checkins where user_id=_user_id and created_at > _since)
  end
$$;

create or replace function public.nino_diagnosis_tick()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r record; v_prev record; v_ok int:=0; v_skipped int:=0; v_failed int:=0; v_errors jsonb:='[]'::jsonb;
begin
  for r in select id from auth.users loop
    begin
      select created_at, as_of into v_prev from public.nino_diagnosis_snapshots
       where user_id=r.id and run_mode='live' and is_current order by created_at desc limit 1;
      if found and v_prev.as_of = current_date and v_prev.created_at > now() - interval '6 hours'
         and not public.nino_diag_changed_since(r.id, v_prev.created_at, 'all') then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      perform public.nino_refresh_diagnosis(r.id,current_date,'live','scheduled');
      v_ok:=v_ok+1;
    exception when others then
      v_failed:=v_failed+1;
      v_errors:=v_errors||jsonb_build_object('user_id',r.id,'error',sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok',v_failed=0,'processed',v_ok,'skipped',v_skipped,'failed',v_failed,'errors',v_errors,
                            'contract','nino_diagnosis_contract.v1','at',now());
end $function$;

create or replace function public.nino_refresh_diagnosis(_user_id uuid, _as_of date default current_date, _run_mode text default 'live', _source text default 'engine')
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_eval jsonb; v_snapshot uuid; v_projected int:=0; v_communications int:=0;
  v_future int:=0; v_debts int:=0; v_emotional int:=0; v_cat_goals int:=0; v_run_id uuid;
  v_prev record; v_calendar_due boolean:=true; v_debts_due boolean:=true; v_emotional_due boolean:=true;
begin
  -- Chamadas agendadas e repetidas no mesmo dia não recalculam o que só muda com o calendário.
  if _source='scheduled' and _run_mode='live' then
    select created_at, as_of into v_prev from public.nino_diagnosis_snapshots
     where user_id=_user_id and run_mode='live' and is_current order by created_at desc limit 1;
    if found and v_prev.as_of=_as_of then
      v_calendar_due := false;
      v_debts_due := public.nino_diag_changed_since(_user_id, v_prev.created_at, 'debts');
      v_emotional_due := public.nino_diag_changed_since(_user_id, v_prev.created_at, 'emotional');
    end if;
  end if;

  v_eval := public.nino_evaluate_financial_situations(_user_id,_as_of,_run_mode,_source);
  v_run_id := (v_eval->>'run_id')::uuid;
  v_future := public.nino_evaluate_future_situations(_user_id,_as_of,_run_mode,v_run_id);
  if v_calendar_due or v_debts_due then
    v_debts := public.nino_diag_detect_debt_alerts(_user_id,_as_of,_run_mode,v_run_id);
  end if;
  if v_calendar_due or v_emotional_due then
    v_emotional := public.nino_diag_detect_emotional_gap(_user_id,_as_of,_run_mode,v_run_id);
  end if;
  v_cat_goals := public.nino_diag_detect_category_goal_alerts(_user_id,_as_of,_run_mode,v_run_id);
  v_snapshot := public.nino_assemble_diagnosis(_user_id,_as_of,_run_mode);
  if _run_mode='live' then
    v_projected := public.nino_project_diagnosis(_user_id,v_snapshot);
    v_communications := public.nino_project_diagnosis_communications(_user_id,v_snapshot);
  end if;
  update public.nino_diagnosis_runs
     set projected_items=v_projected, finished_at=coalesce(finished_at,now())
   where id=v_run_id;
  return v_eval||jsonb_build_object('snapshot_id',v_snapshot,'projected_items',v_projected,
    'future_situations',v_future,'debt_alerts',v_debts,'emotional_alerts',v_emotional,
    'category_goal_alerts',v_cat_goals,'communications',v_communications);
end $function$;

select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'nino-intelligence-30m'), schedule := '2 * * * *');
