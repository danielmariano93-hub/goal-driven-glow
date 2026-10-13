-- Cobrança de rolê em atraso: até DUAS mensagens por dia depois de 2 dias de atraso.
--
-- Antes: 1 cobrança por dia, sempre às 9h, com o mesmo texto. Agora:
--  * atraso de até `late_after_days` (2) dias: 1 mensagem por dia, às `send_hour`;
--  * atraso maior: até `late_messages_per_day` (2) por dia — a 1ª às `send_hour` e a 2ª às
--    `late_second_send_hour` (19h), com pelo menos `late_min_gap_hours` (4h) depois da 1ª e
--    nunca depois das 22h (sem espaço, a 2ª fica para o dia seguinte);
--  * o texto de cada mensagem é escolhido no worker (dias em atraso + 1ª/2ª do dia), então a 2ª
--    nunca repete a 1ª. Pagamento, pausa, opt-out e cancelamento continuam encerrando tudo.
ALTER TABLE public.split_reminder_policy
  ADD COLUMN IF NOT EXISTS late_after_days integer NOT NULL DEFAULT 2 CHECK (late_after_days BETWEEN 0 AND 30),
  ADD COLUMN IF NOT EXISTS late_messages_per_day integer NOT NULL DEFAULT 2 CHECK (late_messages_per_day BETWEEN 1 AND 2),
  ADD COLUMN IF NOT EXISTS late_second_send_hour integer NOT NULL DEFAULT 19 CHECK (late_second_send_hour BETWEEN 12 AND 21),
  ADD COLUMN IF NOT EXISTS late_min_gap_hours integer NOT NULL DEFAULT 4 CHECK (late_min_gap_hours BETWEEN 2 AND 12);

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
  v_max_per_day integer;
  v_sent_today integer;
  v_last_sent_at timestamptz;
  v_second timestamptz;
  v_eff_date date;
  v_eff_max integer;
  v_sent_eff integer;
  v_replied_today boolean;
BEGIN
  SELECT * INTO cfg FROM public.split_reminder_policy WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled THEN RETURN 0; END IF;
  v_policy_version := to_char(cfg.updated_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');
  v_repeat := greatest(1, coalesce(cfg.repeat_every_days, 1));
  v_max_per_day := greatest(1, least(2, coalesce(cfg.late_messages_per_day, 2)));

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
        -- Em atraso: sem prazo final. Última data (de São Paulo) com cobrança enviada e quantas saíram hoje.
        SELECT max((j.scheduled_for AT TIME ZONE 'America/Sao_Paulo')::date) INTO v_last_sent
          FROM public.reminder_jobs j
         WHERE j.installment_id = r.installment_id
           AND j.kind = 'overdue'
           AND (j.status = 'sent'::public.reminder_status OR j.delivered_at IS NOT NULL OR j.read_at IS NOT NULL);
        SELECT count(*), max(j.updated_at) INTO v_sent_today, v_last_sent_at
          FROM public.reminder_jobs j
         WHERE j.installment_id = r.installment_id
           AND j.kind = 'overdue'
           AND (j.scheduled_for AT TIME ZONE 'America/Sao_Paulo')::date = v_today
           AND (j.status = 'sent'::public.reminder_status OR j.delivered_at IS NOT NULL OR j.read_at IS NOT NULL);
        -- Quantas mensagens cabem hoje: depois de `late_after_days` de atraso, até `late_messages_per_day`.
        v_eff_max := CASE WHEN (v_today - r.due_date) > coalesce(cfg.late_after_days, 2) THEN v_max_per_day ELSE 1 END;

        -- A pessoa respondeu hoje (ex.: "paguei" ou comprovante)? Então a 2ª do dia não sai.
        SELECT EXISTS (
          SELECT 1 FROM public.reminder_jobs j
           WHERE j.participant_id = r.participant_id
             AND j.last_error = 'participant_replied'
             AND (j.updated_at AT TIME ZONE 'America/Sao_Paulo')::date = v_today
        ) INTO v_replied_today;

        IF v_sent_today > 0 AND v_sent_today < v_eff_max THEN
          -- 2ª do dia: no horário da tarde/noite, com intervalo mínimo desde a 1ª e nunca depois das 22h.
          v_second := greatest(
            public.split_due_timestamp(v_today, cfg.late_second_send_hour),
            v_last_sent_at + make_interval(hours => coalesce(cfg.late_min_gap_hours, 4))
          );
          IF v_second <= public.split_due_timestamp(v_today, 22) AND NOT v_replied_today THEN
            v_effective := greatest(now(), v_second);
          ELSE
            v_effective := public.split_due_timestamp(v_today + v_repeat, cfg.send_hour);
          END IF;
        ELSE
          v_next_day := CASE WHEN v_last_sent IS NULL THEN v_today ELSE greatest(v_today, v_last_sent + v_repeat) END;
          IF v_next_day > v_today THEN
            v_effective := public.split_due_timestamp(v_next_day, cfg.send_hour);
          ELSE
            v_effective := greatest(now(), public.split_due_timestamp(v_today, cfg.send_hour));
          END IF;
        END IF;
      END IF;
    END IF;

    IF r.kind = 'overdue' THEN
      -- Já saiu o máximo permitido naquele dia? (o máximo depende dos dias de atraso naquela data)
      v_eff_date := (v_effective AT TIME ZONE 'America/Sao_Paulo')::date;
      v_eff_max := CASE WHEN (v_eff_date - r.due_date) > coalesce(cfg.late_after_days, 2) THEN v_max_per_day ELSE 1 END;
      SELECT count(*) INTO v_sent_eff
        FROM public.reminder_jobs j
       WHERE j.installment_id = r.installment_id
         AND j.kind = 'overdue'
         AND (j.scheduled_for AT TIME ZONE 'America/Sao_Paulo')::date = v_eff_date
         AND (j.delivered_at IS NOT NULL OR j.read_at IS NOT NULL OR j.status = 'sent'::public.reminder_status);
      IF v_sent_eff >= v_eff_max THEN
        CONTINUE;
      END IF;
    ELSIF EXISTS (
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
