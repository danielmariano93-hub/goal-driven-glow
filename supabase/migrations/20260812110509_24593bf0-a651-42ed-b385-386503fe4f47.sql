create or replace function public.nino_project_diagnosis_communications(_user_id uuid, _snapshot_id uuid)
returns int
language plpgsql security definer set search_path=public as $$
declare r record; v_count int:=0; v_action jsonb; v_channel text; v_communication_mode text;
begin
  select communication_mode into v_communication_mode
    from public.nino_diagnosis_config where singleton=true;
  if coalesce(v_communication_mode,'disabled')='disabled' then return 0; end if;

  update public.pending_proactive_suggestions
     set status='dismissed', defer_reason='superseded_by_diagnosis_core_v1'
   where user_id=_user_id and status in ('pending','ready','deferred')
     and dedup_key not like 'diagnosis:%';

  for r in
    select s.*, a.title action_title, a.route action_route, a.action_type
      from public.financial_situations s
      join public.financial_situation_actions a on a.situation_id=s.id
       and a.status in ('proposed','accepted','in_progress')
     where s.user_id=_user_id and s.run_mode='live'
       and s.status in ('active','worsening','confirmed')
       and s.confidence>=0.70 and s.relevance_score>=70
       and (s.temporal_scope='future'
            or s.severity='critical'
            or s.situation_type='recurring_commitment_pressure')
       and (s.valid_until is null or s.valid_until>now())
     order by s.relevance_score desc limit 2
  loop
    v_action := jsonb_build_object('label',r.action_title,'route',r.action_route,'type',r.action_type,
                                   'situation_id',r.id,'diagnosis_snapshot_id',_snapshot_id);
    v_channel := case
      when v_communication_mode='full'
       and (r.severity='critical'
            or r.situation_key like 'debt_overdue:%'
            or (r.temporal_scope='future' and r.valid_until<=now()+interval '48 hours'))
      then 'both'
      else 'app'
    end;

    insert into public.pending_proactive_suggestions(
      user_id, kind, severity, title, body, action, evidence,
      channel_ready, dedup_key, logical_dedup_key, status,
      expires_at, next_attempt_at
    ) values (
      _user_id, r.situation_type,
      case r.severity when 'critical' then 'critical' when 'attention' then 'attention' else 'info' end,
      r.headline,
      trim(coalesce(r.cause_summary,'') || case when r.forecast_summary is not null then ' '||r.forecast_summary else '' end),
      v_action,
      r.evaluation || jsonb_build_object('situation_id',r.id,'diagnosis_snapshot_id',_snapshot_id),
      v_channel,
      'diagnosis:'||r.situation_key,
      'diagnosis:'||r.situation_key,
      'pending', coalesce(r.valid_until,now()+interval '3 days'), now()
    )
    on conflict (user_id,dedup_key) do update set
      title=excluded.title, body=excluded.body, action=excluded.action,
      evidence=excluded.evidence, channel_ready=excluded.channel_ready,
      severity=excluded.severity, expires_at=excluded.expires_at,
      status=case when public.pending_proactive_suggestions.status='dispatched'
                  then 'dispatched' else 'pending' end,
      next_attempt_at=case when public.pending_proactive_suggestions.status='dispatched'
                           then public.pending_proactive_suggestions.next_attempt_at else now() end;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

revoke all on function public.nino_project_diagnosis_communications(uuid,uuid) from public, anon, authenticated;
