-- Meu Nino — product quality hardening
-- Scope: split due-date reminders, proactive cron repair, editable communication
-- templates, actionable proactive details, categorization backfill, memory
-- reconciliation and historical tip deduplication.

-- ============================================================================
-- 1. DIVISÃO DO ROLÊ — D-1, D0, D+1, D+3 e D+7
-- ============================================================================

ALTER TABLE public.reminder_jobs DROP CONSTRAINT IF EXISTS reminder_jobs_kind_check;
ALTER TABLE public.reminder_jobs
  ADD CONSTRAINT reminder_jobs_kind_check
  CHECK (kind = ANY (ARRAY[
    'invite'::text,
    'reminder'::text,
    'due_soon'::text,
    'due_today'::text,
    'overdue'::text,
    'payment_confirmation'::text,
    'completed'::text
  ]));

CREATE OR REPLACE FUNCTION public.split_due_timestamp(p_date date, p_hour integer DEFAULT 9)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT (p_date::timestamp + make_interval(hours => p_hour)) AT TIME ZONE 'America/Sao_Paulo';
$$;

CREATE OR REPLACE FUNCTION public.schedule_split_due_reminders(p_expense_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_added integer := 0;
  v_rows integer := 0;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- Reativa somente jobs futuros que haviam sido pulados por uma mudança
  -- reversível (por exemplo, lembretes desligados e ligados novamente).
  UPDATE public.reminder_jobs r
     SET status = 'queued'::public.reminder_status,
         last_error = NULL,
         lease_expires_at = NULL,
         attempts = 0,
         updated_at = now()
    FROM public.shared_expenses se
    JOIN public.shared_expense_participants p ON p.shared_expense_id = se.id
   WHERE r.shared_expense_id = se.id
     AND r.participant_id = p.id
     AND (p_expense_id IS NULL OR se.id = p_expense_id)
     AND r.kind IN ('due_soon','due_today','overdue')
     AND r.status = 'skipped'::public.reminder_status
     AND r.scheduled_for > now()
     AND se.status = 'active'
     AND se.deleted_at IS NULL
     AND se.reminder_enabled = true
     AND p.status IN ('pending','partial','notified')
     AND p.opt_out_at IS NULL;

  -- D-1 às 09h.
  INSERT INTO public.reminder_jobs (
    owner_user_id, shared_expense_id, participant_id,
    scheduled_for, status, kind, idempotency_key
  )
  SELECT
    se.owner_user_id, se.id, p.id,
    public.split_due_timestamp(se.due_date - 1, 9),
    'queued'::public.reminder_status,
    'due_soon',
    format('split:due_soon:%s:%s:%s', se.id, p.id, se.due_date)
  FROM public.shared_expenses se
  JOIN public.shared_expense_participants p ON p.shared_expense_id = se.id
  WHERE (p_expense_id IS NULL OR se.id = p_expense_id)
    AND se.status = 'active'
    AND se.deleted_at IS NULL
    AND se.reminder_enabled = true
    AND se.due_date IS NOT NULL
    AND p.status IN ('pending','partial','notified')
    AND p.opt_out_at IS NULL
    AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
    AND public.split_due_timestamp(se.due_date - 1, 9) > now()
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_added := v_added + v_rows;

  -- D0 às 09h.
  INSERT INTO public.reminder_jobs (
    owner_user_id, shared_expense_id, participant_id,
    scheduled_for, status, kind, idempotency_key
  )
  SELECT
    se.owner_user_id, se.id, p.id,
    public.split_due_timestamp(se.due_date, 9),
    'queued'::public.reminder_status,
    'due_today',
    format('split:due_today:%s:%s:%s', se.id, p.id, se.due_date)
  FROM public.shared_expenses se
  JOIN public.shared_expense_participants p ON p.shared_expense_id = se.id
  WHERE (p_expense_id IS NULL OR se.id = p_expense_id)
    AND se.status = 'active'
    AND se.deleted_at IS NULL
    AND se.reminder_enabled = true
    AND se.due_date IS NOT NULL
    AND p.status IN ('pending','partial','notified')
    AND p.opt_out_at IS NULL
    AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
    AND public.split_due_timestamp(se.due_date, 9) > now()
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_added := v_added + v_rows;

  -- D+1, D+3 e D+7 às 10h, sempre com kind=overdue e idempotência por estágio.
  INSERT INTO public.reminder_jobs (
    owner_user_id, shared_expense_id, participant_id,
    scheduled_for, status, kind, idempotency_key
  )
  SELECT
    se.owner_user_id, se.id, p.id,
    public.split_due_timestamp(se.due_date + stage.days_after, 10),
    'queued'::public.reminder_status,
    'overdue',
    format('split:overdue:%s:%s:%s:d%s', se.id, p.id, se.due_date, stage.days_after)
  FROM public.shared_expenses se
  JOIN public.shared_expense_participants p ON p.shared_expense_id = se.id
  CROSS JOIN (VALUES (1), (3), (7)) AS stage(days_after)
  WHERE (p_expense_id IS NULL OR se.id = p_expense_id)
    AND se.status = 'active'
    AND se.deleted_at IS NULL
    AND se.reminder_enabled = true
    AND se.due_date IS NOT NULL
    AND p.status IN ('pending','partial','notified')
    AND p.opt_out_at IS NULL
    AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
    AND public.split_due_timestamp(se.due_date + stage.days_after, 10) > now()
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_added := v_added + v_rows;

  -- Catch-up: um único lembrete imediato para vencimento de amanhã, hoje ou
  -- já vencido há no máximo 7 dias. Nunca cria uma rajada de estágios atrasados.
  INSERT INTO public.reminder_jobs (
    owner_user_id, shared_expense_id, participant_id,
    scheduled_for, status, kind, idempotency_key
  )
  SELECT
    se.owner_user_id, se.id, p.id,
    now() + interval '30 seconds',
    'queued'::public.reminder_status,
    CASE
      WHEN se.due_date = v_today + 1 THEN 'due_soon'
      WHEN se.due_date = v_today THEN 'due_today'
      ELSE 'overdue'
    END,
    format('split:catchup:%s:%s:%s', se.id, p.id, se.due_date)
  FROM public.shared_expenses se
  JOIN public.shared_expense_participants p ON p.shared_expense_id = se.id
  WHERE (p_expense_id IS NULL OR se.id = p_expense_id)
    AND se.status = 'active'
    AND se.deleted_at IS NULL
    AND se.reminder_enabled = true
    AND se.due_date BETWEEN v_today - 7 AND v_today + 1
    AND p.status IN ('pending','partial','notified')
    AND p.opt_out_at IS NULL
    AND (p.phone_e164 IS NOT NULL OR p.linked_user_id IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1
      FROM public.reminder_jobs existing
      WHERE existing.shared_expense_id = se.id
        AND existing.participant_id = p.id
        AND existing.kind IN ('due_soon','due_today','overdue')
        AND existing.scheduled_for <= now()
        AND existing.status IN ('processing','enqueued')
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_added := v_added + v_rows;

  RETURN v_added;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_split_due_reminders(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.schedule_split_due_reminders(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_reconcile_split_due_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'shared_expenses' THEN
    v_expense_id := NEW.id;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.due_date IS DISTINCT FROM OLD.due_date
         OR NEW.reminder_enabled IS DISTINCT FROM OLD.reminder_enabled
         OR NEW.status IS DISTINCT FROM OLD.status
         OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
        UPDATE public.reminder_jobs
           SET status = 'skipped'::public.reminder_status,
               last_error = 'schedule_changed',
               lease_expires_at = NULL,
               updated_at = now()
         WHERE shared_expense_id = NEW.id
           AND kind IN ('due_soon','due_today','overdue')
           AND status = 'queued'::public.reminder_status;
      END IF;
    END IF;
  ELSE
    v_expense_id := NEW.shared_expense_id;
    IF NEW.status NOT IN ('pending','partial','notified') OR NEW.opt_out_at IS NOT NULL THEN
      UPDATE public.reminder_jobs
         SET status = 'skipped'::public.reminder_status,
             last_error = CASE WHEN NEW.opt_out_at IS NOT NULL THEN 'opted_out' ELSE 'participant_settled' END,
             lease_expires_at = NULL,
             updated_at = now()
       WHERE participant_id = NEW.id
         AND kind IN ('reminder','due_soon','due_today','overdue')
         AND status = 'queued'::public.reminder_status;
      RETURN NEW;
    END IF;
  END IF;

  PERFORM public.schedule_split_due_reminders(v_expense_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shared_expenses_due_schedule ON public.shared_expenses;
CREATE TRIGGER shared_expenses_due_schedule
  AFTER INSERT OR UPDATE OF due_date, reminder_enabled, status, deleted_at
  ON public.shared_expenses
  FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_split_due_schedule();

DROP TRIGGER IF EXISTS shared_participants_due_schedule ON public.shared_expense_participants;
CREATE TRIGGER shared_participants_due_schedule
  AFTER INSERT OR UPDATE OF status, phone_e164, linked_user_id, opt_out_at
  ON public.shared_expense_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_split_due_schedule();

CREATE OR REPLACE FUNCTION public.split_message_pipeline_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  secret_value text;
  request_id bigint;
BEGIN
  PERFORM public.schedule_split_due_reminders(NULL);

  SELECT decrypted_secret INTO secret_value
    FROM vault.decrypted_secrets
   WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
   ORDER BY CASE name
     WHEN 'INTERNAL_CRON_SECRET' THEN 0
     WHEN 'meunino_cron_secret' THEN 1
     ELSE 2
   END, created_at DESC
   LIMIT 1;

  IF nullif(secret_value,'') IS NULL THEN
    INSERT INTO public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
    VALUES('split-reminders-dispatch',now(),false,'cron_secret_missing',0,1)
    ON CONFLICT (job_key) DO UPDATE SET
      last_run_at=excluded.last_run_at,last_ok=false,last_error_code=excluded.last_error_code,
      failed=public.job_heartbeats.failed+1,updated_at=now();
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/split-reminders-dispatch-v2',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || coalesce(current_setting('app.settings.anon_key', true), ''),
      'x-cron-secret',secret_value
    ),
    body := jsonb_build_object('source','pg_cron')
  ) INTO request_id;
  RETURN request_id;
END;
$$;

-- Backfill de rolês já existentes, incluindo catch-up para vencidos recentes.
SELECT public.schedule_split_due_reminders(NULL);

-- ============================================================================
-- 2. CRON PROATIVO — CORREÇÃO DE AUTENTICAÇÃO E TELEMETRIA
-- ============================================================================

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'agent-proactive-hourly' LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'agent-proactive-hourly',
    '17 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/agent-proactive-tick',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || coalesce(current_setting('app.settings.anon_key', true), ''),
          'x-cron-secret', coalesce((
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
            ORDER BY CASE name
              WHEN 'INTERNAL_CRON_SECRET' THEN 0
              WHEN 'meunino_cron_secret' THEN 1
              ELSE 2
            END, created_at DESC
            LIMIT 1
          ), '')
        ),
        body := jsonb_build_object('source','cron','time',now())
      );
    $cron$
  );
END;
$$;

-- ============================================================================
-- 3. TEMPLATES ADMINISTRÁVEIS DE COMUNICAÇÃO
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.communication_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL REFERENCES public.communication_catalog(kind) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('app','whatsapp')),
  title_template text NOT NULL,
  body_template text NOT NULL,
  allowed_variables text[] NOT NULL DEFAULT ARRAY[
    'title','body','kind','severity','dedup_key','action_url',
    'amount','count','description','remaining','days_left','monthly_needed',
    'category','share','current','avg','due','occurred_at'
  ]::text[],
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind, channel, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_templates_one_active
  ON public.communication_templates(kind, channel)
  WHERE active;

ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "communication templates readable by admins" ON public.communication_templates;
CREATE POLICY "communication templates readable by admins"
  ON public.communication_templates FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "communication templates managed by admins" ON public.communication_templates;
CREATE POLICY "communication templates managed by admins"
  ON public.communication_templates FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.communication_templates TO authenticated;
GRANT ALL ON public.communication_templates TO service_role;

DROP TRIGGER IF EXISTS communication_templates_touch ON public.communication_templates;
CREATE TRIGGER communication_templates_touch
  BEFORE UPDATE ON public.communication_templates
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

INSERT INTO public.communication_templates (
  kind, channel, title_template, body_template, allowed_variables, active, version
)
SELECT
  catalog.kind,
  channel_name,
  '{{title}}',
  CASE
    WHEN channel_name = 'whatsapp' THEN E'{{body}}\n\nAbra o Meu Nino para ver os detalhes.'
    ELSE '{{body}}'
  END,
  ARRAY[
    'title','body','kind','severity','dedup_key','action_url',
    'amount','count','description','remaining','days_left','monthly_needed',
    'category','share','current','avg','due','occurred_at'
  ]::text[],
  true,
  1
FROM public.communication_catalog catalog
CROSS JOIN LATERAL unnest(catalog.allowed_channels) AS channels(channel_name)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_communication_templates(_kind text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._require_perm('ops.read');
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(t) ORDER BY t.kind, t.channel, t.version DESC)
    FROM public.communication_templates t
    WHERE _kind IS NULL OR t.kind = _kind
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_communication_template_upsert(
  _kind text,
  _channel text,
  _title_template text,
  _body_template text,
  _active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version integer;
  v_row public.communication_templates%ROWTYPE;
  v_unknown text[];
  v_allowed constant text[] := ARRAY[
    'title','body','kind','severity','dedup_key','action_url',
    'amount','count','description','remaining','days_left','monthly_needed',
    'category','share','current','avg','due','occurred_at'
  ];
BEGIN
  PERFORM public._require_perm('ops.write');
  IF _channel NOT IN ('app','whatsapp') THEN RAISE EXCEPTION 'invalid_channel'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.communication_catalog WHERE kind = _kind) THEN
    RAISE EXCEPTION 'kind_not_found';
  END IF;
  IF length(trim(coalesce(_title_template,''))) = 0 OR length(trim(coalesce(_body_template,''))) = 0 THEN
    RAISE EXCEPTION 'template_required';
  END IF;

  SELECT array_agg(DISTINCT variable_name) INTO v_unknown
  FROM (
    SELECT variable_match[1] AS variable_name
    FROM regexp_matches(_title_template || ' ' || _body_template, '\{\{\s*([a-zA-Z0-9_]+)\s*\}\}', 'g') AS m(variable_match)
  ) vars
  WHERE NOT (variable_name = ANY(v_allowed));

  IF coalesce(array_length(v_unknown,1),0) > 0 THEN
    RAISE EXCEPTION 'unknown_template_variables:%', array_to_string(v_unknown, ',');
  END IF;

  SELECT coalesce(max(version),0) + 1 INTO v_version
  FROM public.communication_templates
  WHERE kind = _kind AND channel = _channel;

  IF _active THEN
    UPDATE public.communication_templates
       SET active = false, updated_by = auth.uid(), updated_at = now()
     WHERE kind = _kind AND channel = _channel AND active;
  END IF;

  INSERT INTO public.communication_templates (
    kind, channel, title_template, body_template, allowed_variables,
    active, version, created_by, updated_by
  ) VALUES (
    _kind, _channel, trim(_title_template), trim(_body_template), v_allowed,
    _active, v_version, auth.uid(), auth.uid()
  ) RETURNING * INTO v_row;

  INSERT INTO public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
  VALUES(
    auth.uid(),'communication_template_upsert','communication_template',v_row.id::text,
    jsonb_build_object('kind',_kind,'channel',_channel,'version',v_version,'active',_active)
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_communication_templates(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_communication_template_upsert(text,text,text,text,boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_communication_templates(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_communication_template_upsert(text,text,text,text,boolean) TO authenticated, service_role;

-- ============================================================================
-- 4. DETALHE E FEEDBACK DOS ALERTAS PROATIVOS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.my_proactive_suggestion(_dedup_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING errcode='42501'; END IF;

  SELECT jsonb_build_object(
    'suggestion', to_jsonb(s),
    'deliveries', coalesce((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC)
      FROM public.communication_deliveries d
      WHERE d.user_id = v_user AND d.dedup_key = _dedup_key
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.pending_proactive_suggestions s
  WHERE s.user_id = v_user AND s.dedup_key = _dedup_key
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_result IS NULL THEN RAISE EXCEPTION 'suggestion_not_found' USING errcode='P0002'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_proactive_suggestion_feedback(_dedup_key text, _feedback text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_kind text;
  v_suggestion_id uuid;
  v_normalized text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required' USING errcode='42501'; END IF;
  IF _feedback NOT IN ('useful','not_useful','dismissed','duplicate_confirmed','not_duplicate') THEN
    RAISE EXCEPTION 'invalid_feedback';
  END IF;

  SELECT id,kind INTO v_suggestion_id,v_kind
  FROM public.pending_proactive_suggestions
  WHERE user_id=v_user AND dedup_key=_dedup_key
  ORDER BY created_at DESC LIMIT 1;
  IF v_suggestion_id IS NULL THEN RAISE EXCEPTION 'suggestion_not_found' USING errcode='P0002'; END IF;

  v_normalized := CASE
    WHEN _feedback='not_duplicate' THEN 'not_useful'
    WHEN _feedback='duplicate_confirmed' THEN 'useful'
    ELSE _feedback
  END;

  UPDATE public.pending_proactive_suggestions
     SET status='dismissed', dismissed_at=now()
   WHERE id=v_suggestion_id;

  UPDATE public.communication_deliveries
     SET user_feedback=v_normalized,
         false_positive=CASE WHEN _feedback='not_duplicate' THEN true WHEN _feedback='duplicate_confirmed' THEN false ELSE false_positive END,
         action_taken=CASE WHEN _feedback='duplicate_confirmed' THEN 'duplicate_confirmed' ELSE action_taken END,
         acted_at=CASE WHEN _feedback IN ('useful','duplicate_confirmed') THEN now() ELSE acted_at END,
         interacted_at=coalesce(interacted_at,now()),
         status=CASE WHEN _feedback IN ('useful','duplicate_confirmed') THEN 'acted' ELSE 'dismissed' END
   WHERE user_id=v_user AND dedup_key=_dedup_key;

  INSERT INTO public.communication_feedback(user_id,source_table,source_id,kind,family,dedup_key,feedback)
  VALUES(
    v_user,'pending_proactive_suggestions',v_suggestion_id,v_kind,
    (SELECT family FROM public.communication_catalog WHERE kind=v_kind),_dedup_key,v_normalized
  )
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.my_proactive_suggestion(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.my_proactive_suggestion_feedback(text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_proactive_suggestion(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_proactive_suggestion_feedback(text,text) TO authenticated, service_role;

-- ============================================================================
-- 5. CATEGORIZAÇÃO — APRENDIZADO EXATO, AUDITORIA E BACKFILL SEGURO
-- ============================================================================

CREATE OR REPLACE FUNCTION public.merchant_alias_autoconfirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pattern text;
  v_name text;
BEGIN
  IF NEW.category_id IS NULL OR NEW.user_edited_at IS NULL THEN RETURN NEW; END IF;
  IF coalesce(NEW.movement_kind,'transaction') <> 'transaction'
     OR NEW.transfer_group_id IS NOT NULL
     OR NEW.settles_card_id IS NOT NULL
     OR NEW.shared_expense_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_name := coalesce(nullif(NEW.friendly_description,''),nullif(NEW.description,''),nullif(NEW.raw_description,''));
  v_pattern := public.category_alias_key(coalesce(NEW.normalized_description,v_name));
  IF length(v_pattern) < 3 THEN RETURN NEW; END IF;

  INSERT INTO public.merchant_aliases(
    user_id,alias_key,friendly_name,category_id,learned_from,hits,last_used_at,
    canonical_name,normalized_pattern,confidence,confirmed_by_user_at
  ) VALUES(
    NEW.user_id,v_pattern,coalesce(v_name,v_pattern),NEW.category_id,'manual',1,now(),
    coalesce(v_name,v_pattern),v_pattern,0.98,now()
  )
  ON CONFLICT(user_id,alias_key) DO UPDATE SET
    friendly_name=excluded.friendly_name,
    category_id=excluded.category_id,
    learned_from='manual',
    hits=public.merchant_aliases.hits+1,
    last_used_at=now(),
    canonical_name=excluded.canonical_name,
    normalized_pattern=excluded.normalized_pattern,
    confidence=0.98,
    confirmed_by_user_at=now(),
    updated_at=now();
  RETURN NEW;
END;
$$;

-- Escrita canônica para novos lançamentos e edições manuais.
CREATE OR REPLACE FUNCTION public.tg_transactions_category_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.category_id IS NOT NULL AND NEW.category_source IS NULL THEN
      NEW.category_source := CASE WHEN NEW.origin::text = 'manual' THEN 'user' ELSE 'import' END;
      NEW.category_confidence := CASE WHEN NEW.origin::text = 'manual' THEN 1 ELSE 0.80 END;
      NEW.category_reason := CASE WHEN NEW.origin::text = 'manual'
        THEN 'categoria informada pelo usuário' ELSE 'categoria recebida na origem do lançamento' END;
      IF NEW.origin::text = 'manual' THEN NEW.user_edited_at := coalesce(NEW.user_edited_at,now()); END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
    NEW.previous_category_id := OLD.category_id;
    IF NEW.category_source IS NOT DISTINCT FROM OLD.category_source THEN
      NEW.category_source := 'user';
      NEW.category_confidence := 1;
      NEW.category_reason := 'edição manual do usuário';
      NEW.user_edited_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_category_audit ON public.transactions;
CREATE TRIGGER transactions_category_audit
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_transactions_category_audit();

-- Auditoria mínima para o legado já categorizado, sem alterar a categoria.
UPDATE public.transactions
   SET category_source = coalesce(category_source,'legacy'),
       category_confidence = coalesce(category_confidence,0.60),
       category_reason = coalesce(category_reason,'categoria existente antes da trilha de auditoria')
 WHERE category_id IS NOT NULL
   AND category_source IS NULL;

-- 1º: aplica aliases pessoais exatos somente em movimentos comuns.
UPDATE public.transactions t
   SET category_id = a.category_id,
       category_source = 'alias',
       category_confidence = greatest(coalesce(a.confidence,0.90),0.90),
       category_reason = 'alias pessoal exato',
       updated_at = now()
  FROM public.merchant_aliases a
 WHERE t.user_id = a.user_id
   AND t.category_id IS NULL
   AND a.category_id IS NOT NULL
   AND t.type IN ('income','expense')
   AND coalesce(t.status,'confirmed')='confirmed'
   AND coalesce(t.movement_kind,'transaction')='transaction'
   AND t.transfer_group_id IS NULL
   AND t.settles_card_id IS NULL
   AND t.shared_expense_id IS NULL
   AND a.alias_key = public.category_alias_key(coalesce(t.normalized_description,t.friendly_description,t.description,t.raw_description));

-- 2º: histórico exato do próprio usuário. Uma única categoria dominante precisa
-- representar pelo menos 90% das ocorrências do mesmo padrão.
WITH ranked_history AS (
  SELECT
    t.id AS transaction_id,
    dominant.category_id,
    dominant.matches,
    dominant.total_matches
  FROM public.transactions t
  JOIN LATERAL (
    SELECT
      h.category_id,
      count(*)::integer AS matches,
      sum(count(*)) OVER ()::integer AS total_matches
    FROM public.transactions h
    WHERE h.user_id=t.user_id
      AND h.category_id IS NOT NULL
      AND h.id<>t.id
      AND coalesce(h.movement_kind,'transaction')='transaction'
      AND public.category_alias_key(coalesce(h.normalized_description,h.friendly_description,h.description,h.raw_description)) =
          public.category_alias_key(coalesce(t.normalized_description,t.friendly_description,t.description,t.raw_description))
    GROUP BY h.category_id
    ORDER BY count(*) DESC
    LIMIT 1
  ) dominant ON dominant.total_matches > 0
               AND dominant.matches::numeric / dominant.total_matches::numeric >= 0.90
  WHERE t.category_id IS NULL
    AND t.type IN ('income','expense')
    AND coalesce(t.status,'confirmed')='confirmed'
    AND coalesce(t.movement_kind,'transaction')='transaction'
    AND t.transfer_group_id IS NULL
    AND t.settles_card_id IS NULL
    AND t.shared_expense_id IS NULL
)
UPDATE public.transactions t
   SET category_id = h.category_id,
       category_source = 'history',
       category_confidence = 0.95,
       category_reason = format('%s/%s lançamentos exatos anteriores na mesma categoria',h.matches,h.total_matches),
       updated_at = now()
  FROM ranked_history h
 WHERE t.id = h.transaction_id;

CREATE OR REPLACE FUNCTION public.tg_reconcile_memory_after_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category_name text;
  v_pattern text;
BEGIN
  IF NEW.category_id IS NULL OR NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN RETURN NEW; END IF;
  SELECT name INTO v_category_name FROM public.categories WHERE id=NEW.category_id;
  v_pattern := public.category_alias_key(coalesce(NEW.normalized_description,NEW.friendly_description,NEW.description,NEW.raw_description));
  IF v_category_name IS NULL OR length(v_pattern)<3 THEN RETURN NEW; END IF;

  UPDATE public.agent_memory
     SET value=jsonb_set(coalesce(value,'{}'::jsonb),'{category}',to_jsonb(v_category_name),true),
         confidence=greatest(confidence,0.85),
         updated_at=now()
   WHERE user_id=NEW.user_id
     AND kind='frequent_merchant'
     AND public.category_alias_key(key)=v_pattern;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_reconcile_memory_category ON public.transactions;
CREATE TRIGGER transactions_reconcile_memory_category
  AFTER UPDATE OF category_id ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_memory_after_category();

CREATE OR REPLACE FUNCTION public.reconcile_agent_memory_categories()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH resolved AS (
    SELECT
      m.id,
      (
        SELECT c.name
        FROM public.transactions t
        JOIN public.categories c ON c.id=t.category_id
        WHERE t.user_id=m.user_id
          AND t.category_id IS NOT NULL
          AND coalesce(t.movement_kind,'transaction')='transaction'
          AND public.category_alias_key(coalesce(t.normalized_description,t.friendly_description,t.description,t.raw_description)) = public.category_alias_key(m.key)
        ORDER BY t.user_edited_at DESC NULLS LAST,t.occurred_at DESC,t.updated_at DESC
        LIMIT 1
      ) AS category_name
    FROM public.agent_memory m
    WHERE m.kind='frequent_merchant'
  )
  UPDATE public.agent_memory m
     SET value=jsonb_set(coalesce(m.value,'{}'::jsonb),'{category}',to_jsonb(r.category_name),true),
         confidence=greatest(m.confidence,0.85),
         updated_at=now()
    FROM resolved r
   WHERE m.id=r.id AND r.category_name IS NOT NULL;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_agent_memory_categories() TO service_role;
SELECT public.reconcile_agent_memory_categories();

-- ============================================================================
-- 6. DICAS ANTIGAS — BACKFILL DE CHAVES, FEEDBACK E LIMPEZA DE REPETIÇÃO
-- ============================================================================

UPDATE public.user_insights
   SET family = coalesce(family, CASE
         WHEN type='categorize_transaction' THEN 'categorizacao'
         WHEN cta_route LIKE '/app/metas%' THEN 'metas'
         WHEN cta_route LIKE '/app/recorrencias%' THEN 'recorrencias'
         WHEN cta_route LIKE '/app/relatorios%' THEN 'evolucao'
         WHEN cta_route LIKE '/app/emocoes%' THEN 'emocoes'
         WHEN cta_route LIKE '/app/cartoes%' THEN 'gastos'
         WHEN cta_route LIKE '/app/lancamentos%' THEN 'gastos'
         ELSE 'geral'
       END),
       dedup_key = coalesce(dedup_key, CASE
         WHEN type='categorize_transaction' AND nullif(evidence->>'transaction_id','') IS NOT NULL
           THEN 'categorize:' || (evidence->>'transaction_id')
         ELSE coalesce(type,'tip') || ':' || md5(coalesce(title,'') || '|' || coalesce(cta_route,''))
       END)
 WHERE family IS NULL OR dedup_key IS NULL;

INSERT INTO public.communication_feedback(user_id,source_table,source_id,kind,family,dedup_key,feedback,created_at)
SELECT
  user_id,'user_insights',id,coalesce(type,'tip'),family,dedup_key,feedback,generated_at
FROM public.user_insights
WHERE feedback IN ('useful','not_useful','dismissed','acted')
ON CONFLICT DO NOTHING;

WITH ranked AS (
  SELECT id,row_number() OVER (
    PARTITION BY user_id,dedup_key
    ORDER BY generated_at DESC,id DESC
  ) AS position
  FROM public.user_insights
  WHERE status='active' AND dedup_key IS NOT NULL
)
UPDATE public.user_insights insight
   SET status='dismissed'
  FROM ranked
 WHERE insight.id=ranked.id AND ranked.position>1;

UPDATE public.user_insights
   SET status='dismissed'
 WHERE status='active' AND expires_at<=now();

-- Mark old technical review memories internal (idempotent cleanup).
UPDATE public.agent_memory
   SET visibility='internal',updated_at=now()
 WHERE kind='advisor_review' OR key ~ '^(weekly|monthly):';
