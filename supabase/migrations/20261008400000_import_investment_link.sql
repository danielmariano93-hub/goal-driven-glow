-- Resgate/aplicação importado passa a indicar QUAL investimento: o item guarda `investment_id`, a confirmação
-- grava na transação e o gatilho de investimentos (tf_transactions_investment_link) já atualiza a posição
-- (valor atual, principal, movimento). Também aprende o apelido ("INT RESGATE ITUBERS" -> CDB DI Itaú)
-- para sugerir sozinho da próxima vez.
alter table public.extracted_items
  add column if not exists investment_id uuid references public.investments(id) on delete set null;

do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.confirm_document_import'::regproc);
  v_new := replace(v_def,
    E'origin, import_source_id, movement_kind\n      ) VALUES (',
    E'origin, import_source_id, movement_kind, investment_id\n      ) VALUES (');
  v_new := replace(v_new,
    E'coalesce(v_item.movement_kind, ''transaction'')\n      )\n      RETURNING id INTO v_new_tx_id;',
    E'coalesce(v_item.movement_kind, ''transaction''),\n        CASE WHEN coalesce(v_item.movement_kind, ''transaction'') IN (''investment_application'', ''investment_redemption'')\n             THEN v_item.investment_id ELSE NULL END\n      )\n      RETURNING id INTO v_new_tx_id;');
  v_new := replace(v_new,
    E'      UPDATE public.extracted_items\n         SET transaction_id = v_new_tx_id,\n             status = ''confirmed''\n       WHERE id = v_item.id;\n\n      v_created :=',
    E'      IF v_item.investment_id IS NOT NULL\n         AND coalesce(v_item.movement_kind, ''transaction'') IN (''investment_application'', ''investment_redemption'')\n         AND public.normalize_investment_name(v_item.description) IS NOT NULL\n         AND NOT EXISTS (SELECT 1 FROM public.investment_aliases\n                          WHERE user_id = v_user AND normalized_alias = public.normalize_investment_name(v_item.description)) THEN\n        INSERT INTO public.investment_aliases(user_id, investment_id, alias, normalized_alias)\n        VALUES (v_user, v_item.investment_id, v_item.description, public.normalize_investment_name(v_item.description));\n      END IF;\n\n      UPDATE public.extracted_items\n         SET transaction_id = v_new_tx_id,\n             status = ''confirmed''\n       WHERE id = v_item.id;\n\n      v_created :=');
  if v_new = v_def or position('investment_id' in v_new) = 0 or position('investment_aliases' in v_new) = 0 then
    raise exception 'confirm_document_import: trechos nao encontrados';
  end if;
  execute v_new;
end
$$;
