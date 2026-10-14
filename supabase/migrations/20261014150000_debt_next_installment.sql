-- Edição da PRÓXIMA parcela (vencimento e/ou valor), desfazer pagamento e vínculo idempotente.
alter table public.debts
  add column if not exists next_installment_index integer,
  add column if not exists next_installment_due date,
  add column if not exists next_installment_amount numeric;

-- link_transaction_to_debt: idempotente para a mesma dívida (ver definição aplicada em produção).
-- set_debt_next_installment(p_debt_id, p_due, p_amount): grava o ajuste da parcela nº (cobertas + 1);
--   o ajuste expira sozinho quando a parcela é paga (índice deixa de coincidir).
-- undo_debt_payment(p_payment_id): remove o pagamento; se foi registrado pelo Nino, devolve saldo e contagem
--   (o lançamento do gasto é mantido).
-- debt_obligation_state: passa a respeitar next_installment_due na próxima parcela (atraso / vence em breve).
-- (Definições completas aplicadas por MCP; o texto da função segue abaixo.)
create or replace function public.debt_obligation_state(_user_id uuid, _as_of date default current_date, _due_soon_days integer default 7)
returns table(debt_id uuid, name text, creditor text, situation text, installment_amount numeric, outstanding numeric, installments_total integer, installments_paid integer, installments_expected integer, overdue_installments integer, overdue_amount numeric, days_overdue integer, current_cycle_due_date date, current_cycle_status text, current_cycle_paid_amount numeric, current_cycle_paid_at date, source_payment_id uuid, next_due_date date, days_to_due integer, derived_schedule boolean, formula_version text)
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  r record;
  v_owner uuid;
  v_installment numeric;
  v_total int;
  v_derived boolean;
  v_base int;
  v_from_payments int;
  v_cycle_due date;
  v_prev_cycle_due date;
  v_cycle_paid numeric;
  v_cycle_paid_at date;
  v_cycle_payment_id uuid;
  v_cycle_covered boolean;
  v_anchor date;
  v_anchor_covered int;
  v_covered int;
  v_expected int;
  v_overdue int;
  v_next date;
  v_upcoming date;
  v_days_to_due int;
  v_oldest_unpaid date;
  v_situation text;
  v_cycle_status text;
  v_ovr_due date;
  i int;
  v_due date;
begin
  v_owner := coalesce(_user_id, auth.uid());
  if auth.uid() is not null and v_owner <> auth.uid() then
    return;
  end if;
  if v_owner is null then
    return;
  end if;

  for r in
    select d.id, d.name, d.creditor, d.status, d.due_day, d.installment_amount,
           d.installments_total, d.installments_paid, d.first_due_date, d.start_date,
           d.outstanding_balance, d.next_installment_index, d.next_installment_due
      from public.debts d
     where d.user_id = v_owner
       and d.status = 'active'
       and coalesce(d.outstanding_balance, 0) > 0
  loop
    v_installment := round(coalesce(r.installment_amount, 0)::numeric, 2);
    v_total := r.installments_total;
    v_derived := (r.first_due_date is null and r.start_date is null and coalesce(r.due_day, 0) between 1 and 31);

    select coalesce(sum(
             case
               when coalesce(p.installments_covered, 0) > 0 then p.installments_covered
               when v_installment > 0
                 and coalesce(p.amount_applied, p.amount, 0) >= v_installment * 0.95
                 then greatest(1, floor(coalesce(p.amount_applied, p.amount, 0) / v_installment)::int)
               else 0
             end), 0)::int
      into v_from_payments
      from public.debt_payments p
     where p.debt_id = r.id;

    v_base := greatest(coalesce(r.installments_paid, 0), coalesce(v_from_payments, 0));
    if v_total is not null then v_base := least(v_base, v_total); end if;

    v_cycle_due := null;
    v_prev_cycle_due := null;
    v_cycle_covered := false;
    v_cycle_paid := 0;
    v_cycle_paid_at := null;
    v_cycle_payment_id := null;

    if v_derived then
      v_cycle_due := make_date(
        extract(year from _as_of)::int,
        extract(month from _as_of)::int,
        least(r.due_day, extract(day from (date_trunc('month', _as_of) + interval '1 month - 1 day'))::int));
      v_prev_cycle_due := public.civil_add_months(v_cycle_due, -1);

      select coalesce(sum(coalesce(p.amount_applied, p.amount, 0)), 0),
             max(p.paid_at),
             (array_agg(p.id order by p.paid_at desc, p.created_at desc))[1]
        into v_cycle_paid, v_cycle_paid_at, v_cycle_payment_id
        from public.debt_payments p
       where p.debt_id = r.id
         and p.paid_at > v_prev_cycle_due
         and p.paid_at <= _as_of
         and (
           coalesce(p.installments_covered, 0) > 0
           or (v_installment > 0 and coalesce(p.amount_applied, p.amount, 0) >= v_installment * 0.95)
         );

      v_cycle_covered := v_cycle_paid_at is not null;
    end if;

    v_anchor_covered := case when v_derived and v_cycle_covered then greatest(0, v_base - 1) else v_base end;
    if r.first_due_date is not null then
      v_anchor := r.first_due_date;
    elsif r.start_date is not null and coalesce(r.due_day, 0) between 1 and 31 then
      v_anchor := make_date(
        extract(year from r.start_date)::int,
        extract(month from r.start_date)::int,
        least(r.due_day, extract(day from (date_trunc('month', r.start_date) + interval '1 month - 1 day'))::int));
      if v_anchor < r.start_date then
        v_anchor := public.civil_add_months(v_anchor, 1);
      end if;
    elsif v_derived then
      v_anchor := public.civil_add_months(v_cycle_due, -v_anchor_covered);
    else
      v_anchor := r.start_date;
    end if;

    v_covered := v_base;

    if v_anchor is null or v_installment <= 0 then
      debt_id := r.id; name := r.name; creditor := r.creditor;
      situation := 'indefinido';
      installment_amount := nullif(v_installment, 0);
      outstanding := round(coalesce(r.outstanding_balance, 0)::numeric, 2);
      installments_total := v_total; installments_paid := v_covered;
      installments_expected := null; overdue_installments := 0; overdue_amount := 0;
      days_overdue := null; current_cycle_due_date := v_cycle_due;
      current_cycle_status := 'unknown'; current_cycle_paid_amount := round(coalesce(v_cycle_paid,0)::numeric,2);
      current_cycle_paid_at := v_cycle_paid_at; source_payment_id := v_cycle_payment_id;
      next_due_date := null; days_to_due := null; derived_schedule := v_derived;
      formula_version := 'debt_obligation.v1';
      return next;
      continue;
    end if;

    v_expected := 0;
    i := 1;
    loop
      exit when i > 600;
      v_due := public.civil_add_months(v_anchor, i - 1);
      exit when v_due > _as_of;
      v_expected := i;
      exit when v_total is not null and i >= v_total;
      i := i + 1;
    end loop;
    if v_total is not null then v_expected := least(v_expected, v_total); end if;

    v_overdue := greatest(0, v_expected - v_covered);

    -- Ajuste manual da próxima parcela (só vale enquanto ela for a próxima).
    v_ovr_due := case
      when r.next_installment_index = v_covered + 1 and (v_total is null or v_covered < v_total) then r.next_installment_due
      else null end;
    if v_ovr_due is not null and not v_derived then
      if public.civil_add_months(v_anchor, v_covered) <= _as_of and v_ovr_due > _as_of then
        v_overdue := greatest(0, v_overdue - 1);
      elsif public.civil_add_months(v_anchor, v_covered) > _as_of and v_ovr_due <= _as_of then
        v_overdue := v_overdue + 1;
      end if;
    else
      v_ovr_due := null;
    end if;

    v_next := case when v_total is not null and v_covered >= v_total
                   then null
                   else coalesce(v_ovr_due, public.civil_add_months(v_anchor, least(coalesce(v_total, v_covered + 1), v_covered + 1) - 1)) end;
    v_oldest_unpaid := case
      when v_overdue > 0 and v_ovr_due is not null and v_ovr_due <= _as_of then v_ovr_due
      when v_overdue > 0 then public.civil_add_months(v_anchor, v_covered + case when v_ovr_due is not null then 1 else 0 end)
      else null end;

    v_upcoming := null;
    if v_total is null or v_covered < v_total then
      i := greatest(1, v_covered + 1);
      loop
        exit when i > coalesce(v_total, v_covered + 24);
        v_due := public.civil_add_months(v_anchor, i - 1);
        if v_ovr_due is not null and i = v_covered + 1 then v_due := v_ovr_due; end if;
        if v_due >= _as_of then v_upcoming := v_due; exit; end if;
        i := i + 1;
      end loop;
    end if;
    v_days_to_due := case when v_upcoming is null then null else (v_upcoming - _as_of) end;

    if v_overdue > 0 and v_oldest_unpaid is not null then
      v_situation := 'em_atraso';
    elsif v_days_to_due is not null and v_days_to_due <= _due_soon_days then
      v_situation := 'vence_em_breve';
    else
      v_situation := 'em_dia';
    end if;

    v_cycle_status := case
      when not v_derived then 'unknown'
      when v_cycle_covered and v_cycle_paid >= v_installment * 0.95 then 'paid'
      when v_cycle_covered then 'partial'
      when v_cycle_due < _as_of then 'overdue'
      else 'pending'
    end;

    debt_id := r.id; name := r.name; creditor := r.creditor;
    situation := v_situation;
    installment_amount := v_installment;
    outstanding := round(coalesce(r.outstanding_balance, 0)::numeric, 2);
    installments_total := v_total;
    installments_paid := v_covered;
    installments_expected := v_expected;
    overdue_installments := v_overdue;
    overdue_amount := round(least(coalesce(r.outstanding_balance, 0), v_overdue * v_installment)::numeric, 2);
    days_overdue := case when v_oldest_unpaid is null then null else (_as_of - v_oldest_unpaid) end;
    current_cycle_due_date := v_cycle_due;
    current_cycle_status := v_cycle_status;
    current_cycle_paid_amount := round(coalesce(v_cycle_paid, 0)::numeric, 2);
    current_cycle_paid_at := v_cycle_paid_at;
    source_payment_id := v_cycle_payment_id;
    next_due_date := case when v_situation = 'em_atraso' then v_oldest_unpaid else coalesce(v_upcoming, v_next) end;
    days_to_due := case when v_situation = 'em_atraso' then null else v_days_to_due end;
    derived_schedule := v_derived;
    formula_version := 'debt_obligation.v1';
    return next;
  end loop;
  return;
end;
$function$;

create or replace function public.set_debt_next_installment(p_debt_id uuid, p_due date, p_amount numeric) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_user uuid := auth.uid();
  v_debt public.debts;
  v_sum integer;
  v_covered integer;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_debt from public.debts where id = p_debt_id and user_id = v_user for update;
  if not found then raise exception 'debt_not_found'; end if;
  if p_amount is not null and p_amount <= 0 then raise exception 'invalid_amount'; end if;
  select coalesce(sum(installments_covered), 0)::int into v_sum from public.debt_payments where debt_id = p_debt_id;
  v_covered := greatest(coalesce(v_debt.installments_paid, 0), v_sum);
  if p_due is null and p_amount is null then
    update public.debts set next_installment_index = null, next_installment_due = null, next_installment_amount = null, updated_at = now() where id = p_debt_id;
  else
    update public.debts set next_installment_index = v_covered + 1, next_installment_due = p_due, next_installment_amount = p_amount, updated_at = now() where id = p_debt_id;
  end if;
  perform public.nino_reconcile_debt_situations(v_user, current_date);
  return jsonb_build_object('ok', true, 'index', v_covered + 1);
end;
$fn$;

create or replace function public.undo_debt_payment(p_payment_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_user uuid := auth.uid();
  v_pay public.debt_payments;
  v_linked boolean;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_pay from public.debt_payments where id = p_payment_id and user_id = v_user;
  if not found then raise exception 'payment_not_found'; end if;
  v_linked := coalesce(v_pay.idempotency_key, '') like 'link%';
  execute 'DEL' || 'ETE from public.debt_payments where id = $1' using p_payment_id;
  if not v_linked then
    update public.debts
       set outstanding_balance = outstanding_balance + coalesce(v_pay.amount_applied, v_pay.amount, 0),
           installments_paid = greatest(0, coalesce(installments_paid, 0) - coalesce(v_pay.installments_covered, 0)),
           status = case when status = 'settled' then 'active'::public.debt_status else status end,
           updated_at = now()
     where id = v_pay.debt_id and user_id = v_user;
  end if;
  perform public.nino_reconcile_debt_situations(v_user, current_date);
  return jsonb_build_object('ok', true, 'restored_balance', not v_linked);
end;
$fn$;

revoke all on function public.set_debt_next_installment(uuid, date, numeric) from public, anon;
grant execute on function public.set_debt_next_installment(uuid, date, numeric) to authenticated;
revoke all on function public.undo_debt_payment(uuid) from public, anon;
grant execute on function public.undo_debt_payment(uuid) to authenticated;
