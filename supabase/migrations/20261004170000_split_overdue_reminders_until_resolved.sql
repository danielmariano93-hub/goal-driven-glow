-- Cobrança de rolê atrasada continua até a pessoa pagar, o dono pausar ou a divisão ser cancelada.
-- Antes: o lembrete "overdue" só era criado até 3 dias após o 1º atraso (due+4 d) e depois a
-- pessoa nunca mais era cobrada. Também disparava na virada do dia UTC (21h em São Paulo).
-- Agora: 1 cobrança por dia (a cada `repeat_every_days`) às `send_hour` de São Paulo,
-- sem data-limite. Encerram: pagamento (paid/cancelled), pausa individual, opt-out, divisão cancelada
-- (todos já removem a parcela da elegibilidade e o reconcile cancela os jobs pendentes).
CREATE OR REPLACE FUNCTION public.schedule_split_due_reminders(p_expense_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.split_reminder_policy%ROWTYPE;
  v_policy_version text;
  v_added integer := 0;
  r record;
  v_planned timestamptz;
  v_effective timestamptz;
  v_base_key text;
  v_key text;
  v_attempts integer;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_last_sent date;
  v_next_day date;
  v_repeat integer;
BEGIN
  SELECT * INTO cfg FROM public.split_reminder_policy WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled THEN RETURN 0; END IF;
  v_policy_version := to_char(cfg.updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');
  v_repeat := greatest(1, coalesce(cfg.repeat_every_days, 1));

  FOR r IN
    SELECT rv.shared_expense_id AS expense_id, rv.owner_user_id, rv.due_date,
           rv.participant_id, rv.installment_id, k.kind,
           CASE WHEN k.kind = 'due_today' THEN 0 ELSE greatest(1, coalesce(cfg.first_overdue_days, 1)) END AS offset_days
      FROM public.split_receivables_v1 rv
      CROSS JOIN (VALUES ('due_today'), ('overdue')) AS k(kind)
     WHERE (p_expense_id IS NULL OR rv.shared_expense_id = p_expense_id)
       AND public.split_installment_is_eligible(rv.installment_id)
  LOOP
    v_planned := public.split_due_timestamp(r.due_date + r.offset_days, cfg.send_hour);

    IF r.kind = 'due_today' THEN
      IF v_planned > now() THEN
        v_effective := v_planned;
      ELSIF now() <= v_planned + interval '12 hours' THEN
        v_effective := now();
      ELSE
        CONTINUE;
      END IF;
    ELSE
      IF v_planned > now() THEN
        v_effective := v_planned;
      ELSE
        -- Em atraso: uma cobrança por dia (de São Paulo), sem prazo final.
        SELECT max((j.scheduled_for AT TIME ZONE 'America/Sao_Paulo')::date) INTO v_last_sent
          FROM public.reminder_jobs j
         WHERE j.installment_id = r.installment_id
           AND j.kind = 'overdue'
           AND (j.status = 'sent'::public.reminder_status OR j.delivered_at IS NOT NULL OR j.read_at IS NOT NULL);
        v_next_day := CASE WHEN v_last_sent IS NULL THEN v_today ELSE greatest(v_today, v_last_sent + v_repeat) END;
        IF v_next_day > v_today THEN
          v_effective := public.split_due_timestamp(v_next_day, cfg.send_hour);
        ELSE
          v_effective := greatest(now(), public.split_due_timestamp(v_today, cfg.send_hour));
        END IF;
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.reminder_jobs j
       WHERE j.installment_id = r.installment_id
         AND j.kind = r.kind
         AND (j.scheduled_for AT TIME ZONE 'America/Sao_Paulo')::date = (v_effective AT TIME ZONE 'America/Sao_Paulo')::date
         AND (j.delivered_at IS NOT NULL OR j.read_at IS NOT NULL
              OR j.status = 'sent'::public.reminder_status)
    ) THEN
      CONTINUE;
    END IF;

    v_base_key := format('split:policy:%s:%s:%s:%s:%s:%s',
      v_policy_version, r.kind, r.expense_id, r.participant_id, r.installment_id, r.due_date);
    SELECT count(*) INTO v_attempts
      FROM public.reminder_jobs j
     WHERE j.idempotency_key = v_base_key OR j.idempotency_key LIKE v_base_key || ':r%';
    v_key := CASE WHEN v_attempts = 0 THEN v_base_key ELSE v_base_key || ':r' || v_attempts END;

    INSERT INTO public.reminder_jobs(
      owner_user_id, shared_expense_id, participant_id, installment_id, scheduled_for, status, kind,
      idempotency_key, policy_version, delivery_status)
    VALUES (
      r.owner_user_id, r.expense_id, r.participant_id, r.installment_id, v_effective,
      'queued'::public.reminder_status, r.kind, v_key, v_policy_version, 'none')
    ON CONFLICT (shared_expense_id, participant_id, coalesce(installment_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
      WHERE status IN ('queued'::public.reminder_status,'processing'::public.reminder_status,'enqueued'::public.reminder_status)
    DO UPDATE SET
      scheduled_for = CASE WHEN public.reminder_jobs.status = 'queued'::public.reminder_status
                           THEN EXCLUDED.scheduled_for ELSE public.reminder_jobs.scheduled_for END,
      policy_version = EXCLUDED.policy_version,
      updated_at = now();
    v_added := v_added + 1;
  END LOOP;

  RETURN v_added;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.schedule_split_due_reminders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_split_due_reminders(uuid) TO service_role;
