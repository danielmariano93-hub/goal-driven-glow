-- "É a mesma, não registrar" (link_to_existing) passa a gravar a referência do banco no lançamento que
-- o Nino já tinha (ex.: "Reembolso · rolê" criado ao marcar "Recebi"). Assim a próxima sincronização
-- reconhece o movimento pela referência e ele não volta como novo.
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.resolve_duplicate_item'::regproc);
  v_new := replace(v_def,
    E'  INSERT INTO public.document_import_audit(',
    E'  IF p_resolution = ''link_to_existing'' AND v_item.bank_reference IS NOT NULL THEN\n    UPDATE public.transactions\n       SET bank_reference = v_item.bank_reference,\n           external_id = coalesce(external_id, v_item.bank_reference)\n     WHERE id = p_linked_transaction_id AND user_id = v_user AND bank_reference IS NULL;\n  END IF;\n\n  INSERT INTO public.document_import_audit(');
  if v_new = v_def then raise exception 'resolve_duplicate_item: trecho nao encontrado'; end if;
  execute v_new;
end
$$;
