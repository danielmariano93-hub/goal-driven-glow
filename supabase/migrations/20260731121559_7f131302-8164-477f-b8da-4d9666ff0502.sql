REVOKE ALL ON FUNCTION public.approve_credit_card_statement(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.discard_credit_card_statement(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid,numeric,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_credit_card_statement(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.discard_credit_card_statement(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_credit_card_statement_item(uuid,text,uuid,numeric,date,text) TO authenticated,service_role;