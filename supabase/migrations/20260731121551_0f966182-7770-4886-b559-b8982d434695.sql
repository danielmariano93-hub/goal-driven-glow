CREATE OR REPLACE FUNCTION public.update_credit_card_statement_item(p_item_id uuid,p_description text,p_category_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT public.update_credit_card_statement_item(p_item_id,p_description,p_category_id,NULL,NULL,NULL)
$$;
REVOKE ALL ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid) TO authenticated,service_role;