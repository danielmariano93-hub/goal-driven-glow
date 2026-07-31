CREATE OR REPLACE FUNCTION public.update_credit_card_statement_item(
  p_item_id uuid,
  p_description text,
  p_category_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_occurred_at date DEFAULT NULL,
  p_item_kind text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user uuid:=auth.uid();
  v_item public.credit_card_statement_items%ROWTYPE;
  v_amount numeric(14,2);
  v_kind text;
  v_activity numeric(14,2);
  v_statement public.credit_card_statements%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.credit_card_statement_items WHERE id=p_item_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_statement FROM public.credit_card_statements WHERE id=v_item.statement_id AND user_id=v_user FOR UPDATE;
  IF v_statement.status NOT IN ('draft','needs_review','open','overdue') OR v_statement.paid_amount > 0 THEN
    RAISE EXCEPTION 'statement_economic_fields_locked' USING ERRCODE='55000';
  END IF;
  IF length(trim(coalesce(p_description,'')))<1 THEN RAISE EXCEPTION 'description_required' USING ERRCODE='22023'; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE id=p_category_id AND (user_id=v_user OR user_id IS NULL) AND archived_at IS NULL) THEN RAISE EXCEPTION 'category_not_found' USING ERRCODE='P0002'; END IF;
  v_kind:=coalesce(p_item_kind,v_item.item_kind);
  IF v_kind NOT IN ('purchase','installment','refund','interest','fee','adjustment') THEN RAISE EXCEPTION 'invalid_item_kind' USING ERRCODE='22023'; END IF;
  v_amount:=round(coalesce(p_amount,v_item.amount),2);
  IF v_amount=0 THEN RAISE EXCEPTION 'amount_must_not_be_zero' USING ERRCODE='22023'; END IF;
  v_amount:=CASE WHEN v_kind='refund' THEN -abs(v_amount) ELSE abs(v_amount) END;

  UPDATE public.credit_card_statement_items SET description=trim(p_description),amount=v_amount,
    occurred_at=coalesce(p_occurred_at,occurred_at),item_kind=v_kind WHERE id=p_item_id;
  IF v_item.legacy_transaction_id IS NOT NULL THEN
    UPDATE public.transactions SET description=trim(p_description),category_id=p_category_id,category_source='user',
      amount=abs(v_amount),occurred_at=coalesce(p_occurred_at,occurred_at),type=CASE WHEN v_kind='refund' THEN 'income'::public.transaction_type ELSE 'expense'::public.transaction_type END,updated_at=now()
    WHERE id=v_item.legacy_transaction_id AND user_id=v_user;
  END IF;
  SELECT round(coalesce(sum(amount),0),2) INTO v_activity FROM public.credit_card_statement_items WHERE statement_id=v_item.statement_id;
  UPDATE public.credit_card_statements SET reconciled_total=round(coalesce(opening_balance,0)+v_activity,2),
    status=CASE WHEN abs(stated_total-round(coalesce(opening_balance,0)+v_activity,2))<=0.05 THEN CASE WHEN due_date<current_date THEN 'overdue' ELSE 'open' END ELSE 'needs_review' END,
    updated_at=now() WHERE id=v_item.statement_id;
  RETURN jsonb_build_object('ok',true,'item_id',p_item_id,'transaction_id',v_item.legacy_transaction_id,
    'reconciled_total',round(coalesce(v_statement.opening_balance,0)+v_activity,2),
    'difference',round(v_statement.stated_total-(coalesce(v_statement.opening_balance,0)+v_activity),2));
END $$;
REVOKE ALL ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid,numeric,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid,numeric,date,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.approve_credit_card_statement(p_statement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_statement public.credit_card_statements%ROWTYPE; v_status text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_statement FROM public.credit_card_statements WHERE id=p_statement_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement_not_found' USING ERRCODE='P0002'; END IF;
  IF v_statement.status IN ('paid','partially_paid') THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'status',v_statement.status); END IF;
  IF v_statement.status='cancelled' THEN RAISE EXCEPTION 'statement_cancelled' USING ERRCODE='55000'; END IF;
  IF abs(v_statement.reconciliation_difference)>0.05 THEN RETURN jsonb_build_object('ok',false,'error','reconciliation_open','difference',v_statement.reconciliation_difference); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.credit_card_statement_items WHERE statement_id=p_statement_id AND user_id=v_user) THEN RETURN jsonb_build_object('ok',false,'error','statement_without_items'); END IF;
  v_status:=CASE WHEN v_statement.paid_amount>=v_statement.stated_total-0.005 THEN 'paid' WHEN v_statement.paid_amount>0 THEN 'partially_paid' WHEN v_statement.due_date<current_date THEN 'overdue' ELSE 'open' END;
  UPDATE public.credit_card_statements SET status=v_status,updated_at=now() WHERE id=p_statement_id;
  IF v_statement.source_document_id IS NOT NULL THEN
    UPDATE public.document_imports SET status='confirmed',updated_at=now() WHERE id=v_statement.source_document_id AND user_id=v_user AND status<>'rolled_back';
    INSERT INTO public.document_import_audit(user_id,document_id,action,payload) VALUES(v_user,v_statement.source_document_id,'approve_statement',jsonb_build_object('statement_id',p_statement_id,'status',v_status));
  END IF;
  RETURN jsonb_build_object('ok',true,'idempotent',false,'status',v_status);
END $$;
REVOKE ALL ON FUNCTION public.approve_credit_card_statement(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_credit_card_statement(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.discard_credit_card_statement(p_statement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_statement public.credit_card_statements%ROWTYPE; v_removed integer:=0; v_document uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_statement FROM public.credit_card_statements WHERE id=p_statement_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement_not_found' USING ERRCODE='P0002'; END IF;
  IF v_statement.status='cancelled' THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
  IF v_statement.status NOT IN ('draft','needs_review') THEN RETURN jsonb_build_object('ok',false,'error','only_review_statement_can_be_discarded'); END IF;
  IF v_statement.paid_amount>0 OR EXISTS(SELECT 1 FROM public.credit_card_payment_allocations WHERE statement_id=p_statement_id AND user_id=v_user) THEN RETURN jsonb_build_object('ok',false,'error','statement_has_payments'); END IF;
  v_document:=v_statement.source_document_id;
  WITH owned AS (
    SELECT legacy_transaction_id FROM public.credit_card_statement_items WHERE statement_id=p_statement_id AND user_id=v_user AND legacy_transaction_id IS NOT NULL
  ), deleted AS (
    DELETE FROM public.transactions t USING owned o WHERE t.id=o.legacy_transaction_id AND t.user_id=v_user AND (v_document IS NULL OR t.source_document_id=v_document) RETURNING t.id
  ) SELECT count(*) INTO v_removed FROM deleted;
  DELETE FROM public.credit_card_statement_items WHERE statement_id=p_statement_id AND user_id=v_user;
  DELETE FROM public.credit_card_statements WHERE id=p_statement_id AND user_id=v_user;
  IF v_document IS NOT NULL THEN
    UPDATE public.extracted_items SET transaction_id=NULL,status='ignored',updated_at=now() WHERE document_id=v_document AND user_id=v_user;
    UPDATE public.document_imports SET status='canceled',updated_at=now() WHERE id=v_document AND user_id=v_user;
    INSERT INTO public.document_import_audit(user_id,document_id,action,payload) VALUES(v_user,v_document,'discard_statement',jsonb_build_object('statement_id',p_statement_id,'removed_transactions',v_removed));
  END IF;
  RETURN jsonb_build_object('ok',true,'idempotent',false,'removed_transactions',v_removed);
END $$;
REVOKE ALL ON FUNCTION public.discard_credit_card_statement(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.discard_credit_card_statement(uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';