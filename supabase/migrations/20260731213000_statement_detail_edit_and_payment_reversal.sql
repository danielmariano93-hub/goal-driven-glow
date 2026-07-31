-- Jornada completa de faturas: correção segura de itens e reversão auditável de baixas.
CREATE TABLE IF NOT EXISTS public.credit_card_payment_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  statement_id uuid NOT NULL REFERENCES public.credit_card_statements(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL UNIQUE,
  payment_snapshot jsonb NOT NULL,
  reversed_transaction_snapshot jsonb,
  reversed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.credit_card_payment_reversals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "credit_card_payment_reversals own rows" ON public.credit_card_payment_reversals;
CREATE POLICY "credit_card_payment_reversals own rows" ON public.credit_card_payment_reversals FOR SELECT TO authenticated USING (auth.uid()=user_id);
REVOKE ALL ON public.credit_card_payment_reversals FROM anon;
GRANT SELECT ON public.credit_card_payment_reversals TO authenticated;
GRANT ALL ON public.credit_card_payment_reversals TO service_role;

CREATE OR REPLACE FUNCTION public.update_credit_card_statement_item(p_item_id uuid,p_description text,p_category_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_item public.credit_card_statement_items%ROWTYPE;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_item FROM public.credit_card_statement_items WHERE id=p_item_id AND user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE='P0002'; END IF;
 IF length(trim(coalesce(p_description,'')))<1 THEN RAISE EXCEPTION 'description_required' USING ERRCODE='22023'; END IF;
 IF p_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.categories WHERE id=p_category_id AND (user_id=v_user OR user_id IS NULL) AND archived_at IS NULL) THEN RAISE EXCEPTION 'category_not_found' USING ERRCODE='P0002'; END IF;
 IF v_item.legacy_transaction_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','item_not_confirmed'); END IF;
 UPDATE public.transactions SET description=trim(p_description),category_id=p_category_id,category_source='user',updated_at=now() WHERE id=v_item.legacy_transaction_id AND user_id=v_user;
 UPDATE public.credit_card_statement_items SET description=trim(p_description) WHERE id=p_item_id;
 RETURN jsonb_build_object('ok',true,'item_id',p_item_id,'transaction_id',v_item.legacy_transaction_id);
END $$;

CREATE OR REPLACE FUNCTION public.reverse_credit_card_statement_payment(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid:=auth.uid(); v_payment public.credit_card_payments%ROWTYPE; v_statement_id uuid; v_statement public.credit_card_statements%ROWTYPE; v_tx jsonb; v_new_paid numeric;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_payment FROM public.credit_card_payments WHERE id=p_payment_id AND user_id=v_user FOR UPDATE;
 IF NOT FOUND THEN
   IF EXISTS(SELECT 1 FROM public.credit_card_payment_reversals WHERE user_id=v_user AND payment_id=p_payment_id) THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
   RAISE EXCEPTION 'payment_not_found' USING ERRCODE='P0002';
 END IF;
 SELECT statement_id INTO v_statement_id FROM public.credit_card_payment_allocations WHERE payment_id=p_payment_id AND user_id=v_user;
 SELECT * INTO v_statement FROM public.credit_card_statements WHERE id=v_statement_id AND user_id=v_user FOR UPDATE;
 SELECT to_jsonb(t) INTO v_tx FROM public.transactions t WHERE id=v_payment.transaction_id AND user_id=v_user;
 INSERT INTO public.credit_card_payment_reversals(user_id,statement_id,payment_id,payment_snapshot,reversed_transaction_snapshot) VALUES(v_user,v_statement_id,p_payment_id,to_jsonb(v_payment),v_tx);
 DELETE FROM public.credit_card_payment_allocations WHERE payment_id=p_payment_id AND user_id=v_user;
 DELETE FROM public.credit_card_payments WHERE id=p_payment_id AND user_id=v_user;
 DELETE FROM public.transactions WHERE id=v_payment.transaction_id AND user_id=v_user AND movement_kind='card_payment';
 v_new_paid:=greatest(0,round(v_statement.paid_amount-v_payment.amount,2));
 UPDATE public.credit_card_statements SET paid_amount=v_new_paid,status=CASE WHEN due_date<current_date AND stated_total-v_new_paid>0.005 THEN 'overdue' WHEN v_new_paid>0 THEN 'partially_paid' ELSE 'open' END,updated_at=now() WHERE id=v_statement_id;
 UPDATE public.credit_card_installments i SET status='billed',updated_at=now() FROM public.credit_card_statement_items si WHERE si.statement_id=v_statement_id AND si.installment_id=i.id AND i.user_id=v_user AND i.status='paid';
 RETURN jsonb_build_object('ok',true,'idempotent',false,'statement_id',v_statement_id,'paid_amount',v_new_paid,'outstanding_amount',greatest(0,v_statement.stated_total-v_new_paid));
END $$;
REVOKE ALL ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid),public.reverse_credit_card_statement_payment(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid),public.reverse_credit_card_statement_payment(uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
