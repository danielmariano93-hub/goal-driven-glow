-- P0 — Verdade de caixa bancária: correção auditável, vínculo de estorno e
-- conciliação de extrato. Nada é apagado; tudo é versionado e auditado.

ALTER TYPE public.transaction_status ADD VALUE IF NOT EXISTS 'superseded';

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supersede_reason text,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_of_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refund_link_method text,
  ADD COLUMN IF NOT EXISTS refund_link_confidence numeric(4,3);

CREATE INDEX IF NOT EXISTS transactions_refund_of_idx
  ON public.transactions(user_id, refund_of_transaction_id)
  WHERE refund_of_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transactions_superseded_by_idx
  ON public.transactions(user_id, superseded_by)
  WHERE superseded_by IS NOT NULL;

-- Auditoria de toda correção contábil (inclui exclusões).
CREATE TABLE IF NOT EXISTS public.ledger_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  correction_kind text NOT NULL,
  transaction_id uuid,
  related_transaction_id uuid,
  document_id uuid,
  account_id uuid,
  amount_before numeric(14,2),
  amount_after numeric(14,2),
  cash_impact numeric(14,2) NOT NULL DEFAULT 0,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_before jsonb,
  actor_id uuid,
  contract_version text NOT NULL DEFAULT 'ledger_correction.v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ledger_corrections TO authenticated;
GRANT ALL ON public.ledger_corrections TO service_role;
ALTER TABLE public.ledger_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger_corrections_select_own" ON public.ledger_corrections;
CREATE POLICY "ledger_corrections_select_own" ON public.ledger_corrections
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS ledger_corrections_user_created_idx
  ON public.ledger_corrections(user_id, created_at DESC);

DROP TRIGGER IF EXISTS ledger_corrections_touch ON public.ledger_corrections;
CREATE TRIGGER ledger_corrections_touch BEFORE UPDATE ON public.ledger_corrections
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- Estorno nunca pode exceder a despesa vinculada (guard de reversão).
CREATE OR REPLACE FUNCTION public.enforce_refund_link_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original public.transactions%ROWTYPE;
  v_linked numeric(14,2);
BEGIN
  IF NEW.refund_of_transaction_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.type <> 'income' THEN
    RAISE EXCEPTION 'refund_link_requires_income' USING ERRCODE = '22023';
  END IF;
  IF NEW.refund_of_transaction_id = NEW.id THEN
    RAISE EXCEPTION 'refund_link_self_reference' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_original FROM public.transactions
   WHERE id = NEW.refund_of_transaction_id AND user_id = NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_original_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_original.type <> 'expense' THEN
    RAISE EXCEPTION 'refund_original_not_expense' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_linked
    FROM public.transactions
   WHERE user_id = NEW.user_id
     AND refund_of_transaction_id = NEW.refund_of_transaction_id
     AND id <> NEW.id
     AND coalesce(status::text, 'confirmed') <> 'superseded';

  IF round(v_linked + NEW.amount, 2) > round(v_original.amount, 2) + 0.005 THEN
    RAISE EXCEPTION 'refund_exceeds_original' USING ERRCODE = '22023',
      DETAIL = format('original=%s linked=%s incoming=%s', v_original.amount, v_linked, NEW.amount);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS transactions_refund_link_guard ON public.transactions;
CREATE TRIGGER transactions_refund_link_guard
  BEFORE INSERT OR UPDATE OF refund_of_transaction_id, amount, type ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_refund_link_integrity();

-- Exclusão de lançamento nunca pode ser silenciosa: audita e devolve o item
-- do documento para revisão (antes o FK apenas anulava transaction_id).
CREATE OR REPLACE FUNCTION public.audit_transaction_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ledger_corrections(
    user_id, correction_kind, transaction_id, document_id, account_id,
    amount_before, amount_after, cash_impact, reason, evidence, snapshot_before, actor_id
  ) VALUES (
    OLD.user_id, 'hard_delete', OLD.id, OLD.source_document_id, OLD.account_id,
    OLD.amount, NULL,
    CASE WHEN OLD.type = 'income' THEN -OLD.amount ELSE OLD.amount END,
    'transaction_deleted',
    jsonb_build_object('origin', OLD.origin, 'import_source_id', OLD.import_source_id),
    to_jsonb(OLD), auth.uid()
  );

  UPDATE public.extracted_items
     SET status = 'needs_review', updated_at = now()
   WHERE transaction_id = OLD.id AND user_id = OLD.user_id;

  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS transactions_audit_delete ON public.transactions;
CREATE TRIGGER transactions_audit_delete BEFORE DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_transaction_delete();

-- Correção contábil auditável. Nunca apaga: substitui, retipa, vincula ou cria.
CREATE OR REPLACE FUNCTION public.apply_ledger_correction(
  p_kind text,
  p_transaction_id uuid DEFAULT NULL,
  p_related_transaction_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_evidence jsonb DEFAULT '{}'::jsonb,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tx public.transactions%ROWTYPE;
  v_new_id uuid;
  v_impact numeric(14,2) := 0;
  v_kind text := lower(coalesce(p_kind, ''));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'create_missing' THEN
    INSERT INTO public.transactions(
      user_id, account_id, category_id, type, status, amount, occurred_at, posted_at,
      description, payment_method, movement_kind, origin, import_source_id, source_document_id,
      source_line_index, external_id
    ) VALUES (
      v_user,
      (p_payload->>'account_id')::uuid,
      (p_payload->>'category_id')::uuid,
      (p_payload->>'type')::transaction_type,
      'confirmed'::transaction_status,
      round((p_payload->>'amount')::numeric, 2),
      (p_payload->>'occurred_at')::date,
      coalesce((p_payload->>'posted_at')::date, (p_payload->>'occurred_at')::date),
      coalesce(p_payload->>'description', 'Lançamento reconciliado'),
      coalesce(p_payload->>'payment_method', 'account'),
      coalesce(p_payload->>'movement_kind', 'transaction'),
      'import'::txn_origin,
      p_payload->>'import_source_id',
      (p_payload->>'source_document_id')::uuid,
      (p_payload->>'source_line_index')::integer,
      p_payload->>'external_id'
    ) RETURNING id INTO v_new_id;

    SELECT * INTO v_tx FROM public.transactions WHERE id = v_new_id;
    v_impact := CASE WHEN v_tx.type = 'income' THEN v_tx.amount ELSE -v_tx.amount END;

    IF (p_payload->>'extracted_item_id') IS NOT NULL THEN
      UPDATE public.extracted_items
         SET transaction_id = v_new_id, status = 'confirmed', updated_at = now()
       WHERE id = (p_payload->>'extracted_item_id')::uuid AND user_id = v_user;
    END IF;

    INSERT INTO public.ledger_corrections(
      user_id, correction_kind, transaction_id, document_id, account_id,
      amount_before, amount_after, cash_impact, reason, evidence, actor_id
    ) VALUES (
      v_user, 'create_missing', v_new_id, v_tx.source_document_id, v_tx.account_id,
      NULL, v_tx.amount, v_impact, p_reason, coalesce(p_evidence, '{}'::jsonb), v_user
    );

    RETURN jsonb_build_object('ok', true, 'kind', v_kind, 'transaction_id', v_new_id, 'cash_impact', v_impact);
  END IF;

  SELECT * INTO v_tx FROM public.transactions
   WHERE id = p_transaction_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction_not_found' USING ERRCODE = 'P0002'; END IF;

  IF v_kind = 'supersede' THEN
    IF p_related_transaction_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.transactions WHERE id = p_related_transaction_id AND user_id = v_user
    ) THEN RAISE EXCEPTION 'survivor_not_found' USING ERRCODE = 'P0002'; END IF;
    IF v_tx.status::text = 'superseded' THEN
      RETURN jsonb_build_object('ok', true, 'kind', v_kind, 'idempotent', true, 'transaction_id', v_tx.id, 'cash_impact', 0);
    END IF;

    v_impact := CASE WHEN v_tx.type = 'income' THEN -v_tx.amount ELSE v_tx.amount END;
    UPDATE public.transactions
       SET status = 'superseded'::transaction_status,
           superseded_by = p_related_transaction_id,
           supersede_reason = p_reason,
           superseded_at = now(),
           updated_at = now()
     WHERE id = v_tx.id;

    UPDATE public.extracted_items
       SET status = 'ignored', updated_at = now()
     WHERE transaction_id = v_tx.id AND user_id = v_user;

  ELSIF v_kind = 'retype_movement' THEN
    UPDATE public.transactions
       SET movement_kind = coalesce(p_payload->>'movement_kind', movement_kind),
           updated_at = now()
     WHERE id = v_tx.id;

  ELSIF v_kind = 'link_refund' THEN
    UPDATE public.transactions
       SET refund_of_transaction_id = p_related_transaction_id,
           refund_link_method = coalesce(p_payload->>'method', 'manual'),
           refund_link_confidence = coalesce((p_payload->>'confidence')::numeric, 1.0),
           movement_kind = 'refund',
           updated_at = now()
     WHERE id = v_tx.id;

  ELSIF v_kind = 'amend_amount' THEN
    v_impact := CASE WHEN v_tx.type = 'income'
                     THEN round((p_payload->>'amount')::numeric, 2) - v_tx.amount
                     ELSE v_tx.amount - round((p_payload->>'amount')::numeric, 2) END;
    UPDATE public.transactions
       SET amount = round((p_payload->>'amount')::numeric, 2),
           notes = concat_ws(' | ', nullif(notes, ''), 'corrigido: ' || p_reason),
           version = coalesce(version, 1) + 1,
           updated_at = now()
     WHERE id = v_tx.id;

  ELSE
    RAISE EXCEPTION 'unknown_correction_kind' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ledger_corrections(
    user_id, correction_kind, transaction_id, related_transaction_id, document_id, account_id,
    amount_before, amount_after, cash_impact, reason, evidence, snapshot_before, actor_id
  ) VALUES (
    v_user, v_kind, v_tx.id, p_related_transaction_id, v_tx.source_document_id, v_tx.account_id,
    v_tx.amount, coalesce(round((p_payload->>'amount')::numeric, 2), v_tx.amount),
    v_impact, p_reason, coalesce(p_evidence, '{}'::jsonb), to_jsonb(v_tx), v_user
  );

  RETURN jsonb_build_object('ok', true, 'kind', v_kind, 'transaction_id', v_tx.id, 'cash_impact', v_impact);
END $$;

REVOKE ALL ON FUNCTION public.apply_ledger_correction(text,uuid,uuid,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_ledger_correction(text,uuid,uuid,text,jsonb,jsonb) TO authenticated, service_role;

-- Contrato de conciliação do extrato: saldo do banco x saldo do ledger.
ALTER TABLE public.document_imports
  ADD COLUMN IF NOT EXISTS reconciliation_status text,
  ADD COLUMN IF NOT EXISTS reconciliation_delta numeric(14,2),
  ADD COLUMN IF NOT EXISTS reconciliation_ledger_balance numeric(14,2),
  ADD COLUMN IF NOT EXISTS reconciliation_contract text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

CREATE OR REPLACE FUNCTION public.reconcile_account_statement(
  p_document_id uuid,
  p_account_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc public.document_imports%ROWTYPE;
  v_account uuid;
  v_balance_date date;
  v_anchor_balance numeric(14,2);
  v_anchor_date date;
  v_movement numeric(14,2);
  v_ledger numeric(14,2);
  v_delta numeric(14,2);
  v_status text;
  v_snapshot uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_doc FROM public.document_imports
   WHERE id = p_document_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002'; END IF;
  IF coalesce(v_doc.document_kind, '') <> 'statement' THEN
    RAISE EXCEPTION 'not_a_statement' USING ERRCODE = '22023';
  END IF;

  v_account := coalesce(p_account_id, v_doc.source_account_id);
  IF v_account IS NULL THEN
    UPDATE public.document_imports
       SET reconciliation_status = 'needs_account_selection',
           reconciliation_contract = 'statement_reconciliation.v1', updated_at = now()
     WHERE id = p_document_id;
    RETURN jsonb_build_object('ok', false, 'error', 'needs_account_selection');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = v_account AND user_id = v_user) THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_balance_date := v_doc.statement_balance_date;
  IF v_doc.statement_closing_balance IS NULL OR v_balance_date IS NULL THEN
    UPDATE public.document_imports
       SET reconciliation_status = 'no_closing_balance',
           reconciliation_contract = 'statement_reconciliation.v1',
           source_account_id = v_account, updated_at = now()
     WHERE id = p_document_id;
    RETURN jsonb_build_object('ok', false, 'error', 'no_closing_balance');
  END IF;

  SELECT balance, balance_date INTO v_anchor_balance, v_anchor_date
    FROM public.account_balance_snapshots
   WHERE account_id = v_account AND user_id = v_user
     AND coalesce(status, 'confirmed') = 'confirmed'
     AND balance_date <= v_balance_date
   ORDER BY balance_date DESC LIMIT 1;

  IF v_anchor_balance IS NULL THEN
    SELECT coalesce(opening_balance, 0), '1900-01-01'::date
      INTO v_anchor_balance, v_anchor_date
      FROM public.accounts WHERE id = v_account;
  END IF;

  SELECT coalesce(sum(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0)
    INTO v_movement
    FROM public.transactions t
   WHERE t.user_id = v_user
     AND t.account_id = v_account
     AND coalesce(t.status::text, 'confirmed') = 'confirmed'
     AND t.type <> 'transfer'
     AND coalesce(t.payment_method, 'account') = 'account'
     AND coalesce(t.posted_at, t.competence_date, t.occurred_at) > v_anchor_date
     AND coalesce(t.posted_at, t.competence_date, t.occurred_at) <= v_balance_date;

  v_ledger := round(v_anchor_balance + v_movement, 2);
  v_delta := round(v_doc.statement_closing_balance - v_ledger, 2);
  v_status := CASE WHEN abs(v_delta) <= 0.005 THEN 'balanced' ELSE 'unreconciled' END;

  -- Snapshot bancário: confirmado quando fecha, em revisão quando divergir.
  INSERT INTO public.account_balance_snapshots(
    user_id, account_id, balance, balance_date, status, reconciliation
  ) VALUES (
    v_user, v_account, v_doc.statement_closing_balance, v_balance_date,
    CASE WHEN v_status = 'balanced' THEN 'confirmed' ELSE 'pending_review' END,
    jsonb_build_object(
      'contract', 'statement_reconciliation.v1',
      'source_document_id', p_document_id,
      'anchor_balance', v_anchor_balance,
      'anchor_date', v_anchor_date,
      'ledger_closing', v_ledger,
      'bank_closing', v_doc.statement_closing_balance,
      'delta', v_delta,
      'reconciliation_status', v_status
    )
  ) RETURNING id INTO v_snapshot;

  UPDATE public.document_imports
     SET source_account_id = v_account,
         reconciliation_status = v_status,
         reconciliation_delta = v_delta,
         reconciliation_ledger_balance = v_ledger,
         reconciliation_contract = 'statement_reconciliation.v1',
         reconciled_at = now(),
         updated_at = now()
   WHERE id = p_document_id;

  RETURN jsonb_build_object(
    'ok', true,
    'account_id', v_account,
    'anchor_balance', v_anchor_balance,
    'anchor_date', v_anchor_date,
    'ledger_closing', v_ledger,
    'bank_closing', v_doc.statement_closing_balance,
    'delta', v_delta,
    'reconciliation_status', v_status,
    'snapshot_id', v_snapshot,
    'contract', 'statement_reconciliation.v1'
  );
END $$;

REVOKE ALL ON FUNCTION public.reconcile_account_statement(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_account_statement(uuid,uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';