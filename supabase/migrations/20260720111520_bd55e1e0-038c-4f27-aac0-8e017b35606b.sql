
ALTER TABLE public.account_balance_snapshots DROP CONSTRAINT IF EXISTS account_balance_snapshots_status_check;
ALTER TABLE public.account_balance_snapshots ADD CONSTRAINT account_balance_snapshots_status_check
  CHECK (status = ANY (ARRAY['confirmed','pending_review','superseded','canceled']));

CREATE UNIQUE INDEX IF NOT EXISTS account_balance_snapshots_doc_account_uniq
  ON public.account_balance_snapshots(source_document_id, account_id)
  WHERE source_document_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reconcile_document_balance(p_document_id uuid, p_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_doc public.document_imports%ROWTYPE;
  v_income numeric := 0; v_expense numeric := 0; v_calculated numeric; v_difference numeric;
  v_snap_id uuid;
  v_recon jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_account_id IS NULL THEN RAISE EXCEPTION 'account_required_for_snapshot'; END IF;
  SELECT * INTO v_doc FROM public.document_imports WHERE id=p_document_id AND user_id=v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found'; END IF;
  IF v_doc.statement_closing_balance IS NULL OR v_doc.statement_balance_date IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','statement_balance_missing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id=p_account_id AND user_id=v_uid) THEN
    RETURN jsonb_build_object('ok',false,'error','account_not_found');
  END IF;

  SELECT coalesce(sum(amount) FILTER (WHERE type='income'),0),
         coalesce(sum(amount) FILTER (WHERE type='expense'),0)
    INTO v_income,v_expense
    FROM public.extracted_items WHERE document_id=p_document_id AND user_id=v_uid
      AND status NOT IN ('ignored','rejected','duplicate_suspect','failed','rolled_back');
  v_calculated := coalesce(v_doc.statement_opening_balance,0)+v_income-v_expense;
  v_difference := v_doc.statement_closing_balance-v_calculated;
  v_recon := jsonb_build_object('opening',v_doc.statement_opening_balance,'income',v_income,'expense',v_expense,
    'calculated_closing',v_calculated,'bank_closing',v_doc.statement_closing_balance,'difference',v_difference);

  UPDATE public.account_balance_snapshots
    SET balance_date=v_doc.statement_balance_date,
        balance=v_doc.statement_closing_balance,
        reconciliation=v_recon,
        status='pending_review',
        updated_at=now()
    WHERE source_document_id=p_document_id AND account_id=p_account_id AND user_id=v_uid
    RETURNING id INTO v_snap_id;

  IF v_snap_id IS NULL THEN
    INSERT INTO public.account_balance_snapshots(user_id,account_id,balance_date,balance,source,source_document_id,status,reconciliation)
    VALUES (v_uid,p_account_id,v_doc.statement_balance_date,v_doc.statement_closing_balance,'statement',p_document_id,'pending_review',v_recon)
    RETURNING id INTO v_snap_id;
  END IF;

  INSERT INTO public.document_import_audit(user_id,document_id,action,payload)
  VALUES(v_uid,p_document_id,'reconcile_balance',jsonb_build_object('account_id',p_account_id,'difference',v_difference,'snapshot_id',v_snap_id,'status','pending_review'));

  RETURN jsonb_build_object('ok',true,'snapshot_id',v_snap_id,'status','pending_review',
    'bank_closing',v_doc.statement_closing_balance,'calculated_closing',v_calculated,'difference',v_difference);
END $$;
GRANT EXECUTE ON FUNCTION public.reconcile_document_balance(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_balance_snapshot(p_snapshot_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE public.account_balance_snapshots
    SET status='confirmed', updated_at=now()
    WHERE id=p_snapshot_id AND user_id=v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot_not_found'; END IF;
  RETURN jsonb_build_object('ok',true,'snapshot_id',p_snapshot_id,'status','confirmed');
END $$;
GRANT EXECUTE ON FUNCTION public.confirm_balance_snapshot(uuid) TO authenticated;
