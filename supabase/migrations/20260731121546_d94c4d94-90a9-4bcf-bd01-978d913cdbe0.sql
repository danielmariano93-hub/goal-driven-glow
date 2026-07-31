CREATE OR REPLACE FUNCTION public.discard_credit_card_statement(p_statement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_statement public.credit_card_statements%ROWTYPE; v_removed integer:=0; v_document uuid; v_document_status text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_statement FROM public.credit_card_statements WHERE id=p_statement_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement_not_found' USING ERRCODE='P0002'; END IF;
  IF v_statement.status='cancelled' THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
  v_document:=v_statement.source_document_id;
  IF v_document IS NOT NULL THEN SELECT status INTO v_document_status FROM public.document_imports WHERE id=v_document AND user_id=v_user; END IF;
  IF v_statement.status NOT IN ('draft','needs_review') AND NOT (v_statement.status IN ('open','overdue') AND coalesce(v_document_status,'') IN ('canceled','needs_review','partial','failed')) THEN RETURN jsonb_build_object('ok',false,'error','only_unapproved_statement_can_be_discarded'); END IF;
  IF v_statement.paid_amount>0 OR EXISTS(SELECT 1 FROM public.credit_card_payment_allocations WHERE statement_id=p_statement_id AND user_id=v_user) THEN RETURN jsonb_build_object('ok',false,'error','statement_has_payments'); END IF;
  WITH owned AS (SELECT legacy_transaction_id FROM public.credit_card_statement_items WHERE statement_id=p_statement_id AND user_id=v_user AND legacy_transaction_id IS NOT NULL), deleted AS (
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