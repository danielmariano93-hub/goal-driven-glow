-- Onda 0 + Onda 1 — Snapshot, feature flags, credit card bill payment
-- support, and FastLog orphan sweep.

ALTER TABLE public.financial_feature_flags
  ADD COLUMN IF NOT EXISTS use_wave1_bill_payment boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS use_v2_artifact_normalizer boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.wave1_pre_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at timestamptz NOT NULL DEFAULT now(),
  label text NOT NULL,
  total_runs int NOT NULL,
  running_runs int NOT NULL,
  total_txs int NOT NULL,
  bill_payments int NOT NULL
);
GRANT SELECT ON public.wave1_pre_snapshot TO authenticated;
GRANT ALL ON public.wave1_pre_snapshot TO service_role;
ALTER TABLE public.wave1_pre_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wave1_pre_snapshot admin read" ON public.wave1_pre_snapshot;
CREATE POLICY "wave1_pre_snapshot admin read" ON public.wave1_pre_snapshot
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.wave1_pre_snapshot (label, total_runs, running_runs, total_txs, bill_payments)
SELECT 'pre_wave1',
  (SELECT count(*)::int FROM public.agent_runs),
  (SELECT count(*)::int FROM public.agent_runs WHERE status='running'),
  (SELECT count(*)::int FROM public.transactions),
  (SELECT count(*)::int FROM public.transactions WHERE movement_kind='credit_card_bill_payment');

-- Extensão da agent_execute_confirmation via helper (branch novo).
-- Estratégia: criar função auxiliar que trata o kind extra e um wrapper que
-- delega para a original quando o kind não é 'credit_card_bill_payment'.
CREATE OR REPLACE FUNCTION public._exec_credit_card_bill_payment(c public.pending_confirmations)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  p jsonb := c.payload;
  new_txn uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts
     WHERE id = (p->>'account_id')::uuid AND user_id = c.user_id AND active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_not_owned');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.credit_cards
     WHERE id = (p->>'settles_card_id')::uuid AND user_id = c.user_id AND active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'card_not_owned');
  END IF;
  INSERT INTO public.transactions(
    user_id, account_id, credit_card_id, settles_card_id,
    category_id, type, status, amount, occurred_at, description,
    payment_method, movement_kind
  ) VALUES (
    c.user_id,
    (p->>'account_id')::uuid,
    NULL,
    (p->>'settles_card_id')::uuid,
    nullif(p->>'category_id','')::uuid,
    'expense'::public.transaction_type,
    'confirmed'::public.transaction_status,
    (p->>'amount')::numeric,
    coalesce((p->>'occurred_at')::date, current_date),
    coalesce(nullif(p->>'description',''), 'Pagamento da fatura do cartão'),
    'account',
    'credit_card_bill_payment'
  ) RETURNING id INTO new_txn;
  RETURN jsonb_build_object(
    'kind','credit_card_bill_payment',
    'transaction_id', new_txn,
    'account_id', p->>'account_id',
    'settles_card_id', p->>'settles_card_id',
    'amount', p->>'amount'
  );
END $fn$;

REVOKE ALL ON FUNCTION public._exec_credit_card_bill_payment(public.pending_confirmations) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exec_credit_card_bill_payment(public.pending_confirmations) TO service_role;

-- Renomear a atual agent_execute_confirmation para _legacy e recriar wrapper.
DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'agent_execute_confirmation_legacy_v1'
       AND pronamespace = 'public'::regnamespace
  ) THEN
    -- já migrado
    RETURN;
  END IF;
  ALTER FUNCTION public.agent_execute_confirmation(uuid, uuid)
    RENAME TO agent_execute_confirmation_legacy_v1;
END $mig$;

CREATE OR REPLACE FUNCTION public.agent_execute_confirmation(
  p_confirmation_id uuid,
  p_source_message_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $wrap$
DECLARE
  c public.pending_confirmations;
  r jsonb;
BEGIN
  SELECT * INTO c FROM public.pending_confirmations
    WHERE id = p_confirmation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF c.status = 'confirmed' AND c.result_snapshot IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'result', c.result_snapshot);
  END IF;
  IF c.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cancelled');
  END IF;
  IF c.status = 'expired' OR c.expires_at < now() THEN
    UPDATE public.pending_confirmations SET status = 'expired'
      WHERE id = c.id AND status = 'pending';
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF c.kind = 'credit_card_bill_payment' THEN
    r := public._exec_credit_card_bill_payment(c);
    IF (r->>'ok') = 'false' THEN
      RETURN r;
    END IF;
    UPDATE public.pending_confirmations
       SET status = 'confirmed', executed_at = now(),
           result_snapshot = r,
           confirmed_from_message_id = p_source_message_id
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'result', r);
  END IF;

  -- Delega para o legado para todos os demais kinds. A row já está
  -- travada por FOR UPDATE nesta transação; a chamada legacy repete o
  -- select (SECURITY DEFINER, mesmo escopo) e finaliza normalmente.
  RETURN public.agent_execute_confirmation_legacy_v1(p_confirmation_id, p_source_message_id);
END $wrap$;

REVOKE ALL ON FUNCTION public.agent_execute_confirmation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_execute_confirmation(uuid, uuid) TO authenticated, service_role;

-- FastLog / agent_runs orphan sweep.
CREATE OR REPLACE FUNCTION public.sweep_orphan_agent_runs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE n int;
BEGIN
  UPDATE public.agent_runs
     SET status = 'error',
         ended_at = now(),
         error_sanitized = coalesce(error_sanitized, 'orphan_sweep:running_over_5min'),
         error_masked    = coalesce(error_masked,    'orphan_sweep:running_over_5min')
   WHERE status = 'running'
     AND started_at < now() - interval '5 minutes';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

REVOKE ALL ON FUNCTION public.sweep_orphan_agent_runs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_orphan_agent_runs() TO service_role;

DO $cron$
DECLARE existing_job int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'agent-runs-orphan-sweep-5m';
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
  PERFORM cron.schedule(
    'agent-runs-orphan-sweep-5m',
    '*/5 * * * *',
    'SELECT public.sweep_orphan_agent_runs()'
  );
END $cron$;

SELECT public.sweep_orphan_agent_runs();