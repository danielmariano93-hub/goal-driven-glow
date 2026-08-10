-- bank_cash_truth.v1 — contratos de âncora, identidade de linha, attach e reclassificação.

-- 1) Âncora bancária com proveniência.
ALTER TABLE public.account_balance_snapshots
  ADD COLUMN IF NOT EXISTS anchor_kind text,
  ADD COLUMN IF NOT EXISTS as_of date,
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reconciliation_delta numeric(14,2);

UPDATE public.account_balance_snapshots
   SET anchor_kind = CASE
         WHEN coalesce(status, 'confirmed') = 'confirmed'
              AND source_document_id IS NOT NULL THEN 'bank_confirmed'
         ELSE 'inferred_position' END,
       as_of = coalesce(as_of, balance_date)
 WHERE anchor_kind IS NULL;

ALTER TABLE public.account_balance_snapshots
  ADD CONSTRAINT account_balance_snapshots_anchor_kind_chk
  CHECK (anchor_kind IS NULL OR anchor_kind IN ('bank_confirmed','inferred_position'));

CREATE INDEX IF NOT EXISTS account_balance_snapshots_anchor_idx
  ON public.account_balance_snapshots(user_id, account_id, balance_date DESC)
  WHERE anchor_kind = 'bank_confirmed';

-- 2) Semântica do saldo do extrato.
ALTER TABLE public.document_imports
  ADD COLUMN IF NOT EXISTS balance_source text,
  ADD COLUMN IF NOT EXISTS balance_as_of date,
  ADD COLUMN IF NOT EXISTS balance_as_of_confidence numeric(4,3);

ALTER TABLE public.document_imports
  ADD CONSTRAINT document_imports_balance_source_chk
  CHECK (balance_source IS NULL OR balance_source IN ('header_current','day_line','computed'));

-- 3) Identidade de linha do extrato (gêmeos legítimos preservados).
ALTER TABLE public.extracted_items
  ADD COLUMN IF NOT EXISTS line_fingerprint text,
  ADD COLUMN IF NOT EXISTS duplicate_resolution text,
  ADD COLUMN IF NOT EXISTS duplicate_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS duplicate_resolved_by uuid,
  ADD COLUMN IF NOT EXISTS attached_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL;

ALTER TABLE public.extracted_items
  ADD CONSTRAINT extracted_items_duplicate_resolution_chk
  CHECK (duplicate_resolution IS NULL
         OR duplicate_resolution IN ('keep_as_legitimate','link_to_existing','supersede'));

CREATE UNIQUE INDEX IF NOT EXISTS extracted_items_line_fingerprint_uidx
  ON public.extracted_items(document_id, line_fingerprint)
  WHERE line_fingerprint IS NOT NULL;

-- 4) Resolução explícita de suspeita de duplicidade.
CREATE OR REPLACE FUNCTION public.resolve_duplicate_item(
  p_item_id uuid,
  p_resolution text,
  p_linked_transaction_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'user_decision'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_item public.extracted_items%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_resolution NOT IN ('keep_as_legitimate','link_to_existing','supersede') THEN
    RAISE EXCEPTION 'invalid_resolution' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.extracted_items
   WHERE id = p_item_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;

  IF p_resolution = 'link_to_existing' AND p_linked_transaction_id IS NULL THEN
    RAISE EXCEPTION 'link_requires_transaction' USING ERRCODE = '22023';
  END IF;

  UPDATE public.extracted_items
     SET duplicate_resolution = p_resolution,
         duplicate_resolved_at = now(),
         duplicate_resolved_by = v_user,
         attached_transaction_id = coalesce(p_linked_transaction_id, attached_transaction_id),
         status = CASE
           WHEN p_resolution = 'keep_as_legitimate' THEN 'needs_review'
           ELSE 'ignored' END,
         updated_at = now()
   WHERE id = p_item_id AND user_id = v_user;

  INSERT INTO public.document_import_audit(user_id, document_id, action, payload)
  VALUES (v_user, v_item.document_id, 'duplicate_resolved', jsonb_build_object(
    'item_id', p_item_id, 'resolution', p_resolution,
    'linked_transaction_id', p_linked_transaction_id, 'reason', p_reason
  ));

  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id, 'resolution', p_resolution);
END $$;

REVOKE ALL ON FUNCTION public.resolve_duplicate_item(uuid,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_duplicate_item(uuid,text,uuid,text) TO authenticated, service_role;

-- 5) Anexar postagem bancária a lançamento econômico existente (sem novo movimento).
CREATE OR REPLACE FUNCTION public.attach_bank_posting(
  p_transaction_id uuid,
  p_document_id uuid,
  p_line_index integer DEFAULT NULL,
  p_posted_at date DEFAULT NULL,
  p_item_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'statement_posting_attached'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tx public.transactions%ROWTYPE;
  v_doc public.document_imports%ROWTYPE;
  v_posted date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_tx FROM public.transactions
   WHERE id = p_transaction_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction_not_found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_doc FROM public.document_imports
   WHERE id = p_document_id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002'; END IF;

  v_posted := coalesce(p_posted_at, v_tx.posted_at, v_tx.occurred_at);

  -- Idempotente: reanexar a mesma linha não muda nada e não duplica auditoria.
  IF v_tx.source_document_id = p_document_id
     AND coalesce(v_tx.source_line_index, -1) = coalesce(p_line_index, -1)
     AND v_tx.posted_at_source = 'statement'
     AND v_tx.posted_at = v_posted THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'transaction_id', p_transaction_id);
  END IF;

  UPDATE public.transactions
     SET posted_at = v_posted,
         posted_at_source = 'statement',
         source_document_id = p_document_id,
         source_line_index = coalesce(p_line_index, source_line_index),
         version = coalesce(version, 1) + 1,
         updated_at = now()
   WHERE id = p_transaction_id AND user_id = v_user;

  IF p_item_id IS NOT NULL THEN
    UPDATE public.extracted_items
       SET status = 'confirmed',
           transaction_id = p_transaction_id,
           attached_transaction_id = p_transaction_id,
           duplicate_resolution = coalesce(duplicate_resolution, 'link_to_existing'),
           duplicate_resolved_at = coalesce(duplicate_resolved_at, now()),
           duplicate_resolved_by = coalesce(duplicate_resolved_by, v_user),
           updated_at = now()
     WHERE id = p_item_id AND user_id = v_user;
  END IF;

  INSERT INTO public.ledger_corrections(
    user_id, correction_kind, transaction_id, document_id, account_id,
    amount_before, amount_after, cash_impact, reason, evidence, snapshot_before, actor_id
  ) VALUES (
    v_user, 'attach_bank_posting', p_transaction_id, p_document_id, v_tx.account_id,
    v_tx.amount, v_tx.amount, 0, p_reason,
    jsonb_build_object('line_index', p_line_index, 'item_id', p_item_id,
                       'posted_at_before', v_tx.posted_at,
                       'posted_at_source_before', v_tx.posted_at_source,
                       'posted_at_after', v_posted),
    to_jsonb(v_tx), v_user
  );

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'transaction_id', p_transaction_id,
                            'posted_at', v_posted);
END $$;

REVOKE ALL ON FUNCTION public.attach_bank_posting(uuid,uuid,integer,date,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_bank_posting(uuid,uuid,integer,date,uuid,text) TO authenticated, service_role;

-- 6) Pagamento de fatura: caixa sim, consumo não.
CREATE OR REPLACE FUNCTION public.reclassify_as_card_payment(
  p_transaction_id uuid,
  p_card_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'card_payment_semantics'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tx public.transactions%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_tx FROM public.transactions
   WHERE id = p_transaction_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_tx.type <> 'expense' THEN
    RAISE EXCEPTION 'card_payment_requires_expense' USING ERRCODE = '22023';
  END IF;
  IF p_card_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.credit_cards WHERE id = p_card_id AND user_id = v_user) THEN
    RAISE EXCEPTION 'card_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_tx.movement_kind = 'card_payment'
     AND coalesce(v_tx.settles_card_id, p_card_id) IS NOT DISTINCT FROM coalesce(p_card_id, v_tx.settles_card_id) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'transaction_id', p_transaction_id);
  END IF;

  UPDATE public.transactions
     SET movement_kind = 'card_payment',
         settles_card_id = coalesce(p_card_id, settles_card_id),
         version = coalesce(version, 1) + 1,
         updated_at = now()
   WHERE id = p_transaction_id AND user_id = v_user;

  INSERT INTO public.ledger_corrections(
    user_id, correction_kind, transaction_id, document_id, account_id,
    amount_before, amount_after, cash_impact, reason, evidence, snapshot_before, actor_id
  ) VALUES (
    v_user, 'reclassify_card_payment', p_transaction_id, v_tx.source_document_id, v_tx.account_id,
    v_tx.amount, v_tx.amount, 0, p_reason,
    jsonb_build_object('movement_kind_before', v_tx.movement_kind, 'card_id', p_card_id),
    to_jsonb(v_tx), v_user
  );

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'transaction_id', p_transaction_id);
END $$;

REVOKE ALL ON FUNCTION public.reclassify_as_card_payment(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reclassify_as_card_payment(uuid,uuid,text) TO authenticated, service_role;

-- 7) Estorno: vínculo econômico explícito, nunca renda.
CREATE OR REPLACE FUNCTION public.link_refund_transaction(
  p_refund_id uuid,
  p_original_id uuid,
  p_method text DEFAULT 'manual',
  p_confidence numeric DEFAULT 1.0,
  p_reason text DEFAULT 'refund_link'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_refund public.transactions%ROWTYPE;
  v_original public.transactions%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_refund FROM public.transactions
   WHERE id = p_refund_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_original FROM public.transactions
   WHERE id = p_original_id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'original_not_found' USING ERRCODE = 'P0002'; END IF;

  IF v_refund.refund_of_transaction_id = p_original_id
     AND v_refund.movement_kind = 'refund' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'refund_id', p_refund_id);
  END IF;

  UPDATE public.transactions
     SET movement_kind = 'refund',
         refund_of_transaction_id = p_original_id,
         refund_link_method = p_method,
         refund_link_confidence = least(greatest(coalesce(p_confidence, 1.0), 0), 1),
         category_id = coalesce(v_original.category_id, category_id),
         version = coalesce(version, 1) + 1,
         updated_at = now()
   WHERE id = p_refund_id AND user_id = v_user;

  INSERT INTO public.ledger_corrections(
    user_id, correction_kind, transaction_id, related_transaction_id, document_id, account_id,
    amount_before, amount_after, cash_impact, reason, evidence, snapshot_before, actor_id
  ) VALUES (
    v_user, 'link_refund', p_refund_id, p_original_id, v_refund.source_document_id, v_refund.account_id,
    v_refund.amount, v_refund.amount, 0, p_reason,
    jsonb_build_object('method', p_method, 'confidence', p_confidence,
                       'movement_kind_before', v_refund.movement_kind,
                       'category_before', v_refund.category_id),
    to_jsonb(v_refund), v_user
  );

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'refund_id', p_refund_id,
                            'original_id', p_original_id);
END $$;

REVOKE ALL ON FUNCTION public.link_refund_transaction(uuid,uuid,text,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_refund_transaction(uuid,uuid,text,numeric,text) TO authenticated, service_role;

-- 8) Conciliação canônica v2: as_of validado, âncora só bank_confirmed, falha fechada.
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
  v_last_movement date;
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
           reconciliation_contract = 'bank_cash_truth.v1', updated_at = now()
     WHERE id = p_document_id;
    RETURN jsonb_build_object('ok', false, 'error', 'needs_account_selection');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = v_account AND user_id = v_user) THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- as_of validado: cabeçalho "saldo atual" vale para o fim do período.
  v_balance_date := coalesce(v_doc.balance_as_of, v_doc.statement_balance_date);
  IF v_doc.balance_source = 'header_current' THEN
    v_balance_date := coalesce(v_doc.balance_as_of, v_doc.period_end, v_balance_date);
  END IF;

  IF v_doc.statement_closing_balance IS NULL OR v_balance_date IS NULL THEN
    UPDATE public.document_imports
       SET reconciliation_status = 'no_closing_balance',
           reconciliation_contract = 'bank_cash_truth.v1',
           source_account_id = v_account, updated_at = now()
     WHERE id = p_document_id;
    RETURN jsonb_build_object('ok', false, 'error', 'no_closing_balance');
  END IF;

  -- Guard T: closing balance nunca é reconciliado antes dos movimentos que o compõem.
  SELECT max(occurred_at) INTO v_last_movement
    FROM public.extracted_items
   WHERE document_id = p_document_id AND user_id = v_user
     AND coalesce(status, '') NOT IN ('ignored','rejected','failed','rolled_back');

  IF v_last_movement IS NOT NULL AND v_last_movement > v_balance_date THEN
    UPDATE public.document_imports
       SET reconciliation_status = 'balance_as_of_before_movements',
           reconciliation_contract = 'bank_cash_truth.v1',
           source_account_id = v_account, updated_at = now()
     WHERE id = p_document_id;
    RETURN jsonb_build_object('ok', false, 'error', 'balance_as_of_before_movements',
      'balance_as_of', v_balance_date, 'last_movement', v_last_movement);
  END IF;

  -- Âncora dura: somente snapshot conferido contra extrato.
  SELECT balance, balance_date INTO v_anchor_balance, v_anchor_date
    FROM public.account_balance_snapshots
   WHERE account_id = v_account AND user_id = v_user
     AND anchor_kind = 'bank_confirmed'
     AND coalesce(status, 'confirmed') = 'confirmed'
     AND balance_date <= v_balance_date
   ORDER BY balance_date DESC LIMIT 1;

  IF v_anchor_balance IS NULL THEN
    SELECT coalesce(opening_balance, 0), '1900-01-01'::date
      INTO v_anchor_balance, v_anchor_date
      FROM public.accounts WHERE id = v_account;
  END IF;

  -- Caixa: só posted_at de origem bancária tem autoridade de data de banco.
  SELECT coalesce(sum(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0)
    INTO v_movement
    FROM public.transactions t
   WHERE t.user_id = v_user
     AND t.account_id = v_account
     AND coalesce(t.status::text, 'confirmed') = 'confirmed'
     AND t.type <> 'transfer'
     AND coalesce(t.payment_method, 'account') = 'account'
     AND CASE WHEN t.posted_at IS NOT NULL AND coalesce(t.posted_at_source, 'inferred') = 'statement'
              THEN t.posted_at ELSE coalesce(t.competence_date, t.occurred_at) END > v_anchor_date
     AND CASE WHEN t.posted_at IS NOT NULL AND coalesce(t.posted_at_source, 'inferred') = 'statement'
              THEN t.posted_at ELSE coalesce(t.competence_date, t.occurred_at) END <= v_balance_date;

  v_ledger := round(v_anchor_balance + v_movement, 2);
  v_delta := round(v_doc.statement_closing_balance - v_ledger, 2);
  v_status := CASE WHEN abs(v_delta) <= 0.005 THEN 'balanced' ELSE 'unreconciled' END;

  INSERT INTO public.account_balance_snapshots(
    user_id, account_id, balance, balance_date, status, source, source_document_id,
    anchor_kind, as_of, reconciliation_delta, provenance, reconciliation
  ) VALUES (
    v_user, v_account, v_doc.statement_closing_balance, v_balance_date,
    CASE WHEN v_status = 'balanced' THEN 'confirmed' ELSE 'pending_review' END,
    'statement', p_document_id,
    CASE WHEN v_status = 'balanced' THEN 'bank_confirmed' ELSE 'inferred_position' END,
    v_balance_date, v_delta,
    jsonb_build_object(
      'contract', 'bank_cash_truth.v1',
      'source_document_id', p_document_id,
      'balance_source', v_doc.balance_source,
      'balance_as_of', v_balance_date,
      'anchor_balance', v_anchor_balance,
      'anchor_date', v_anchor_date,
      'ledger_closing', v_ledger,
      'bank_closing', v_doc.statement_closing_balance,
      'delta', v_delta
    ),
    jsonb_build_object(
      'contract', 'bank_cash_truth.v1',
      'source_document_id', p_document_id,
      'anchor_balance', v_anchor_balance,
      'anchor_date', v_anchor_date,
      'ledger_closing', v_ledger,
      'bank_closing', v_doc.statement_closing_balance,
      'delta', v_delta,
      'reconciliation_status', v_status
    )
  ) RETURNING id INTO v_snapshot;

  -- Snapshots anteriores sem proveniência deixam de ancorar o mesmo período.
  UPDATE public.account_balance_snapshots
     SET anchor_kind = 'inferred_position', updated_at = now()
   WHERE user_id = v_user AND account_id = v_account
     AND id <> v_snapshot
     AND balance_date <= v_balance_date
     AND source_document_id IS NULL
     AND coalesce(anchor_kind, 'inferred_position') <> 'inferred_position';

  UPDATE public.document_imports
     SET source_account_id = v_account,
         reconciliation_status = v_status,
         reconciliation_delta = v_delta,
         reconciliation_ledger_balance = v_ledger,
         reconciliation_contract = 'bank_cash_truth.v1',
         balance_as_of = v_balance_date,
         reconciled_at = now(),
         updated_at = now()
   WHERE id = p_document_id;

  RETURN jsonb_build_object(
    'ok', true,
    'account_id', v_account,
    'anchor_balance', v_anchor_balance,
    'anchor_date', v_anchor_date,
    'balance_as_of', v_balance_date,
    'ledger_closing', v_ledger,
    'bank_closing', v_doc.statement_closing_balance,
    'delta', v_delta,
    'reconciliation_status', v_status,
    'snapshot_id', v_snapshot,
    'contract', 'bank_cash_truth.v1'
  );
END $$;

REVOKE ALL ON FUNCTION public.reconcile_account_statement(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_account_statement(uuid,uuid) TO authenticated, service_role;

-- 9) Rota antiga delega 100% (uma única verdade de reconciliação).
CREATE OR REPLACE FUNCTION public.reconcile_document_balance(p_document_id uuid, p_account_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.reconcile_account_statement(p_document_id, p_account_id);
$$;

REVOKE ALL ON FUNCTION public.reconcile_document_balance(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_document_balance(uuid,uuid) TO authenticated, service_role;

-- 10) Suspeita de duplicidade nunca vira transação sem decisão explícita.
CREATE OR REPLACE FUNCTION public.confirm_invoice_import_atomic(
  p_document_id uuid,
  p_item_ids uuid[],
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_doc public.document_imports%ROWTYPE;
  v_validation jsonb;
  v_confirmation jsonb := jsonb_build_object(
    'ok', true, 'created_count', 0, 'created', '[]'::jsonb,
    'skipped', '[]'::jsonb, 'errors', '[]'::jsonb
  );
  v_statement jsonb;
  v_transaction_ids uuid[];
  v_non_ledger_ids uuid[];
  v_unresolved uuid[];
  v_pending integer;
  v_created integer := 0;
  v_idempotent integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_document_id IS NULL OR coalesce(array_length(p_item_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'missing_items' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_doc
    FROM public.document_imports
   WHERE id = p_document_id AND user_id = v_user
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002'; END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT payload INTO v_statement
      FROM public.document_import_audit
     WHERE document_id = p_document_id
       AND user_id = v_user
       AND action = 'invoice_atomic_confirmed'
       AND payload->>'idempotency_key' = p_idempotency_key
     ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN coalesce(v_statement->'result', '{}'::jsonb)
        || jsonb_build_object('ok', true, 'idempotent', true);
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_item_ids) requested(id)
    LEFT JOIN public.extracted_items item
      ON item.id = requested.id AND item.document_id = p_document_id AND item.user_id = v_user
    WHERE item.id IS NULL
  ) THEN RAISE EXCEPTION 'item_outside_document' USING ERRCODE = '42501'; END IF;

  -- Guard N: duplicate_suspect exige resolução explícita antes de virar ledger.
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_unresolved
    FROM public.extracted_items
   WHERE document_id = p_document_id AND user_id = v_user
     AND id = ANY(p_item_ids)
     AND status = 'duplicate_suspect'
     AND duplicate_resolution IS NULL;
  IF coalesce(array_length(v_unresolved, 1), 0) > 0 THEN
    RAISE EXCEPTION 'duplicate_suspect_unresolved' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('item_ids', to_jsonb(v_unresolved))::text;
  END IF;

  v_validation := public.validate_invoice_import(p_document_id, p_item_ids);
  IF NOT coalesce((v_validation->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'invoice_not_reconciled'
      USING ERRCODE = 'P0001', DETAIL = v_validation::text;
  END IF;

  SELECT
    coalesce(array_agg(id) FILTER (
      WHERE coalesce(statement_item_kind, 'purchase') NOT IN ('payment','informational')
    ), ARRAY[]::uuid[]),
    coalesce(array_agg(id) FILTER (
      WHERE coalesce(statement_item_kind, 'purchase') IN ('payment','informational')
    ), ARRAY[]::uuid[])
  INTO v_transaction_ids, v_non_ledger_ids
  FROM public.extracted_items
  WHERE document_id = p_document_id AND user_id = v_user AND id = ANY(p_item_ids);

  IF coalesce(array_length(v_transaction_ids, 1), 0) > 0 THEN
    v_confirmation := public.confirm_document_import(p_document_id, v_transaction_ids);
    IF NOT coalesce((v_confirmation->>'ok')::boolean, false)
       OR jsonb_array_length(coalesce(v_confirmation->'errors', '[]'::jsonb)) > 0 THEN
      RAISE EXCEPTION 'invoice_items_failed'
        USING ERRCODE = 'P0001', DETAIL = v_confirmation::text;
    END IF;
  END IF;

  IF coalesce(array_length(v_non_ledger_ids, 1), 0) > 0 THEN
    UPDATE public.extracted_items SET status = 'confirmed'
     WHERE document_id = p_document_id AND user_id = v_user
       AND id = ANY(v_non_ledger_ids);
  END IF;

  IF coalesce(v_doc.document_kind, '') = 'invoice' THEN
    v_statement := public.finalize_invoice_statement(p_document_id, p_item_ids);
    IF NOT coalesce((v_statement->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'invoice_statement_failed'
        USING ERRCODE = 'P0001', DETAIL = v_statement::text;
    END IF;
  END IF;

  SELECT count(*) INTO v_pending FROM public.extracted_items
   WHERE document_id = p_document_id AND user_id = v_user
     AND status IN ('needs_review','duplicate_suspect','failed');
  UPDATE public.document_imports
     SET status = CASE WHEN v_pending = 0 THEN 'confirmed' ELSE 'partially_confirmed' END,
         error = NULL, updated_at = now()
   WHERE id = p_document_id AND user_id = v_user;

  v_created := coalesce((v_confirmation->>'created_count')::integer, 0);
  SELECT count(*) INTO v_idempotent
    FROM jsonb_array_elements(coalesce(v_confirmation->'skipped', '[]'::jsonb)) row
   WHERE row->>'reason' IN ('already_confirmed','already_imported');

  v_statement := jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'created_count', v_created,
    'non_ledger_count', coalesce(array_length(v_non_ledger_ids, 1), 0),
    'idempotent_count', v_idempotent,
    'accounted_count', v_created + v_idempotent + coalesce(array_length(v_non_ledger_ids, 1), 0),
    'total_selected', array_length(p_item_ids, 1),
    'errors', '[]'::jsonb,
    'statement', v_statement,
    'remaining_count', v_pending
  );

  INSERT INTO public.document_import_audit(user_id, document_id, action, payload)
  VALUES (v_user, p_document_id, 'invoice_atomic_confirmed', jsonb_build_object(
    'idempotency_key', p_idempotency_key, 'item_ids', to_jsonb(p_item_ids), 'result', v_statement
  ));
  RETURN v_statement;
END $$;

REVOKE ALL ON FUNCTION public.confirm_invoice_import_atomic(uuid,uuid[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_invoice_import_atomic(uuid,uuid[],text) TO authenticated, service_role;

-- 11) Criar âncora bancária oficial a partir de documento (proveniência obrigatória).
CREATE OR REPLACE FUNCTION public.set_bank_anchor_snapshot(
  p_account_id uuid,
  p_balance numeric,
  p_balance_date date,
  p_document_id uuid,
  p_provenance jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'anchor_requires_provenance' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = v_user) THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_id FROM public.account_balance_snapshots
   WHERE user_id = v_user AND account_id = p_account_id
     AND balance_date = p_balance_date AND source_document_id = p_document_id
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.account_balance_snapshots
       SET balance = round(p_balance, 2), status = 'confirmed',
           anchor_kind = 'bank_confirmed', as_of = p_balance_date,
           reconciliation_delta = 0,
           provenance = coalesce(p_provenance, '{}'::jsonb)
                        || jsonb_build_object('contract', 'bank_cash_truth.v1'),
           updated_at = now()
     WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'snapshot_id', v_id);
  END IF;

  INSERT INTO public.account_balance_snapshots(
    user_id, account_id, balance, balance_date, status, source, source_document_id,
    anchor_kind, as_of, reconciliation_delta, provenance
  ) VALUES (
    v_user, p_account_id, round(p_balance, 2), p_balance_date, 'confirmed', 'statement',
    p_document_id, 'bank_confirmed', p_balance_date, 0,
    coalesce(p_provenance, '{}'::jsonb) || jsonb_build_object('contract', 'bank_cash_truth.v1')
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'snapshot_id', v_id);
END $$;

REVOKE ALL ON FUNCTION public.set_bank_anchor_snapshot(uuid,numeric,date,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bank_anchor_snapshot(uuid,numeric,date,uuid,jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';