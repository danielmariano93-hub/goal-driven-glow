-- 1) Agenda real de dívidas: âncora derivada quando só existe due_day
create or replace function public.nino_diag_detect_debt_alerts(
  _user_id uuid, _as_of date default current_date, _run_mode text default 'live', _run_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record;
  v_detected int := 0;
  v_anchor date;
  v_paid int;
  v_due_cycles int;
  v_overdue_cycles int;
  v_next_due date;
  v_days int;
  v_overdue_amount numeric;
  v_cycle_due date;
begin
  if _run_mode = 'backtest' then
    return 0;
  end if;

  for r in
    select d.*,
           greatest(
             coalesce(d.installments_paid,0),
             coalesce((select sum(coalesce(p.installments_covered,1))
                         from public.debt_payments p where p.debt_id=d.id),0)
           )::int as paid_registered
      from public.debts d
     where d.user_id=_user_id
       and d.status='active'
       and coalesce(d.installment_amount,0) > 0
       and coalesce(d.outstanding_balance,0) > 0
  loop
    v_paid := r.paid_registered;

    if r.first_due_date is not null then
      v_anchor := r.first_due_date;
    elsif r.due_day between 1 and 31 and r.start_date is not null then
      v_anchor := make_date(
        extract(year from r.start_date)::int,
        extract(month from r.start_date)::int,
        least(r.due_day, 28));
      if v_anchor < r.start_date then
        v_anchor := (v_anchor + interval '1 month')::date;
      end if;
    elsif r.due_day between 1 and 31 then
      -- Agenda derivada: a parcela nº (pagas + 1) vence no due_day do ciclo corrente.
      v_cycle_due := make_date(
        extract(year from _as_of)::int,
        extract(month from _as_of)::int,
        least(r.due_day, 28));
      v_anchor := (v_cycle_due - make_interval(months => greatest(0, v_paid)))::date;
    else
      v_anchor := r.start_date;
    end if;

    if v_anchor is null then
      continue;
    end if;

    v_due_cycles := greatest(0,
      (extract(year from _as_of)::int - extract(year from v_anchor)::int) * 12
      + (extract(month from _as_of)::int - extract(month from v_anchor)::int)
      + case when extract(day from _as_of) >= extract(day from v_anchor) then 1 else 0 end);
    if r.installments_total is not null then
      v_due_cycles := least(v_due_cycles, r.installments_total);
    end if;

    v_overdue_cycles := greatest(0, v_due_cycles - v_paid);
    v_next_due := (v_anchor + make_interval(months => v_paid))::date;

    if v_overdue_cycles > 0 then
      v_days := greatest(1, (_as_of - v_next_due));
      v_overdue_amount := round(least(
        v_overdue_cycles * r.installment_amount,
        coalesce(r.outstanding_balance, v_overdue_cycles * r.installment_amount)
      )::numeric, 2);

      perform public.nino_diag_put_situation(
        _user_id, _run_mode, _run_id, _as_of,
        'recurring_commitment_pressure', 'debt_overdue:' || r.id::text,
        'active', 'now',
        case when v_overdue_cycles >= 2 or v_days >= 15 then 'critical' else 'attention' end,
        0.9,
        v_next_due, _as_of,
        v_overdue_amount, r.installment_amount, v_overdue_amount, null, v_overdue_amount,
        'Dívida "' || r.name || '" com ' || v_overdue_cycles || ' parcela' ||
          case when v_overdue_cycles > 1 then 's' else '' end || ' sem pagamento registrado',
        'A parcela de ' || public.nino_diag_brl(r.installment_amount) ||
          ' venceu em ' || to_char(v_next_due,'DD/MM') || ' e nenhum pagamento foi registrado (' || v_days || ' dias).',
        'Total em aberto nessa dívida: ' || public.nino_diag_brl(v_overdue_amount) ||
          '. Se você já pagou, registre para o Nino parar de contar como atraso.',
        null, (_as_of + 7)::timestamptz,
        jsonb_build_object('debt_id',r.id,'name',r.name,'creditor',r.creditor,
                           'situation','em_atraso','overdue_installments',v_overdue_cycles,
                           'overdue_amount',v_overdue_amount,'days_overdue',v_days,
                           'installment_amount',r.installment_amount,
                           'installments_paid',v_paid,'installments_total',r.installments_total,
                           'next_due_date',v_next_due,'formula_version','debt_status.v2'),
        jsonb_build_object('evidence_type','debt_schedule','metric_key','overdue_amount','value',v_overdue_amount),
        jsonb_build_object('key','debt_overdue:register_payment','type','review_debt',
                           'title','Registrar pagamento','route','/app/dividas','priority',95)
      );
      v_detected := v_detected + 1;

    elsif v_next_due is not null
      and v_next_due >= _as_of
      and v_next_due <= _as_of + 7
      and (r.installments_total is null or v_paid < r.installments_total)
    then
      v_days := (v_next_due - _as_of);
      perform public.nino_diag_put_situation(
        _user_id, _run_mode, _run_id, _as_of,
        'recurring_commitment_pressure', 'debt_due_soon:' || r.id::text,
        'active', 'future', 'attention', 0.85,
        _as_of, v_next_due,
        r.installment_amount, r.installment_amount, null, null, r.installment_amount,
        'Parcela de "' || r.name || '" vence ' ||
          case when v_days = 0 then 'hoje' when v_days = 1 then 'amanhã'
               else 'em ' || v_days || ' dias' end,
        'São ' || public.nino_diag_brl(r.installment_amount) || ' com vencimento em ' ||
          to_char(v_next_due,'DD/MM') || '.',
        'Deixar vencer aumenta o custo da dívida e trava seu caixa no mês seguinte.',
        null, (v_next_due + 3)::timestamptz,
        jsonb_build_object('debt_id',r.id,'name',r.name,'creditor',r.creditor,
                           'situation','vence_em_breve','days_until_due',v_days,
                           'installment_amount',r.installment_amount,
                           'installments_paid',v_paid,'installments_total',r.installments_total,
                           'next_due_date',v_next_due,'formula_version','debt_status.v2'),
        jsonb_build_object('evidence_type','debt_schedule','metric_key','installment_amount','value',r.installment_amount),
        jsonb_build_object('key','debt_due_soon:pay','type','review_debt',
                           'title','Ver a dívida','route','/app/dividas','priority',88)
      );
      v_detected := v_detected + 1;
    end if;
  end loop;

  return v_detected;
end
$fn$;

-- 2) Detector: ausência de registro emocional
create or replace function public.nino_diag_detect_emotional_gap(
  _user_id uuid, _as_of date default current_date, _run_mode text default 'live', _run_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_last date;
  v_total int;
  v_gap int;
begin
  if _run_mode = 'backtest' then
    return 0;
  end if;

  select max((occurred_at at time zone 'America/Sao_Paulo')::date), count(*)
    into v_last, v_total
    from public.emotional_checkins
   where user_id = _user_id;

  if v_total = 0 then
    return 0; -- sem histórico não há hábito para retomar
  end if;

  v_gap := (_as_of - v_last);
  if v_gap < 4 then
    return 0;
  end if;

  perform public.nino_diag_put_situation(
    _user_id, _run_mode, _run_id, _as_of,
    'behavioral_pattern', 'emotional_checkin_gap',
    'active', 'now', 'attention', 0.8,
    v_last, _as_of,
    v_gap, 0, v_gap, null, null,
    'Você não registra como se sente há ' || v_gap || ' dias',
    'Seu último registro emocional foi em ' || to_char(v_last,'DD/MM') || '.',
    'Sem esse sinal o Nino perde a leitura do que dispara seus gastos por impulso.',
    null, (_as_of + 3)::timestamptz,
    jsonb_build_object('days_without_checkin', v_gap, 'last_checkin', v_last,
                       'total_checkins', v_total, 'formula_version','emotional_gap.v1'),
    jsonb_build_object('evidence_type','emotional_checkins','metric_key','days_without_checkin','value',v_gap),
    jsonb_build_object('key','emotional_checkin_gap:register','type','register_emotion',
                       'title','Registrar como estou','route','/app/emocoes','priority',70)
  );
  return 1;
end
$fn$;

-- 3) Progresso automático de desafios a partir dos fatos do usuário
create or replace function public.challenge_sync_activity(_user_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r record;
  v_days int;
  v_goal numeric;
  v_updated int := 0;
begin
  if _user_id is null then
    return 0;
  end if;

  for r in
    select uc.id, uc.challenge_slug, uc.started_at, uc.status, uc.current_progress,
           c.kind, c.goal_value, c.duration_days, c.xp_reward, c.title
      from public.user_challenges uc
      join public.challenges_catalog c on c.slug = uc.challenge_slug
     where uc.user_id = _user_id
       and uc.status = 'joined'
       and c.kind in ('spending_log','emotion_checkin')
  loop
    v_goal := greatest(1, coalesce(r.goal_value, coalesce(r.duration_days,7)));

    if r.kind = 'spending_log' then
      select count(distinct (t.occurred_at at time zone 'America/Sao_Paulo')::date)
        into v_days
        from public.transactions t
       where t.user_id = _user_id
         and t.type = 'expense'
         and t.status = 'confirmed'
         and (t.occurred_at at time zone 'America/Sao_Paulo')::date
             >= (r.started_at at time zone 'America/Sao_Paulo')::date;
    else
      select count(distinct (e.occurred_at at time zone 'America/Sao_Paulo')::date)
        into v_days
        from public.emotional_checkins e
       where e.user_id = _user_id
         and (e.occurred_at at time zone 'America/Sao_Paulo')::date
             >= (r.started_at at time zone 'America/Sao_Paulo')::date;
    end if;

    v_days := least(coalesce(v_days,0), v_goal::int);

    if v_days <= coalesce(r.current_progress,0) then
      continue;
    end if;

    update public.user_challenges
       set current_progress = v_days,
           progress = least(100, floor(v_days::numeric * 100 / v_goal))::smallint,
           status = case when v_days >= v_goal then 'completed'::user_challenge_status else status end,
           finished_at = case when v_days >= v_goal then now() else finished_at end,
           updated_at = now()
     where id = r.id;

    v_updated := v_updated + 1;

    if v_days >= v_goal and coalesce(r.xp_reward,0) > 0 then
      insert into public.xp_events (user_id, source_type, source_id, xp_delta, reason)
      values (_user_id, 'challenge_completed', r.id::text, r.xp_reward,
              'Desafio concluído: ' || coalesce(r.title, r.challenge_slug))
      on conflict (user_id, source_type, source_id) do nothing;

      insert into public.notifications (user_id, type, title, body, action_url, dedup_key)
      values (_user_id, 'achievement', 'Desafio concluído',
              'Você concluiu "' || coalesce(r.title, r.challenge_slug) || '".',
              '/app/desafios', 'challenge_done:' || r.id::text)
      on conflict do nothing;
    end if;
  end loop;

  return v_updated;
end
$fn$;

grant execute on function public.challenge_sync_activity(uuid) to authenticated, service_role;

create or replace function public.trg_challenge_sync_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.challenge_sync_activity(new.user_id);
  return null;
end
$fn$;

drop trigger if exists challenge_sync_on_transaction on public.transactions;
create trigger challenge_sync_on_transaction
after insert on public.transactions
for each row execute function public.trg_challenge_sync_activity();

drop trigger if exists challenge_sync_on_emotion on public.emotional_checkins;
create trigger challenge_sync_on_emotion
after insert on public.emotional_checkins
for each row execute function public.trg_challenge_sync_activity();

-- 4) Emotional gap entra no ciclo de diagnóstico
create or replace function public.nino_refresh_diagnosis(
  _user_id uuid, _as_of date default current_date, _run_mode text default 'live', _source text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_eval jsonb;
  v_future int;
  v_debts int;
  v_emotional int;
  v_communications int;
  v_run_id uuid;
begin
  v_eval := public.nino_evaluate_financial_situations(_user_id,_as_of,_run_mode,_source);
  v_run_id := (v_eval->>'run_id')::uuid;
  v_future := public.nino_evaluate_future_situations(_user_id,_as_of,_run_mode,v_run_id);
  v_debts := public.nino_diag_detect_debt_alerts(_user_id,_as_of,_run_mode,v_run_id);
  v_emotional := public.nino_diag_detect_emotional_gap(_user_id,_as_of,_run_mode,v_run_id);
  v_communications := public.nino_situation_enqueue_communications(_user_id,_as_of,_run_mode,v_run_id);

  return jsonb_build_object(
    'run_id', v_run_id,
    'evaluation', v_eval,
    'future_situations', v_future,
    'debt_alerts', v_debts,
    'emotional_alerts', v_emotional,
    'communications', v_communications);
end
$fn$;
