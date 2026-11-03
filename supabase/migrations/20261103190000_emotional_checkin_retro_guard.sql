-- Registro retroativo de humor (calendário do mês): lembrar de um dia passado NÃO pode gerar o aviso
-- "uma pausa hoje". O destaque só vale para check-in do dia corrente (America/Sao_Paulo).
create or replace function public.queue_declared_money_mood_highlight()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if v_day <> (now() at time zone 'America/Sao_Paulo')::date then
    return new;
  end if;
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
$function$;
