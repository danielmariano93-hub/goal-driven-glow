REVOKE EXECUTE ON FUNCTION public.validate_invoice_import(uuid, uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_invoice_statement(uuid, uuid[]) FROM anon;
NOTIFY pgrst, 'reload schema';