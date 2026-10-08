-- Pagamento de fatura importado do banco passa a ser LIGADO ao cartão (settles_card_id):
-- é isso que reduz a fatura em aberto e faz o pagamento "conversar" com as compras do cartão.
-- A coluna guarda a detecção do lote (e a escolha do usuário na revisão); a confirmação aplica.
alter table public.extracted_items
  add column if not exists settles_card_id uuid references public.credit_cards(id) on delete set null;

do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.confirm_document_import'::regproc);
  v_new := replace(v_def,
    E'      UPDATE public.extracted_items\n         SET transaction_id = v_new_tx_id,\n             status = ''confirmed''\n       WHERE id = v_item.id;\n\n      v_created :=',
    E'      IF v_item.settles_card_id IS NOT NULL\n         AND coalesce(v_item.movement_kind, ''transaction'') = ''card_payment''\n         AND EXISTS (SELECT 1 FROM public.credit_cards WHERE id = v_item.settles_card_id AND user_id = v_user) THEN\n        UPDATE public.transactions SET settles_card_id = v_item.settles_card_id WHERE id = v_new_tx_id;\n      END IF;\n\n      UPDATE public.extracted_items\n         SET transaction_id = v_new_tx_id,\n             status = ''confirmed''\n       WHERE id = v_item.id;\n\n      v_created :=');
  if v_new = v_def then raise exception 'confirm_document_import: trecho nao encontrado'; end if;
  execute v_new;
end
$$;
