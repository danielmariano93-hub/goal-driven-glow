ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS category_review_status text NOT NULL DEFAULT 'resolved',
  ADD COLUMN IF NOT EXISTS category_engine_version text,
  ADD COLUMN IF NOT EXISTS category_classified_at timestamptz,
  ADD COLUMN IF NOT EXISTS category_decision_id uuid;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_category_review_status_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_category_review_status_check
  CHECK (category_review_status IN ('resolved','suggested','needs_review','excluded'));

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_category_source_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_category_source_check
  CHECK (category_source IS NULL OR category_source IN ('user','alias','history','rule','llm','none','legacy','import','document_hint','engine'));

UPDATE public.transactions
SET category_review_status = CASE
  WHEN category_id IS NOT NULL THEN 'resolved'
  WHEN type IN ('income','expense') AND coalesce(movement_kind,'transaction')='transaction' THEN 'needs_review'
  ELSE 'excluded'
END
WHERE category_review_status = 'resolved' AND category_id IS NULL;

CREATE INDEX IF NOT EXISTS transactions_category_review_idx
  ON public.transactions(user_id, category_review_status, occurred_at DESC)
  WHERE category_review_status IN ('suggested','needs_review');

CREATE TABLE public.category_engine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  mode text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  engine_version text NOT NULL DEFAULT 'categorization_contract.v1',
  dry_run boolean NOT NULL DEFAULT false,
  total_items integer NOT NULL DEFAULT 0,
  processed_items integer NOT NULL DEFAULT 0,
  auto_applied integer NOT NULL DEFAULT 0,
  suggested integer NOT NULL DEFAULT 0,
  unresolved integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT category_engine_runs_mode_check CHECK (mode IN ('live','backfill')),
  CONSTRAINT category_engine_runs_status_check CHECK (status IN ('queued','running','completed','failed','cancelled'))
);
GRANT SELECT ON public.category_engine_runs TO authenticated;
GRANT ALL ON public.category_engine_runs TO service_role;
ALTER TABLE public.category_engine_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own category runs" ON public.category_engine_runs
  FOR SELECT TO authenticated USING (user_id=auth.uid());

CREATE INDEX category_engine_runs_user_idx ON public.category_engine_runs(user_id, created_at DESC);

CREATE TABLE public.category_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.category_engine_runs(id) ON DELETE SET NULL,
  previous_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  decided_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  source text NOT NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 0,
  reason_code text NOT NULL,
  reason text,
  engine_version text NOT NULL DEFAULT 'categorization_contract.v1',
  action text NOT NULL,
  mode text NOT NULL DEFAULT 'live',
  actor text NOT NULL DEFAULT 'engine',
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_fingerprint text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT category_decisions_source_check CHECK (source IN ('user','alias','history','rule','llm','none','legacy','import','document_hint','engine')),
  CONSTRAINT category_decisions_action_check CHECK (action IN ('auto_apply','suggest_review','leave_unresolved','preserve','exclude')),
  CONSTRAINT category_decisions_mode_check CHECK (mode IN ('live','backfill')),
  CONSTRAINT category_decisions_actor_check CHECK (actor IN ('engine','user','system')),
  CONSTRAINT category_decisions_confidence_check CHECK (confidence>=0 AND confidence<=1)
);
GRANT SELECT ON public.category_decisions TO authenticated;
GRANT ALL ON public.category_decisions TO service_role;
ALTER TABLE public.category_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own category decisions" ON public.category_decisions
  FOR SELECT TO authenticated USING (user_id=auth.uid());

CREATE INDEX category_decisions_tx_idx ON public.category_decisions(transaction_id, created_at DESC);
CREATE INDEX category_decisions_user_idx ON public.category_decisions(user_id, created_at DESC);

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_category_decision_id_fkey;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_category_decision_id_fkey
  FOREIGN KEY (category_decision_id) REFERENCES public.category_decisions(id) ON DELETE SET NULL;

CREATE TABLE public.category_classification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT category_queue_status_check CHECK (status IN ('queued','processing','completed','failed')),
  UNIQUE(transaction_id)
);
GRANT SELECT ON public.category_classification_queue TO authenticated;
GRANT ALL ON public.category_classification_queue TO service_role;
ALTER TABLE public.category_classification_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own categorization queue" ON public.category_classification_queue
  FOR SELECT TO authenticated USING (user_id=auth.uid());

CREATE INDEX category_queue_ready_idx ON public.category_classification_queue(status, available_at) WHERE status IN ('queued','failed');

CREATE OR REPLACE FUNCTION public.enqueue_transaction_categorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.category_id IS NULL
     AND NEW.type IN ('income','expense')
     AND coalesce(NEW.movement_kind,'transaction')='transaction'
     AND coalesce(NEW.status,'confirmed')='confirmed'
  THEN
    NEW.category_review_status := 'needs_review';
    INSERT INTO public.category_classification_queue(user_id,transaction_id,status,available_at,updated_at)
    VALUES(NEW.user_id,NEW.id,'queued',now(),now())
    ON CONFLICT(transaction_id) DO UPDATE SET
      status='queued', available_at=now(), last_error=NULL, updated_at=now()
      WHERE public.category_classification_queue.status <> 'processing';
  ELSIF NEW.category_id IS NOT NULL THEN
    NEW.category_review_status := 'resolved';
  ELSE
    NEW.category_review_status := 'excluded';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS transactions_enqueue_categorization ON public.transactions;
CREATE TRIGGER transactions_enqueue_categorization
  BEFORE INSERT OR UPDATE OF category_id,description,friendly_description,normalized_description,type,movement_kind,status
  ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.enqueue_transaction_categorization();

INSERT INTO public.category_classification_queue(user_id,transaction_id,status)
SELECT user_id,id,'queued' FROM public.transactions
WHERE category_id IS NULL AND type IN ('income','expense')
  AND coalesce(movement_kind,'transaction')='transaction'
  AND coalesce(status,'confirmed')='confirmed'
ON CONFLICT(transaction_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_category_engine_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TRIGGER category_engine_runs_updated BEFORE UPDATE ON public.category_engine_runs
FOR EACH ROW EXECUTE FUNCTION public.set_category_engine_updated_at();
CREATE TRIGGER category_queue_updated BEFORE UPDATE ON public.category_classification_queue
FOR EACH ROW EXECUTE FUNCTION public.set_category_engine_updated_at();