-- 1) Remove overload ambíguo
DROP FUNCTION IF EXISTS public.update_credit_card_statement_item(uuid, text, uuid);

-- 2) Helper: recalcula conciliação da fatura
CREATE OR REPLACE FUNCTION public.recalc_credit_card_statement(p_statement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stmt public.credit_card_statements%ROWTYPE; v_sum numeric(14,2); v_reconciled numeric(14,2); v_status text;
BEGIN
  SELECT * INTO v_stmt FROM public.credit_card_statements WHERE id=p_statement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement_not_found' USING ERRCODE='P0002'; END IF;
  SELECT round(coalesce(sum(amount),0),2) INTO v_sum FROM public.credit_card_statement_items WHERE statement_id=p_statement_id;
  v_reconciled := round(coalesce(v_stmt.opening_balance,0)+v_sum,2);
  v_status := CASE
    WHEN v_stmt.status IN ('paid','partially_paid','cancelled','refinanced') THEN v_stmt.status
    WHEN abs(round(v_stmt.stated_total-v_reconciled,2))<=0.05 AND v_stmt.status='needs_review' THEN 'needs_review'
    ELSE v_stmt.status END;
  UPDATE public.credit_card_statements
     SET reconciled_total=v_reconciled, status=v_status, updated_at=now()
   WHERE id=p_statement_id;
  RETURN jsonb_build_object(
    'reconciled_total', v_reconciled,
    'items_total', v_sum,
    'difference', round(v_stmt.stated_total-v_reconciled,2)
  );
END $$;

REVOKE ALL ON FUNCTION public.recalc_credit_card_statement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalc_credit_card_statement(uuid) TO service_role;

-- 3) Edição econômica (assinatura única, parâmetros opcionais)
CREATE OR REPLACE FUNCTION public.update_credit_card_statement_item(
  p_item_id uuid,
  p_description text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_occurred_at date DEFAULT NULL,
  p_item_kind text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid:=auth.uid(); v_item public.credit_card_statement_items%ROWTYPE;
        v_stmt public.credit_card_statements%ROWTYPE; v_kind text; v_amount numeric(14,2);
        v_desc text; v_recalc jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.credit_card_statement_items WHERE id=p_item_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_stmt FROM public.credit_card_statements WHERE id=v_item.statement_id AND user_id=v_user FOR UPDATE;
  IF v_stmt.status NOT IN ('draft','needs_review','open','overdue') OR v_stmt.paid_amount>0 THEN
    RAISE EXCEPTION 'statement_economic_fields_locked' USING ERRCODE='55000';
  END IF;

  v_desc := trim(coalesce(nullif(trim(coalesce(p_description,'')),''), v_item.description));
  IF length(v_desc)<1 THEN RAISE EXCEPTION 'description_required' USING ERRCODE='22023'; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.categories WHERE id=p_category_id AND (user_id=v_user OR user_id IS NULL) AND archived_at IS NULL
  ) THEN RAISE EXCEPTION 'category_not_found' USING ERRCODE='P0002'; END IF;

  v_kind := coalesce(nullif(trim(coalesce(p_item_kind,'')),''), v_item.item_kind);
  IF v_kind NOT IN ('purchase','installment','refund','interest','fee','payment','adjustment') THEN
    RAISE EXCEPTION 'invalid_item_kind' USING ERRCODE='22023';
  END IF;

  v_amount := round(coalesce(p_amount, v_item.amount),2);
  IF v_amount=0 THEN RAISE EXCEPTION 'amount_must_not_be_zero' USING ERRCODE='22023'; END IF;
  v_amount := CASE WHEN v_kind IN ('refund','payment') THEN -abs(v_amount) ELSE abs(v_amount) END;

  UPDATE public.credit_card_statement_items
     SET description=v_desc, amount=v_amount,
         occurred_at=coalesce(p_occurred_at, occurred_at), item_kind=v_kind
   WHERE id=p_item_id;

  IF v_item.legacy_transaction_id IS NOT NULL THEN
    IF v_kind IN ('refund','payment') THEN
      -- crédito na fatura não é despesa de consumo: remove o lançamento espelho
      DELETE FROM public.transactions WHERE id=v_item.legacy_transaction_id AND user_id=v_user;
      UPDATE public.credit_card_statement_items SET legacy_transaction_id=NULL WHERE id=p_item_id;
    ELSE
      UPDATE public.transactions
         SET description=v_desc,
             category_id=coalesce(p_category_id, category_id),
             category_source=CASE WHEN p_category_id IS NOT NULL THEN 'user' ELSE category_source END,
             amount=abs(v_amount),
             occurred_at=coalesce(p_occurred_at, occurred_at),
             type='expense'::public.transaction_type,
             user_edited_at=now(), updated_at=now()
       WHERE id=v_item.legacy_transaction_id AND user_id=v_user;
    END IF;
  END IF;

  v_recalc := public.recalc_credit_card_statement(v_item.statement_id);
  RETURN jsonb_build_object('ok',true,'item_id',p_item_id) || v_recalc;
END $$;

REVOKE ALL ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid,numeric,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid,numeric,date,text) TO authenticated, service_role;

-- 4) Adicionar linha faltante na fatura
CREATE OR REPLACE FUNCTION public.add_credit_card_statement_item(
  p_statement_id uuid,
  p_item_kind text,
  p_description text,
  p_amount numeric,
  p_occurred_at date DEFAULT NULL,
  p_category_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid:=auth.uid(); v_stmt public.credit_card_statements%ROWTYPE;
        v_kind text; v_amount numeric(14,2); v_desc text; v_date date;
        v_tx uuid; v_item uuid; v_recalc jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_stmt FROM public.credit_card_statements WHERE id=p_statement_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement_not_found' USING ERRCODE='P0002'; END IF;
  IF v_stmt.status NOT IN ('draft','needs_review','open','overdue') OR v_stmt.paid_amount>0 THEN
    RAISE EXCEPTION 'statement_economic_fields_locked' USING ERRCODE='55000';
  END IF;

  v_kind := trim(coalesce(p_item_kind,''));
  IF v_kind NOT IN ('purchase','installment','refund','interest','fee','payment','adjustment') THEN
    RAISE EXCEPTION 'invalid_item_kind' USING ERRCODE='22023';
  END IF;
  v_desc := trim(coalesce(p_description,''));
  IF length(v_desc)<1 THEN RAISE EXCEPTION 'description_required' USING ERRCODE='22023'; END IF;
  v_amount := round(coalesce(p_amount,0),2);
  IF v_amount=0 THEN RAISE EXCEPTION 'amount_must_not_be_zero' USING ERRCODE='22023'; END IF;
  v_amount := CASE WHEN v_kind IN ('refund','payment') THEN -abs(v_amount) ELSE abs(v_amount) END;
  v_date := coalesce(p_occurred_at, v_stmt.period_end, v_stmt.competence_month);

  IF v_kind IN ('purchase','installment') THEN
    INSERT INTO public.transactions(
      user_id, type, amount, description, occurred_at, competence_date,
      credit_card_id, category_id, category_source, status, origin, source_document_id
    ) VALUES (
      v_user, 'expense'::public.transaction_type, abs(v_amount), v_desc, v_date, v_stmt.competence_month,
      v_stmt.credit_card_id, p_category_id,
      CASE WHEN p_category_id IS NOT NULL THEN 'user' ELSE 'none' END,
      'confirmed'::public.transaction_status, 'manual'::public.txn_origin, v_stmt.source_document_id
    ) RETURNING id INTO v_tx;

    -- o gatilho de cartão já cria/atualiza o item espelho desta transação
    SELECT id INTO v_item FROM public.credit_card_statement_items WHERE legacy_transaction_id=v_tx;
    IF v_item IS NULL THEN
      INSERT INTO public.credit_card_statement_items(user_id,statement_id,legacy_transaction_id,item_kind,description,amount,occurred_at)
      VALUES (v_user,p_statement_id,v_tx,v_kind,v_desc,abs(v_amount),v_date) RETURNING id INTO v_item;
    ELSE
      UPDATE public.credit_card_statement_items
         SET statement_id=p_statement_id, item_kind=v_kind, description=v_desc, amount=abs(v_amount), occurred_at=v_date
       WHERE id=v_item;
    END IF;
  ELSE
    INSERT INTO public.credit_card_statement_items(user_id,statement_id,item_kind,description,amount,occurred_at)
    VALUES (v_user,p_statement_id,v_kind,v_desc,v_amount,v_date) RETURNING id INTO v_item;
  END IF;

  v_recalc := public.recalc_credit_card_statement(p_statement_id);
  RETURN jsonb_build_object('ok',true,'item_id',v_item,'transaction_id',v_tx) || v_recalc;
END $$;

REVOKE ALL ON FUNCTION public.add_credit_card_statement_item(uuid,text,text,numeric,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_credit_card_statement_item(uuid,text,text,numeric,date,uuid) TO authenticated, service_role;

-- 5) Excluir linha da fatura
CREATE OR REPLACE FUNCTION public.delete_credit_card_statement_item(p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid:=auth.uid(); v_item public.credit_card_statement_items%ROWTYPE;
        v_stmt public.credit_card_statements%ROWTYPE; v_recalc jsonb; v_removed integer:=0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.credit_card_statement_items WHERE id=p_item_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
  SELECT * INTO v_stmt FROM public.credit_card_statements WHERE id=v_item.statement_id AND user_id=v_user FOR UPDATE;
  IF v_stmt.status NOT IN ('draft','needs_review','open','overdue') OR v_stmt.paid_amount>0 THEN
    RAISE EXCEPTION 'statement_economic_fields_locked' USING ERRCODE='55000';
  END IF;

  DELETE FROM public.credit_card_statement_items WHERE id=p_item_id;
  IF v_item.legacy_transaction_id IS NOT NULL THEN
    DELETE FROM public.transactions WHERE id=v_item.legacy_transaction_id AND user_id=v_user;
    v_removed:=1;
  END IF;
  IF v_item.installment_id IS NOT NULL THEN
    DELETE FROM public.credit_card_installments WHERE id=v_item.installment_id AND user_id=v_user;
  END IF;

  v_recalc := public.recalc_credit_card_statement(v_item.statement_id);
  RETURN jsonb_build_object('ok',true,'removed_transactions',v_removed) || v_recalc;
END $$;

REVOKE ALL ON FUNCTION public.delete_credit_card_statement_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_credit_card_statement_item(uuid) TO authenticated, service_role;

-- 6) Fechamento assistido com ajuste auditado
CREATE OR REPLACE FUNCTION public.force_reconcile_credit_card_statement(
  p_statement_id uuid,
  p_justification text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid:=auth.uid(); v_stmt public.credit_card_statements%ROWTYPE;
        v_diff numeric(14,2); v_item uuid; v_recalc jsonb; v_reason text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  v_reason := trim(coalesce(p_justification,''));
  IF length(v_reason)<3 THEN RAISE EXCEPTION 'justification_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_stmt FROM public.credit_card_statements WHERE id=p_statement_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'statement_not_found' USING ERRCODE='P0002'; END IF;
  IF v_stmt.status NOT IN ('draft','needs_review','open','overdue') OR v_stmt.paid_amount>0 THEN
    RETURN jsonb_build_object('ok',false,'error','statement_economic_fields_locked');
  END IF;

  v_diff := round(v_stmt.stated_total - v_stmt.reconciled_total, 2);
  IF abs(v_diff)<=0.005 THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'difference',0);
  END IF;

  INSERT INTO public.credit_card_statement_items(user_id,statement_id,item_kind,description,amount,occurred_at)
  VALUES (v_user,p_statement_id,'adjustment',
          'Ajuste de conciliação — ' || left(v_reason,120),
          v_diff,
          coalesce(v_stmt.period_end, v_stmt.competence_month))
  RETURNING id INTO v_item;

  v_recalc := public.recalc_credit_card_statement(p_statement_id);

  IF v_stmt.source_document_id IS NOT NULL THEN
    INSERT INTO public.document_import_audit(user_id,document_id,action,payload)
    VALUES (v_user, v_stmt.source_document_id, 'force_reconcile_statement',
            jsonb_build_object('statement_id',p_statement_id,'adjustment',v_diff,'justification',left(v_reason,400)));
  END IF;

  RETURN jsonb_build_object('ok',true,'idempotent',false,'adjustment',v_diff,'item_id',v_item) || v_recalc;
END $$;

REVOKE ALL ON FUNCTION public.force_reconcile_credit_card_statement(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.force_reconcile_credit_card_statement(uuid,text) TO authenticated, service_role;

-- 7) Exclusão de fatura em revisão, em ordem segura e com erros explícitos
CREATE OR REPLACE FUNCTION public.discard_credit_card_statement(p_statement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid:=auth.uid(); v_stmt public.credit_card_statements%ROWTYPE;
        v_removed integer:=0; v_document uuid; v_tx uuid[];
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_stmt FROM public.credit_card_statements WHERE id=p_statement_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
  IF v_stmt.paid_amount>0 OR EXISTS(SELECT 1 FROM public.credit_card_payment_allocations WHERE statement_id=p_statement_id AND user_id=v_user) THEN
    RETURN jsonb_build_object('ok',false,'error','statement_has_payments');
  END IF;
  IF v_stmt.status IN ('paid','partially_paid','refinanced') THEN
    RETURN jsonb_build_object('ok',false,'error','only_unapproved_statement_can_be_discarded');
  END IF;

  v_document := v_stmt.source_document_id;

  SELECT coalesce(array_agg(legacy_transaction_id),'{}')
    INTO v_tx
    FROM public.credit_card_statement_items
   WHERE statement_id=p_statement_id AND user_id=v_user AND legacy_transaction_id IS NOT NULL;

  -- 1) itens (libera FKs), 2) transações da importação, 3) fatura
  DELETE FROM public.credit_card_statement_items WHERE statement_id=p_statement_id AND user_id=v_user;

  IF array_length(v_tx,1) IS NOT NULL THEN
    WITH deleted AS (
      DELETE FROM public.transactions
       WHERE user_id=v_user AND id = ANY(v_tx)
         AND credit_card_id = v_stmt.credit_card_id
      RETURNING id
    ) SELECT count(*) INTO v_removed FROM deleted;
  END IF;

  DELETE FROM public.credit_card_installments
   WHERE user_id=v_user AND legacy_transaction_id = ANY(coalesce(v_tx,'{}'::uuid[]));

  DELETE FROM public.credit_card_statements WHERE id=p_statement_id AND user_id=v_user;

  IF v_document IS NOT NULL THEN
    UPDATE public.extracted_items SET transaction_id=NULL, status='ignored', updated_at=now()
     WHERE document_id=v_document AND user_id=v_user;
    UPDATE public.document_imports SET status='canceled', updated_at=now()
     WHERE id=v_document AND user_id=v_user;
    INSERT INTO public.document_import_audit(user_id,document_id,action,payload)
    VALUES (v_user,v_document,'discard_statement',
            jsonb_build_object('statement_id',p_statement_id,'removed_transactions',v_removed));
  END IF;

  RETURN jsonb_build_object('ok',true,'idempotent',false,'removed_transactions',v_removed);
END $$;

REVOKE ALL ON FUNCTION public.discard_credit_card_statement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discard_credit_card_statement(uuid) TO authenticated, service_role;