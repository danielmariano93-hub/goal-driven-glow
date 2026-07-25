-- ============================================================
-- Onda 1+2+3 (backend foundation)
-- 1. Wave1 idempotency
-- 2. commit_movement RPC
-- 3. v_client_universe
-- ============================================================

-- ---------- 1. Wave1 hardening ----------
DROP TRIGGER IF EXISTS trg_transactions_fill_competence_date ON public.transactions;
CREATE TRIGGER trg_transactions_fill_competence_date
  BEFORE INSERT OR UPDATE OF credit_card_id, occurred_at ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.transactions_fill_competence_date();

CREATE INDEX IF NOT EXISTS agent_runs_status_started_idx
  ON public.agent_runs (status, started_at);

-- Restringir funções privilegiadas
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='_exec_credit_card_bill_payment') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public._exec_credit_card_bill_payment(public.pending_confirmations) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public._exec_credit_card_bill_payment(public.pending_confirmations) TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='sweep_orphan_agent_runs') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.sweep_orphan_agent_runs() FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sweep_orphan_agent_runs() TO service_role';
  END IF;
END $$;

-- Feature flag de rollback para commit_movement
ALTER TABLE public.financial_feature_flags
  ADD COLUMN IF NOT EXISTS use_commit_movement_rpc boolean NOT NULL DEFAULT true;

-- ---------- 2. commit_movement RPC ----------
-- Contrato do payload (jsonb):
-- {
--   movement_kind: 'income'|'expense'|'transfer'|'credit_card_bill_payment'|'investment_movement',
--   amount: numeric > 0,
--   occurred_at: date,
--   description: text,
--   category_id: uuid (opcional),
--   account_id: uuid (obrigatório exceto compra em cartão),
--   credit_card_id: uuid (opcional; obrigatório se compra em cartão),
--   settles_card_id: uuid (obrigatório em credit_card_bill_payment),
--   payment_method: text,
--   idempotency_key: text (opcional),
--   emotion: text (opcional),
--   installments_total: int (opcional),
--   notes: text (opcional)
-- }
CREATE OR REPLACE FUNCTION public.commit_movement(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text;
  v_amount numeric;
  v_date date;
  v_desc text;
  v_account uuid;
  v_card uuid;
  v_settles uuid;
  v_category uuid;
  v_method text;
  v_idem text;
  v_txn_id uuid;
  v_row public.transactions%ROWTYPE;
  v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  v_kind := payload->>'movement_kind';
  IF v_kind IS NULL OR v_kind NOT IN ('income','expense','transfer','credit_card_bill_payment','investment_movement') THEN
    RAISE EXCEPTION 'invalid_movement_kind:%', coalesce(v_kind,'null');
  END IF;

  -- amount
  BEGIN
    v_amount := (payload->>'amount')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_amount';
  END;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive';
  END IF;

  -- date
  BEGIN
    v_date := (payload->>'occurred_at')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_date';
  END;
  IF v_date IS NULL THEN
    RAISE EXCEPTION 'occurred_at_required';
  END IF;

  v_desc := nullif(payload->>'description','');
  IF v_desc IS NULL THEN
    RAISE EXCEPTION 'description_required';
  END IF;

  -- UUIDs (cast defensivo)
  BEGIN
    v_account := nullif(payload->>'account_id','')::uuid;
    v_card := nullif(payload->>'credit_card_id','')::uuid;
    v_settles := nullif(payload->>'settles_card_id','')::uuid;
    v_category := nullif(payload->>'category_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_uuid';
  END;

  -- Rejeita nomes não canônicos
  IF payload ? 'from1_account' OR payload ? 'from_account' THEN
    RAISE EXCEPTION 'unknown_property_use_account_id';
  END IF;

  v_method := coalesce(nullif(payload->>'payment_method',''), 'account');
  v_idem := nullif(payload->>'idempotency_key','');

  -- Ownership: account
  IF v_account IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = v_account AND user_id = v_uid AND coalesce(active,true) = true) THEN
      RAISE EXCEPTION 'account_not_found_or_inactive';
    END IF;
  END IF;
  -- Ownership: card
  IF v_card IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.credit_cards WHERE id = v_card AND user_id = v_uid) THEN
      RAISE EXCEPTION 'card_not_found';
    END IF;
  END IF;
  IF v_settles IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.credit_cards WHERE id = v_settles AND user_id = v_uid) THEN
      RAISE EXCEPTION 'settles_card_not_found';
    END IF;
  END IF;

  -- Regras por kind
  IF v_kind = 'credit_card_bill_payment' THEN
    IF v_settles IS NULL THEN RAISE EXCEPTION 'settles_card_id_required'; END IF;
    IF v_account IS NULL THEN RAISE EXCEPTION 'account_id_required'; END IF;
    v_card := NULL;
    v_method := 'account';
  ELSIF v_kind = 'expense' AND v_card IS NOT NULL THEN
    -- compra no cartão: account_id não é obrigatório
    NULL;
  ELSIF v_kind IN ('income','expense','transfer') THEN
    IF v_account IS NULL AND v_card IS NULL THEN
      RAISE EXCEPTION 'account_id_or_card_required';
    END IF;
  END IF;

  -- Idempotência
  IF v_idem IS NOT NULL THEN
    SELECT resource_id INTO v_existing
      FROM public.idempotency_keys
      WHERE user_id = v_uid AND key = v_idem AND scope = 'commit_movement'
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      SELECT * INTO v_row FROM public.transactions WHERE id = v_existing;
      IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'transaction', row_to_json(v_row));
      END IF;
    END IF;
  END IF;

  -- Insert
  INSERT INTO public.transactions (
    user_id, type, amount, occurred_at, description,
    account_id, credit_card_id, settles_card_id, category_id,
    movement_kind, payment_method, origin, status
  )
  VALUES (
    v_uid,
    CASE v_kind
      WHEN 'income' THEN 'income'::transaction_type
      WHEN 'transfer' THEN 'transfer'::transaction_type
      ELSE 'expense'::transaction_type
    END,
    v_amount, v_date, v_desc,
    v_account, v_card, v_settles, v_category,
    v_kind, v_method, 'manual'::txn_origin, 'confirmed'::transaction_status
  )
  RETURNING id INTO v_txn_id;

  IF v_idem IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (user_id, key, scope, resource_id)
    VALUES (v_uid, v_idem, 'commit_movement', v_txn_id)
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT * INTO v_row FROM public.transactions WHERE id = v_txn_id;
  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false, 'transaction', row_to_json(v_row));
END $$;

REVOKE ALL ON FUNCTION public.commit_movement(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_movement(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_movement(jsonb) TO service_role;

-- ---------- 3. v_client_universe ----------
CREATE OR REPLACE VIEW public.v_client_universe AS
SELECT u.id AS user_id, u.created_at
  FROM auth.users u
 WHERE NOT EXISTS (
   SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = u.id
 );

REVOKE ALL ON public.v_client_universe FROM PUBLIC;
REVOKE ALL ON public.v_client_universe FROM anon;
REVOKE ALL ON public.v_client_universe FROM authenticated;
GRANT SELECT ON public.v_client_universe TO service_role;

-- Snapshot pós-onda
INSERT INTO public.wave1_pre_snapshot (label, total_runs, running_runs, total_txs, bill_payments)
SELECT 'wave2_foundation_' || to_char(now(),'YYYYMMDD_HH24MI'),
       (SELECT count(*) FROM public.agent_runs),
       (SELECT count(*) FROM public.agent_runs WHERE status='running'),
       (SELECT count(*) FROM public.transactions),
       (SELECT count(*) FROM public.transactions WHERE movement_kind='credit_card_bill_payment');