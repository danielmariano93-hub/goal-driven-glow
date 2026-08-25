-- Nino AI cost containment + category semantic idempotency
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$ BEGIN
  CREATE TYPE public.ai_workload AS ENUM (
    'AGENT_CONVERSATION',
    'CATEGORY_BACKGROUND',
    'CATEGORY_ONDEMAND',
    'DOCUMENT_INGEST',
    'PROACTIVE',
    'INSIGHTS',
    'ADVISOR_REPORTS',
    'AUDIO_TRANSCRIPTION_APP',
    'AUDIO_TRANSCRIPTION_WHATSAPP',
    'ANTICIPATION',
    'OTHER_AI'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.ai_usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  workload public.ai_workload NOT NULL,
  function_name text NOT NULL,
  operation text NOT NULL DEFAULT 'unknown',
  user_id uuid,
  run_id text,
  model text,
  provider text NOT NULL DEFAULT 'lovable_ai',
  operation_type text NOT NULL DEFAULT 'chat',
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cached_tokens integer NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0),
  estimated_cost_usd numeric(12,6),
  provider_cost_usd numeric(12,6),
  success boolean NOT NULL DEFAULT true,
  http_status integer,
  error_code text,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  batch_size integer NOT NULL DEFAULT 1 CHECK (batch_size >= 0),
  unique_items integer NOT NULL DEFAULT 1 CHECK (unique_items >= 0),
  idempotency_key text,
  retry_number integer NOT NULL DEFAULT 0 CHECK (retry_number >= 0),
  reason_for_ai_call text,
  prompt_hash text,
  payload_bytes integer CHECK (payload_bytes IS NULL OR payload_bytes >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_usage_ledger TO authenticated;
GRANT ALL ON public.ai_usage_ledger TO service_role;
ALTER TABLE public.ai_usage_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own AI usage ledger" ON public.ai_usage_ledger;
CREATE POLICY "Users view own AI usage ledger" ON public.ai_usage_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS ai_usage_ledger_workload_time_idx ON public.ai_usage_ledger(workload, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_ledger_user_time_idx ON public.ai_usage_ledger(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_ledger_idempotency_idx ON public.ai_usage_ledger(workload, idempotency_key, occurred_at DESC) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ai_workload_budgets (
  workload public.ai_workload PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  max_ai_calls_per_hour integer NOT NULL DEFAULT 60 CHECK (max_ai_calls_per_hour >= 0),
  max_ai_calls_per_day integer NOT NULL DEFAULT 500 CHECK (max_ai_calls_per_day >= 0),
  max_estimated_cost_per_hour numeric(12,6) NOT NULL DEFAULT 1 CHECK (max_estimated_cost_per_hour >= 0),
  max_estimated_cost_per_day numeric(12,6) NOT NULL DEFAULT 5 CHECK (max_estimated_cost_per_day >= 0),
  max_items_per_run integer NOT NULL DEFAULT 50 CHECK (max_items_per_run >= 1),
  max_retries_per_evidence integer NOT NULL DEFAULT 1 CHECK (max_retries_per_evidence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.ai_workload_budgets TO authenticated;
GRANT ALL ON public.ai_workload_budgets TO service_role;
ALTER TABLE public.ai_workload_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view AI workload budgets" ON public.ai_workload_budgets;
CREATE POLICY "Admins view AI workload budgets" ON public.ai_workload_budgets
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER touch_ai_workload_budgets_updated_at
  BEFORE UPDATE ON public.ai_workload_budgets
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

CREATE TABLE IF NOT EXISTS public.ai_workload_circuits (
  workload public.ai_workload PRIMARY KEY,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paused')),
  blocked_status integer,
  requires text CHECK (requires IS NULL OR requires IN ('top_up','admin_action','rate_limit','budget','operator_action')),
  reason text,
  user_message text,
  paused_at timestamptz,
  resume_after timestamptz,
  last_probe_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_workload_circuits TO authenticated;
GRANT ALL ON public.ai_workload_circuits TO service_role;
ALTER TABLE public.ai_workload_circuits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view AI workload circuits" ON public.ai_workload_circuits;
CREATE POLICY "Admins view AI workload circuits" ON public.ai_workload_circuits
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER touch_ai_workload_circuits_updated_at
  BEFORE UPDATE ON public.ai_workload_circuits
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

INSERT INTO public.ai_workload_budgets(workload, enabled, priority, max_ai_calls_per_hour, max_ai_calls_per_day, max_estimated_cost_per_hour, max_estimated_cost_per_day, max_items_per_run, max_retries_per_evidence)
VALUES
  ('AGENT_CONVERSATION', true, 10, 300, 2000, 2.000000, 15.000000, 20, 2),
  ('CATEGORY_BACKGROUND', true, 80, 20, 80, 0.100000, 0.500000, 25, 1),
  ('CATEGORY_ONDEMAND', true, 40, 60, 200, 0.300000, 1.000000, 25, 1),
  ('DOCUMENT_INGEST', true, 50, 40, 120, 1.000000, 4.000000, 20, 1),
  ('PROACTIVE', true, 70, 30, 200, 0.300000, 1.000000, 50, 1),
  ('INSIGHTS', true, 70, 30, 200, 0.300000, 1.000000, 50, 1),
  ('ADVISOR_REPORTS', true, 60, 20, 80, 0.500000, 2.000000, 10, 1),
  ('AUDIO_TRANSCRIPTION_APP', true, 30, 120, 500, 0.500000, 2.000000, 1, 1),
  ('AUDIO_TRANSCRIPTION_WHATSAPP', true, 35, 120, 500, 0.500000, 2.000000, 1, 1),
  ('ANTICIPATION', true, 70, 20, 120, 0.200000, 0.800000, 50, 1),
  ('OTHER_AI', true, 100, 20, 100, 0.200000, 1.000000, 10, 1)
ON CONFLICT (workload) DO NOTHING;

INSERT INTO public.ai_workload_circuits(workload, status)
SELECT unnest(enum_range(NULL::public.ai_workload)), 'open'
ON CONFLICT (workload) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.category_classification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  evidence_hash text NOT NULL,
  engine_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','resolved','suggested','needs_review_until_new_evidence','technical_failed')),
  action text NOT NULL CHECK (action IN ('auto_apply','suggest_review','leave_unresolved','preserve','exclude','technical_failed')),
  source text NOT NULL DEFAULT 'none',
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  decision_id uuid REFERENCES public.category_decisions(id) ON DELETE SET NULL,
  prompt_hash text,
  ai_attempted boolean NOT NULL DEFAULT false,
  retryable boolean NOT NULL DEFAULT false,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  terminal_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_attempted_at timestamptz NOT NULL DEFAULT now(),
  last_attempted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(transaction_id, evidence_hash, engine_version)
);
GRANT SELECT ON public.category_classification_attempts TO authenticated;
GRANT ALL ON public.category_classification_attempts TO service_role;
ALTER TABLE public.category_classification_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own category classification attempts" ON public.category_classification_attempts;
CREATE POLICY "Users view own category classification attempts" ON public.category_classification_attempts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS category_attempts_user_status_idx ON public.category_classification_attempts(user_id, status, last_attempted_at DESC);
CREATE INDEX IF NOT EXISTS category_attempts_evidence_idx ON public.category_classification_attempts(evidence_hash, engine_version, status);
CREATE TRIGGER touch_category_classification_attempts_updated_at
  BEFORE UPDATE ON public.category_classification_attempts
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

CREATE TABLE IF NOT EXISTS public.category_ai_inference_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('income','expense')),
  merchant_key text NOT NULL,
  semantic_context_hash text NOT NULL,
  engine_version text NOT NULL,
  prompt_hash text,
  model text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  status text NOT NULL CHECK (status IN ('suggested','needs_review_until_new_evidence','invalid_output','technical_failed')),
  reason text,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_usd numeric(12,6),
  expires_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, transaction_type, merchant_key, semantic_context_hash, engine_version)
);
GRANT SELECT ON public.category_ai_inference_cache TO authenticated;
GRANT ALL ON public.category_ai_inference_cache TO service_role;
ALTER TABLE public.category_ai_inference_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own category AI cache" ON public.category_ai_inference_cache;
CREATE POLICY "Users view own category AI cache" ON public.category_ai_inference_cache
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS category_ai_cache_lookup_idx ON public.category_ai_inference_cache(user_id, transaction_type, merchant_key, semantic_context_hash, engine_version, expires_at DESC);
CREATE TRIGGER touch_category_ai_inference_cache_updated_at
  BEFORE UPDATE ON public.category_ai_inference_cache
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

ALTER TABLE public.category_classification_queue
  ADD COLUMN IF NOT EXISTS evidence_hash text,
  ADD COLUMN IF NOT EXISTS terminal_reason text,
  ADD COLUMN IF NOT EXISTS last_semantic_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS semantic_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_reason text;

CREATE INDEX IF NOT EXISTS category_queue_evidence_idx ON public.category_classification_queue(evidence_hash, status) WHERE evidence_hash IS NOT NULL;

ALTER TABLE public.category_decisions
  ADD COLUMN IF NOT EXISTS ai_attempted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_hash text,
  ADD COLUMN IF NOT EXISTS prompt_hash text;
CREATE INDEX IF NOT EXISTS category_decisions_evidence_idx ON public.category_decisions(transaction_id, evidence_hash, created_at DESC) WHERE evidence_hash IS NOT NULL;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_category_review_status_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_category_review_status_check
  CHECK (category_review_status IN ('resolved','suggested','needs_review','excluded','needs_review_until_new_evidence'));

CREATE OR REPLACE FUNCTION public.category_transaction_evidence_hash(_transaction_id uuid, _user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT encode(extensions.digest(concat_ws('|',
    t.user_id::text,
    t.id::text,
    t.type::text,
    lower(regexp_replace(coalesce(t.normalized_description, t.friendly_description, t.raw_description, t.description, ''), '\s+', ' ', 'g')),
    coalesce(t.movement_kind,'transaction'),
    coalesce(t.status::text,'confirmed'),
    coalesce(t.transfer_group_id::text,''),
    coalesce(t.settles_card_id::text,''),
    coalesce(t.shared_expense_id::text,''),
    'categorization_truth.v2'
  ), 'sha256'), 'hex')
  FROM public.transactions t
  WHERE t.id = _transaction_id AND t.user_id = _user_id;
$function$;
REVOKE ALL ON FUNCTION public.category_transaction_evidence_hash(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.category_transaction_evidence_hash(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.transaction_needs_categorization(_transaction_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tx AS (
    SELECT t.*, public.category_transaction_evidence_hash(t.id, t.user_id) AS evidence_hash
    FROM public.transactions t
    WHERE t.id = _transaction_id
      AND t.user_id = _user_id
      AND t.type IN ('income','expense')
      AND coalesce(t.movement_kind,'transaction') = 'transaction'
      AND coalesce(t.status::text,'confirmed') = 'confirmed'
      AND t.transfer_group_id IS NULL
      AND t.settles_card_id IS NULL
      AND t.shared_expense_id IS NULL
      AND NOT (
        t.category_id IS NOT NULL
        AND coalesce(t.category_source,'') IN ('user','personal','alias','history','global','rule')
      )
  )
  SELECT EXISTS (
    SELECT 1
    FROM tx
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.category_classification_attempts a
      WHERE a.transaction_id = tx.id
        AND a.user_id = tx.user_id
        AND a.evidence_hash = tx.evidence_hash
        AND a.engine_version = 'categorization_truth.v2'
        AND a.status IN ('resolved','suggested','needs_review_until_new_evidence')
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.transaction_needs_categorization(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transaction_needs_categorization(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_transaction_category_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.category_id IS NULL
     AND NEW.type IN ('income','expense')
     AND coalesce(NEW.movement_kind,'transaction')='transaction'
     AND coalesce(NEW.status,'confirmed')='confirmed'
  THEN
    IF TG_OP = 'UPDATE'
       AND OLD.category_review_status = 'needs_review_until_new_evidence'
       AND public.category_transaction_evidence_hash(NEW.id, NEW.user_id) = public.category_transaction_evidence_hash(OLD.id, OLD.user_id)
    THEN
      NEW.category_review_status := 'needs_review_until_new_evidence';
    ELSE
      NEW.category_review_status := coalesce(NEW.category_review_status, 'needs_review');
      IF NEW.category_review_status NOT IN ('suggested','needs_review_until_new_evidence') THEN
        NEW.category_review_status := 'needs_review';
      END IF;
    END IF;
  ELSIF NEW.category_id IS NOT NULL THEN
    NEW.category_review_status := 'resolved';
  ELSE
    NEW.category_review_status := 'excluded';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_transaction_categorization_after()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _new_hash text;
  _old_hash text;
BEGIN
  IF NEW.category_id IS NULL
     AND NEW.type IN ('income','expense')
     AND coalesce(NEW.movement_kind,'transaction')='transaction'
     AND coalesce(NEW.status,'confirmed')='confirmed'
     AND coalesce(NEW.category_source,'none') <> 'user'
  THEN
    _new_hash := public.category_transaction_evidence_hash(NEW.id, NEW.user_id);
    IF TG_OP = 'UPDATE' THEN
      _old_hash := public.category_transaction_evidence_hash(OLD.id, OLD.user_id);
      IF _new_hash IS NOT DISTINCT FROM _old_hash
         AND coalesce(NEW.category_review_status,'') IN ('needs_review_until_new_evidence','suggested')
      THEN
        RETURN NULL;
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.category_classification_attempts a
      WHERE a.transaction_id = NEW.id
        AND a.user_id = NEW.user_id
        AND a.evidence_hash = _new_hash
        AND a.engine_version = 'categorization_truth.v2'
        AND a.status IN ('resolved','suggested','needs_review_until_new_evidence')
    ) THEN
      INSERT INTO public.category_classification_queue(user_id,transaction_id,status,available_at,updated_at,evidence_hash,terminal_reason)
      VALUES(NEW.user_id,NEW.id,'queued',now(),now(),_new_hash,NULL)
      ON CONFLICT(transaction_id) DO UPDATE SET
        status = CASE WHEN public.category_classification_queue.evidence_hash IS DISTINCT FROM excluded.evidence_hash THEN 'queued' ELSE public.category_classification_queue.status END,
        available_at = CASE WHEN public.category_classification_queue.evidence_hash IS DISTINCT FROM excluded.evidence_hash THEN now() ELSE public.category_classification_queue.available_at END,
        last_error = CASE WHEN public.category_classification_queue.evidence_hash IS DISTINCT FROM excluded.evidence_hash THEN NULL ELSE public.category_classification_queue.last_error END,
        processed_at = CASE WHEN public.category_classification_queue.evidence_hash IS DISTINCT FROM excluded.evidence_hash THEN NULL ELSE public.category_classification_queue.processed_at END,
        terminal_reason = CASE WHEN public.category_classification_queue.evidence_hash IS DISTINCT FROM excluded.evidence_hash THEN NULL ELSE public.category_classification_queue.terminal_reason END,
        evidence_hash = excluded.evidence_hash,
        updated_at = now()
        WHERE public.category_classification_queue.status <> 'processing';
    END IF;
  ELSE
    UPDATE public.category_classification_queue
       SET status='completed', processed_at=now(), locked_at=NULL, terminal_reason='no_longer_eligible', updated_at=now()
     WHERE transaction_id=NEW.id AND status <> 'processing';
  END IF;
  RETURN NULL;
END $$;

DROP FUNCTION IF EXISTS public.claim_category_classification_batch(integer, uuid);
CREATE OR REPLACE FUNCTION public.claim_category_classification_batch(p_limit integer DEFAULT 100, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(queue_id uuid, transaction_id uuid, user_id uuid, type text, description text, movement_kind text, transfer_group_id uuid, settles_card_id uuid, shared_expense_id uuid, evidence_hash text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.category_classification_queue q
     SET status='failed', locked_at=NULL, available_at=now() + interval '5 minutes', last_error='stale_processing_lease', updated_at=now(), next_retry_reason='technical_retry'
   WHERE q.status='processing' AND q.locked_at < now()-interval '5 minutes';

  UPDATE public.category_classification_queue q
     SET status='completed', processed_at=now(), locked_at=NULL, last_error='no_longer_eligible', terminal_reason='no_longer_eligible', updated_at=now()
   WHERE q.status IN ('queued','failed','completed')
     AND (p_user_id IS NULL OR q.user_id=p_user_id)
     AND NOT public.transaction_needs_categorization(q.transaction_id, q.user_id);

  RETURN QUERY
  WITH eligible AS (
    SELECT q.id, public.category_transaction_evidence_hash(q.transaction_id, q.user_id) AS current_hash
    FROM public.category_classification_queue q
    WHERE q.status IN ('queued','failed')
      AND q.attempts < 5
      AND q.available_at <= now()
      AND (p_user_id IS NULL OR q.user_id=p_user_id)
      AND public.transaction_needs_categorization(q.transaction_id, q.user_id)
  ), picked AS (
    SELECT q.id, e.current_hash
    FROM public.category_classification_queue q
    JOIN eligible e ON e.id=q.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_classification_attempts a
      WHERE a.transaction_id=q.transaction_id
        AND a.user_id=q.user_id
        AND a.evidence_hash=e.current_hash
        AND a.engine_version='categorization_truth.v2'
        AND a.status IN ('resolved','suggested','needs_review_until_new_evidence')
    )
    ORDER BY q.available_at,q.created_at
    FOR UPDATE OF q SKIP LOCKED
    LIMIT greatest(1,least(coalesce(p_limit,100),500))
  ), locked AS (
    UPDATE public.category_classification_queue q
       SET status='processing', locked_at=now(), attempts=q.attempts+1, updated_at=now(), evidence_hash=p.current_hash, terminal_reason=NULL
      FROM picked p
     WHERE q.id=p.id
     RETURNING q.id,q.transaction_id,q.user_id,q.evidence_hash
  )
  SELECT l.id,t.id,t.user_id,t.type::text,
    coalesce(t.friendly_description,t.raw_description,t.description),
    t.movement_kind,t.transfer_group_id,t.settles_card_id,t.shared_expense_id,l.evidence_hash
  FROM locked l
  JOIN public.transactions t ON t.id=l.transaction_id AND t.user_id=l.user_id;
END $function$;
REVOKE ALL ON FUNCTION public.claim_category_classification_batch(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_category_classification_batch(integer, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ai_workload_budget_snapshot(_workload public.ai_workload)
 RETURNS TABLE(
  workload public.ai_workload,
  enabled boolean,
  circuit_status text,
  paused_reason text,
  calls_last_hour bigint,
  calls_today bigint,
  estimated_cost_last_hour numeric,
  estimated_cost_today numeric,
  max_ai_calls_per_hour integer,
  max_ai_calls_per_day integer,
  max_estimated_cost_per_hour numeric,
  max_estimated_cost_per_day numeric,
  max_items_per_run integer,
  max_retries_per_evidence integer,
  allowed boolean,
  block_reason text
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT * FROM public.ai_workload_budgets WHERE workload=_workload
  ), c AS (
    SELECT * FROM public.ai_workload_circuits WHERE workload=_workload
  ), u AS (
    SELECT
      count(*) FILTER (WHERE occurred_at >= now() - interval '1 hour') AS calls_last_hour,
      count(*) FILTER (WHERE occurred_at >= date_trunc('day', now())) AS calls_today,
      coalesce(sum(coalesce(estimated_cost_usd,0)) FILTER (WHERE occurred_at >= now() - interval '1 hour'),0)::numeric AS cost_last_hour,
      coalesce(sum(coalesce(estimated_cost_usd,0)) FILTER (WHERE occurred_at >= date_trunc('day', now())),0)::numeric AS cost_today
    FROM public.ai_usage_ledger
    WHERE workload=_workload
      AND success = true
  )
  SELECT
    b.workload,
    b.enabled,
    coalesce(c.status,'open') AS circuit_status,
    c.reason AS paused_reason,
    u.calls_last_hour,
    u.calls_today,
    u.cost_last_hour,
    u.cost_today,
    b.max_ai_calls_per_hour,
    b.max_ai_calls_per_day,
    b.max_estimated_cost_per_hour,
    b.max_estimated_cost_per_day,
    b.max_items_per_run,
    b.max_retries_per_evidence,
    (b.enabled AND coalesce(c.status,'open')='open'
      AND u.calls_last_hour < b.max_ai_calls_per_hour
      AND u.calls_today < b.max_ai_calls_per_day
      AND u.cost_last_hour < b.max_estimated_cost_per_hour
      AND u.cost_today < b.max_estimated_cost_per_day) AS allowed,
    CASE
      WHEN NOT b.enabled THEN 'disabled'
      WHEN coalesce(c.status,'open') <> 'open' THEN coalesce(c.reason,'circuit_paused')
      WHEN u.calls_last_hour >= b.max_ai_calls_per_hour THEN 'hourly_call_budget'
      WHEN u.calls_today >= b.max_ai_calls_per_day THEN 'daily_call_budget'
      WHEN u.cost_last_hour >= b.max_estimated_cost_per_hour THEN 'hourly_cost_budget'
      WHEN u.cost_today >= b.max_estimated_cost_per_day THEN 'daily_cost_budget'
      ELSE NULL
    END AS block_reason
  FROM b CROSS JOIN u LEFT JOIN c ON c.workload=b.workload;
$function$;
REVOKE ALL ON FUNCTION public.ai_workload_budget_snapshot(public.ai_workload) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_workload_budget_snapshot(public.ai_workload) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_ai_usage_summary(_days integer DEFAULT 7)
 RETURNS TABLE(
  day date,
  workload text,
  calls bigint,
  successful_calls bigint,
  input_tokens bigint,
  output_tokens bigint,
  estimated_cost_usd numeric,
  avg_latency_ms numeric,
  p95_latency_ms numeric
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    date_trunc('day', occurred_at)::date AS day,
    workload::text,
    count(*) AS calls,
    count(*) FILTER (WHERE success) AS successful_calls,
    coalesce(sum(input_tokens),0)::bigint AS input_tokens,
    coalesce(sum(output_tokens),0)::bigint AS output_tokens,
    coalesce(sum(coalesce(estimated_cost_usd,0)),0)::numeric AS estimated_cost_usd,
    avg(latency_ms)::numeric AS avg_latency_ms,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric AS p95_latency_ms
  FROM public.ai_usage_ledger
  WHERE occurred_at >= now() - make_interval(days => greatest(1, least(coalesce(_days,7), 365)))
    AND public.has_role(auth.uid(), 'admin')
  GROUP BY 1,2
  ORDER BY 1 DESC,2;
$function$;
REVOKE ALL ON FUNCTION public.admin_ai_usage_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_usage_summary(integer) TO authenticated, service_role;

-- Safe current-state sanitation: rows whose current evidence is already terminal stop being claimable.
UPDATE public.category_classification_queue q
   SET status='completed', processed_at=now(), locked_at=NULL, terminal_reason='terminal_attempt_exists', last_error=NULL, updated_at=now()
 WHERE EXISTS (
   SELECT 1 FROM public.category_classification_attempts a
   WHERE a.transaction_id=q.transaction_id
     AND a.user_id=q.user_id
     AND a.evidence_hash=public.category_transaction_evidence_hash(q.transaction_id,q.user_id)
     AND a.engine_version='categorization_truth.v2'
     AND a.status IN ('resolved','suggested','needs_review_until_new_evidence')
 );