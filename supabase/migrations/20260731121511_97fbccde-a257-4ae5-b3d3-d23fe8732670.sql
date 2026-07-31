CREATE OR REPLACE FUNCTION public.update_credit_card_statement_item(
  p_item_id uuid,
  p_description text,
  p_category_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_occurred_at date DEFAULT NULL,
  p_item_kind text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user uuid:=auth.uid(); v_item public.credit_card_statement_items%ROWTYPE; v_amount numeric(14,2); v_kind text;
  v_activity numeric(14,2); v_statement public.credit_card_statements%ROWTYPE; v_reconciled numeric(14,2);
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.credit_card_statement_items WHERE id=p_item_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_statement FROM public.credit_card_statements WHERE id=v_item.statement_id AND user_id=v_user FOR UPDATE;
  IF v_statement.status NOT IN ('draft','needs_review','open','overdue') OR v_statement.paid_amount>0 THEN RAISE EXCEPTION 'statement_economic_fields_locked' USING ERRCODE='55000'; END IF;
  IF length(trim(coalesce(p_description,'')))<1 THEN RAISE EXCEPTION 'description_required' USING ERRCODE='22023'; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE id=p_category_id AND (user_id=v_user OR user_id IS NULL) AND archived_at IS NULL) THEN RAISE EXCEPTION 'category_not_found' USING ERRCODE='P0002'; END IF;
  v_kind:=coalesce(p_item_kind,v_item.item_kind);
  IF v_kind NOT IN ('purchase','installment','refund','interest','fee','adjustment') THEN RAISE EXCEPTION 'invalid_item_kind' USING ERRCODE='22023'; END IF;
  v_amount:=round(coalesce(p_amount,v_item.amount),2);
  IF v_amount=0 THEN RAISE EXCEPTION 'amount_must_not_be_zero' USING ERRCODE='22023'; END IF;
  v_amount:=CASE WHEN v_kind='refund' THEN -abs(v_amount) ELSE abs(v_amount) END;
  UPDATE public.credit_card_statement_items SET description=trim(p_description),amount=v_amount,occurred_at=coalesce(p_occurred_at,occurred_at),item_kind=v_kind WHERE id=p_item_id;
  IF v_item.legacy_transaction_id IS NOT NULL THEN
    UPDATE public.transactions SET description=trim(p_description),category_id=p_category_id,category_source='user',amount=abs(v_amount),occurred_at=coalesce(p_occurred_at,occurred_at),type=CASE WHEN v_kind='refund' THEN 'income'::public.transaction_type ELSE 'expense'::public.transaction_type END,updated_at=now() WHERE id=v_item.legacy_transaction_id AND user_id=v_user;
  END IF;
  SELECT round(coalesce(sum(amount),0),2) INTO v_activity FROM public.credit_card_statement_items WHERE statement_id=v_item.statement_id AND item_kind<>'payment';
  v_reconciled:=round(coalesce(v_statement.opening_balance,0)+v_activity,2);
  UPDATE public.credit_card_statements SET reconciled_total=v_reconciled,status=CASE WHEN abs(stated_total-v_reconciled)<=0.05 THEN CASE WHEN due_date<current_date THEN 'overdue' ELSE 'open' END ELSE 'needs_review' END,updated_at=now() WHERE id=v_item.statement_id;
  RETURN jsonb_build_object('ok',true,'item_id',p_item_id,'transaction_id',v_item.legacy_transaction_id,'reconciled_total',v_reconciled,'difference',round(v_statement.stated_total-v_reconciled,2));
END $$;
REVOKE ALL ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid,numeric,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid,numeric,date,text) TO authenticated,service_role;