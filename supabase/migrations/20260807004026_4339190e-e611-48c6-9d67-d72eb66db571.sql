-- Contrato temporal v1: a data contábil (`occurred_at`) nunca é reescrita.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS behavior_occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS behavioral_day date,
  ADD COLUMN IF NOT EXISTS behavior_date_source text,
  ADD COLUMN IF NOT EXISTS behavior_date_confidence numeric(4,3);

DO $$ BEGIN
  ALTER TABLE public.transactions ADD CONSTRAINT transactions_behavior_date_confidence_check
    CHECK (behavior_date_confidence IS NULL OR behavior_date_confidence BETWEEN 0 AND 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.transactions ADD CONSTRAINT transactions_behavior_date_source_check
    CHECK (behavior_date_source IS NULL OR behavior_date_source IN
      ('automation_timestamp','purchase_date','user_entered','recurring_schedule','bank_posting_date'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.resolve_transaction_behavior_date(_row public.transactions)
RETURNS TABLE(behavior_at timestamptz, behavior_day date, source text, confidence numeric)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE local_ts timestamptz; local_day date; local_hour int;
BEGIN
  IF _row.local_occurred_at IS NOT NULL THEN
    local_ts := _row.local_occurred_at;
    local_day := (local_ts AT TIME ZONE 'America/Sao_Paulo')::date;
    local_hour := extract(hour FROM local_ts AT TIME ZONE 'America/Sao_Paulo');
    IF local_hour < 4 AND extract(isodow FROM local_day)=6 THEN local_day := local_day - 1; END IF;
    RETURN QUERY SELECT local_ts, local_day, 'automation_timestamp'::text, 1.000::numeric;
    RETURN;
  END IF;
  IF _row.purchase_date IS NOT NULL THEN
    RETURN QUERY SELECT (_row.purchase_date::timestamp AT TIME ZONE 'America/Sao_Paulo'),
      _row.purchase_date, 'purchase_date'::text, .900::numeric;
    RETURN;
  END IF;
  IF _row.origin::text IN ('manual','agent','split') THEN
    RETURN QUERY SELECT (_row.occurred_at::timestamp AT TIME ZONE 'America/Sao_Paulo'),
      _row.occurred_at, 'user_entered'::text, .950::numeric;
    RETURN;
  END IF;
  IF _row.origin::text = 'recurring' THEN
    RETURN QUERY SELECT (_row.occurred_at::timestamp AT TIME ZONE 'America/Sao_Paulo'),
      _row.occurred_at, 'recurring_schedule'::text, .950::numeric;
    RETURN;
  END IF;
  RETURN QUERY SELECT (_row.occurred_at::timestamp AT TIME ZONE 'America/Sao_Paulo'),
    _row.occurred_at, 'bank_posting_date'::text, .350::numeric;
END $$;

CREATE OR REPLACE FUNCTION public.transactions_set_behavior_date()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.resolve_transaction_behavior_date(NEW);
  NEW.behavior_occurred_at := r.behavior_at;
  NEW.behavioral_day := r.behavior_day;
  NEW.behavior_date_source := r.source;
  NEW.behavior_date_confidence := r.confidence;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS transactions_behavior_date_trigger ON public.transactions;
CREATE TRIGGER transactions_behavior_date_trigger
BEFORE INSERT OR UPDATE OF occurred_at, local_occurred_at, purchase_date, origin
ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.transactions_set_behavior_date();

-- Backfill global, idempotente, sem trocar user_id nem apagar histórico.
CREATE OR REPLACE FUNCTION public.reprocess_transaction_behavior_dates(_batch_size integer DEFAULT 50000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE affected integer := 0;
BEGIN
  WITH candidates AS (
    SELECT id FROM public.transactions
  ), resolved AS (
    SELECT t.id, r.* FROM public.transactions t
    JOIN candidates c ON c.id=t.id
    CROSS JOIN LATERAL public.resolve_transaction_behavior_date(t) r
  )
  UPDATE public.transactions t SET
    behavior_occurred_at=r.behavior_at,
    behavioral_day=r.behavior_day,
    behavior_date_source=r.source,
    behavior_date_confidence=r.confidence
  FROM resolved r WHERE t.id=r.id AND (
    t.behavior_occurred_at IS DISTINCT FROM r.behavior_at OR
    t.behavioral_day IS DISTINCT FROM r.behavior_day OR
    t.behavior_date_source IS DISTINCT FROM r.source OR
    t.behavior_date_confidence IS DISTINCT FROM r.confidence
  );
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'updated',affected,'batch_size',_batch_size,
    'contract','transaction_behavior_date.v1');
END $$;
REVOKE ALL ON FUNCTION public.reprocess_transaction_behavior_dates(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reprocess_transaction_behavior_dates(integer) TO service_role;

SELECT public.reprocess_transaction_behavior_dates(250000);
CREATE INDEX IF NOT EXISTS transactions_user_behavioral_day_idx
  ON public.transactions(user_id, behavioral_day) WHERE behavior_date_confidence >= .65;

-- Rollout real para todos os usuários atuais e futuros. Sem allowlist pessoal.
ALTER TABLE public.agent_settings
  ALTER COLUMN anticipation_enabled SET DEFAULT true,
  ALTER COLUMN anticipation_dry_run SET DEFAULT false,
  ALTER COLUMN anticipation_rollout_pct SET DEFAULT 100,
  ALTER COLUMN anticipation_rollout_user_ids SET DEFAULT '{}'::uuid[];
UPDATE public.agent_settings SET
  anticipation_enabled=true,
  anticipation_dry_run=false,
  anticipation_rollout_pct=100,
  anticipation_rollout_user_ids='{}'::uuid[],
  proactive_enabled=true,
  proactive_rollout_user_ids='{}'::uuid[]
WHERE id=1;

-- Executor do rascunho de rolê. Reutiliza split_create_v2.
CREATE OR REPLACE FUNCTION public.agent_execute_shared_expense_confirmation(
  p_confirmation_id uuid, p_source_message_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.pending_confirmations; p jsonb; new_id uuid; result jsonb;
BEGIN
  SELECT * INTO c FROM public.pending_confirmations WHERE id=p_confirmation_id FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  IF c.status='confirmed' AND c.result_snapshot IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'result',c.result_snapshot);
  END IF;
  IF c.status<>'pending' OR c.expires_at<now() OR c.kind<>'shared_expense' THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_or_expired');
  END IF;
  PERFORM set_config('request.jwt.claim.sub', c.user_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',c.user_id,'role','authenticated')::text, true);
  p := c.payload;
  SELECT public.split_create_v2(
    p->>'title', (p->>'total')::numeric, (p->>'occurred_at')::date,
    nullif(p->>'due_date','')::date, coalesce(p->>'split_mode','equal')::public.split_mode,
    coalesce((p->>'include_owner')::boolean,true), coalesce((p->>'reminder_enabled')::boolean,false),
    nullif(p->>'pix_key',''), coalesce(p->'participants','[]'::jsonb),
    nullif(p->>'owner_amount','')::numeric, nullif(p->>'source_account_id','')::uuid,
    nullif(p->>'source_credit_card_id','')::uuid, nullif(p->>'reimbursement_account_id','')::uuid,
    nullif(p->>'category_id','')::uuid, true
  ) INTO new_id;
  result := jsonb_build_object('kind','shared_expense','shared_expense_id',new_id,'title',p->>'title','total',p->>'total');
  UPDATE public.pending_confirmations SET status='confirmed',executed_at=now(),
    result_snapshot=result,confirmed_from_message_id=p_source_message_id WHERE id=c.id;
  RETURN jsonb_build_object('ok',true,'idempotent',false,'result',result);
END $$;
REVOKE ALL ON FUNCTION public.agent_execute_shared_expense_confirmation(uuid,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_execute_shared_expense_confirmation(uuid,uuid) TO service_role;

COMMENT ON COLUMN public.transactions.behavioral_day IS
  'Dia usado somente em análises comportamentais; occurred_at permanece a data contábil.';