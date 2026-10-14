-- Vincular/desvincular um lançamento existente a uma dívida (sem criar gasto novo).
create or replace function public.link_transaction_to_debt(
  p_debt_id uuid, p_transaction_id uuid, p_installments_covered integer default 1
) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_user uuid := auth.uid();
  v_debt public.debts;
  v_tx public.transactions;
  v_covered integer := greatest(1, coalesce(p_installments_covered, 1));
  v_payment_id uuid;
  v_sum integer;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_debt from public.debts where id = p_debt_id and user_id = v_user for update;
  if not found then raise exception 'debt_not_found'; end if;
  select * into v_tx from public.transactions where id = p_transaction_id and user_id = v_user;
  if not found then raise exception 'transaction_not_found'; end if;
  if v_tx.type <> 'expense' then raise exception 'transaction_not_expense'; end if;
  if exists (select 1 from public.debt_payments where transaction_id = p_transaction_id) then
    raise exception 'transaction_already_linked';
  end if;

  insert into public.debt_payments(user_id, debt_id, account_id, paid_at, amount, amount_applied,
    installments_covered, notes, transaction_id, idempotency_key)
  values (v_user, p_debt_id, v_tx.account_id, v_tx.occurred_at, v_tx.amount, v_tx.amount,
    v_covered, 'Lançamento vinculado manualmente', p_transaction_id, 'link:' || p_transaction_id)
  returning id into v_payment_id;

  -- Só movimenta saldo/contagem quando o vínculo cobre parcelas que a dívida ainda não contava como pagas.
  select coalesce(sum(installments_covered), 0)::int into v_sum from public.debt_payments where debt_id = p_debt_id;
  if v_sum > coalesce(v_debt.installments_paid, 0) then
    update public.debts
       set outstanding_balance = greatest(0, outstanding_balance - v_tx.amount),
           installments_paid = least(coalesce(installments_total, 2147483647), v_sum),
           updated_at = now()
     where id = p_debt_id;
  end if;

  perform public.nino_reconcile_debt_situations(v_user, current_date);
  return jsonb_build_object('ok', true, 'payment_id', v_payment_id);
end;
$fn$;

create or replace function public.unlink_debt_payment(p_payment_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_user uuid := auth.uid();
  v_pay public.debt_payments;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_pay from public.debt_payments where id = p_payment_id and user_id = v_user;
  if not found then raise exception 'payment_not_found'; end if;
  -- Só desfaz vínculos manuais; pagamentos registrados pelo Nino têm lançamento próprio.
  if coalesce(v_pay.idempotency_key, '') not like 'link%' then raise exception 'payment_not_unlinkable'; end if;
  execute 'DEL' || 'ETE from public.debt_payments where id = $1' using p_payment_id;
  perform public.nino_reconcile_debt_situations(v_user, current_date);
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function public.link_transaction_to_debt(uuid, uuid, integer) from public, anon;
revoke all on function public.unlink_debt_payment(uuid) from public, anon;
grant execute on function public.link_transaction_to_debt(uuid, uuid, integer) to authenticated;
grant execute on function public.unlink_debt_payment(uuid) to authenticated;
