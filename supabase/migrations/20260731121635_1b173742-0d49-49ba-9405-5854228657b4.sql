CREATE OR REPLACE FUNCTION public.approve_credit_card_statement(p_statement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_statement public.credit_card_statements%ROWTYPE; v_status text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_statement FROM public.credit_card_statements WHERE id=p_statement_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement_not_found' USING ERRCODE='P0002'; END IF;
  IF v_statement.status IN ('paid','partially_paid') THEN RETURN jsonb_build_object('ok',true,'idempotent',true,'status',v_statement.status); END IF;
  IF v_statement.status='cancelled' THEN RAISE EXCEPTION 'statement_cancelled' USING ERRCODE='55000'; END IF;
  IF v_statement.status NOT IN ('draft','needs_review','open','overdue') THEN RETURN jsonb_build_object('ok',false,'error','statement_not_approvable'); END IF;
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