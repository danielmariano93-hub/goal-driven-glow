-- Estorno/crédito de cartão é income no ledger do cartão: reduz a obrigação
-- e nunca movimenta caixa. O invariante anterior barrava qualquer income em
-- cartão, tornando impossível registrar cancelamentos e devoluções.
CREATE OR REPLACE FUNCTION public.validate_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare acc_user uuid; cat_user uuid; card_user uuid;
begin
  if new.payment_method = 'credit_card' then
    if new.credit_card_id is null then raise exception 'credit_card_id required when payment_method=credit_card'; end if;
    select user_id into card_user from public.credit_cards where id = new.credit_card_id;
    if card_user is null or card_user <> new.user_id then raise exception 'credit card does not belong to user'; end if;
    if new.type = 'transfer' then raise exception 'transfers cannot use credit_card'; end if;
    if new.type = 'income' and coalesce(new.movement_kind, 'transaction') <> 'refund' then
      raise exception 'income on credit_card requires movement_kind=refund';
    end if;
    if new.type = 'income' and new.amount < 0 then
      raise exception 'credit_card refund amount must be positive';
    end if;
    -- account_id pode ser null quando cartão
  else
    if new.account_id is null then raise exception 'account_id required'; end if;
    select user_id into acc_user from public.accounts where id = new.account_id;
    if acc_user is null or acc_user <> new.user_id then raise exception 'account does not belong to user'; end if;
  end if;
  if new.category_id is not null then
    select user_id into cat_user from public.categories where id = new.category_id;
    if cat_user is not null and cat_user <> new.user_id then raise exception 'category does not belong to user'; end if;
  end if;
  if new.type = 'transfer' then
    if new.category_id is not null then raise exception 'transfer must not have a category'; end if;
    if new.transfer_group_id is null then raise exception 'transfer must have a transfer_group_id'; end if;
    if new.direction is null then raise exception 'transfer must have a direction'; end if;
  end if;
  return new;
end $function$;
