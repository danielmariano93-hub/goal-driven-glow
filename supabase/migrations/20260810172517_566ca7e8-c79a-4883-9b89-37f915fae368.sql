-- Contrato ÚNICO de data bancária (`bank_cash_truth.v1`).
CREATE OR REPLACE FUNCTION public.bank_posting_sources()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT ARRAY['statement','bank','ofx','reconciliation']::text[];
$$;

CREATE OR REPLACE FUNCTION public.cash_date_of(
  p_posted date, p_posted_source text, p_competence date, p_occurred date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN p_posted IS NOT NULL
     AND coalesce(p_posted_source,'inferred') = ANY (ARRAY['statement','bank','ofx','reconciliation'])
    THEN p_posted
    ELSE coalesce(p_competence, p_occurred)
  END;
$$;

-- Identidade estável de linha de extrato: conteúdo do arquivo + ordinal + valor.
CREATE OR REPLACE FUNCTION public.statement_line_fingerprint(
  p_doc_sha text, p_document_id uuid, p_ordinal integer, p_amount numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT 'stmt:' ||
    CASE WHEN coalesce(p_doc_sha,'') <> '' AND p_doc_sha NOT LIKE 'pending:%'
         THEN 'sha:' || p_doc_sha
         ELSE 'doc:' || p_document_id::text END
    || ':' || coalesce(p_ordinal, 0)::text
    || ':' || to_char(round(coalesce(p_amount,0), 2), 'FM9999999990.00');
$$;

CREATE INDEX IF NOT EXISTS idx_extracted_items_line_fingerprint
  ON public.extracted_items (user_id, line_fingerprint);

-- Conciliação passa a usar o contrato único de data de caixa.
CREATE OR REPLACE FUNCTION public.reconcile_account_statement(p_document_id uuid, p_account_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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

  -- Data de caixa pelo contrato único (`public.cash_date_of`): paridade total
  -- com BANK_POSTING_SOURCES do motor TypeScript.
  SELECT coalesce(sum(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0)
    INTO v_movement
    FROM public.transactions t
   WHERE t.user_id = v_user
     AND t.account_id = v_account
     AND coalesce(t.status::text, 'confirmed') = 'confirmed'
     AND t.type <> 'transfer'
     AND coalesce(t.payment_method, 'account') = 'account'
     AND public.cash_date_of(t.posted_at, t.posted_at_source, t.competence_date, t.occurred_at) > v_anchor_date
     AND public.cash_date_of(t.posted_at, t.posted_at_source, t.competence_date, t.occurred_at) <= v_balance_date;

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
END $function$;