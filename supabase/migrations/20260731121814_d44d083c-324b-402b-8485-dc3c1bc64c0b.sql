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
REVOKE ALL ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid) TO authenticated,service_role;