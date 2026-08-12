create or replace function public.nino_refresh_diagnosis(
  _user_id uuid,
  _as_of date default current_date,
  _run_mode text default 'live',
  _source text default 'engine'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_eval jsonb; v_snapshot uuid; v_projected int:=0; v_communications int:=0;
  v_future int:=0; v_debts int:=0; v_emotional int:=0; v_run_id uuid;
begin
  v_eval := public.nino_evaluate_financial_situations(_user_id,_as_of,_run_mode,_source);
  v_run_id := (v_eval->>'run_id')::uuid;
  v_future := public.nino_evaluate_future_situations(_user_id,_as_of,_run_mode,v_run_id);
  v_debts := public.nino_diag_detect_debt_alerts(_user_id,_as_of,_run_mode,v_run_id);
  v_emotional := public.nino_diag_detect_emotional_gap(_user_id,_as_of,_run_mode,v_run_id);
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
    'communications',v_communications);
end $$;

revoke all on function public.nino_refresh_diagnosis(uuid,date,text,text) from public, anon, authenticated;
revoke all on function public.nino_diag_detect_emotional_gap(uuid,date,text,uuid) from public, anon, authenticated;
