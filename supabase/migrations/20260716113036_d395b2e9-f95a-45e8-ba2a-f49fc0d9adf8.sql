create or replace function public.agent_execute_confirmation(p_confirmation_id uuid, p_source_message_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c record;
  p jsonb;
  new_txn uuid;
  first_txn uuid;
  new_goal uuid;
  new_debt uuid;
  new_tg uuid;
  result jsonb;
  pay_method text;
  card_row record;
  n_inst int;
  total_cents bigint;
  base_cents bigint;
  extra_cents int;
  inst_amount numeric;
  purchase date;
  comp_date date;
  i int;
begin
  select * into c from public.pending_confirmations where id = p_confirmation_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if c.status = 'confirmed' and c.result_snapshot is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'result', c.result_snapshot);
  end if;
  if c.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if c.status = 'expired' or c.expires_at < now() then
    update public.pending_confirmations set status = 'expired' where id = c.id and status = 'pending';
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  p := c.payload;

  if c.kind = 'transaction' then
    pay_method := coalesce(nullif(p->>'payment_method',''), 'account');

    if pay_method = 'credit_card' then
      select id, closing_day, name into card_row
        from public.credit_cards
        where id = (p->>'credit_card_id')::uuid and user_id = c.user_id and active = true;
      if not found then
        return jsonb_build_object('ok', false, 'error', 'card_not_owned');
      end if;

      n_inst := greatest(1, least(48, coalesce((p->>'installments_total')::int, 1)));
      total_cents := round((p->>'amount')::numeric * 100)::bigint;
      base_cents := total_cents / n_inst;
      extra_cents := (total_cents - base_cents * n_inst)::int;
      purchase := coalesce((p->>'occurred_at')::date, current_date);

      for i in 1..n_inst loop
        inst_amount := ((base_cents + case when i = 1 then extra_cents else 0 end)::numeric) / 100.0;
        if i = 1 then
          if extract(day from purchase)::int <= card_row.closing_day then
            comp_date := date_trunc('month', purchase)::date;
          else
            comp_date := (date_trunc('month', purchase) + interval '1 month')::date;
          end if;
        else
          comp_date := (comp_date + interval '1 month')::date;
        end if;

        insert into public.transactions(
          user_id, account_id, category_id, type, status, amount, occurred_at, description,
          payment_method, credit_card_id, installment_number, installments_total,
          purchase_date, competence_date, emotional_trigger
        ) values (
          c.user_id, null, nullif(p->>'category_id','')::uuid,
          (p->>'type')::public.transaction_type,
          'confirmed'::public.transaction_status,
          inst_amount, purchase, nullif(p->>'description',''),
          'credit_card', card_row.id, i, n_inst,
          purchase, comp_date, nullif(p->>'emotional_trigger','')
        ) returning id into new_txn;
        if i = 1 then first_txn := new_txn; end if;
      end loop;

      result := jsonb_build_object(
        'kind','transaction','transaction_id', first_txn,
        'type', p->>'type', 'amount', p->>'amount',
        'payment_method','credit_card',
        'credit_card_id', card_row.id,
        'installments_total', n_inst
      );
    else
      insert into public.transactions(
        user_id, account_id, category_id, type, status, amount, occurred_at, description, emotional_trigger, payment_method
      ) values (
        c.user_id, (p->>'account_id')::uuid, nullif(p->>'category_id','')::uuid,
        (p->>'type')::public.transaction_type,
        'confirmed'::public.transaction_status,
        (p->>'amount')::numeric,
        coalesce((p->>'occurred_at')::date, current_date),
        nullif(p->>'description',''),
        nullif(p->>'emotional_trigger',''),
        'account'
      ) returning id into new_txn;
      result := jsonb_build_object('kind','transaction','transaction_id', new_txn,
        'type', p->>'type', 'amount', p->>'amount', 'payment_method','account');
    end if;

  elsif c.kind = 'transfer' then
    new_tg := gen_random_uuid();
    insert into public.transactions(user_id, account_id, type, status, amount, occurred_at, description, transfer_group_id, direction)
      values (c.user_id, (p->>'from_account_id')::uuid, 'transfer', 'confirmed',
              (p->>'amount')::numeric, coalesce((p->>'occurred_at')::date, current_date),
              nullif(p->>'description',''), new_tg, 'debit');
    insert into public.transactions(user_id, account_id, type, status, amount, occurred_at, description, transfer_group_id, direction)
      values (c.user_id, (p->>'to_account_id')::uuid, 'transfer', 'confirmed',
              (p->>'amount')::numeric, coalesce((p->>'occurred_at')::date, current_date),
              nullif(p->>'description',''), new_tg, 'credit');
    result := jsonb_build_object('kind','transfer','transfer_group_id', new_tg, 'amount', p->>'amount');

  elsif c.kind = 'goal' then
    insert into public.goals(user_id, name, target_amount, target_date, priority)
      values (c.user_id, p->>'name', (p->>'target_amount')::numeric,
              nullif(p->>'target_date','')::date, coalesce((p->>'priority')::smallint, 3))
      returning id into new_goal;
    result := jsonb_build_object('kind','goal','goal_id', new_goal, 'name', p->>'name');

  elsif c.kind = 'goal_contribution' then
    if not exists (select 1 from public.goals where id = (p->>'goal_id')::uuid and user_id = c.user_id) then
      return jsonb_build_object('ok', false, 'error', 'goal_not_owned');
    end if;
    insert into public.goal_contributions(user_id, goal_id, account_id, amount, occurred_at)
      values (c.user_id, (p->>'goal_id')::uuid, nullif(p->>'account_id','')::uuid,
              (p->>'amount')::numeric, coalesce((p->>'occurred_at')::date, current_date));
    result := jsonb_build_object('kind','goal_contribution','goal_id', p->>'goal_id', 'amount', p->>'amount');

  elsif c.kind = 'debt' then
    insert into public.debts(user_id, name, creditor, original_amount, outstanding_balance, installment_amount, due_day)
      values (c.user_id, p->>'name', nullif(p->>'creditor',''),
              (p->>'original_amount')::numeric,
              coalesce((p->>'outstanding_balance')::numeric, (p->>'original_amount')::numeric),
              nullif(p->>'installment_amount','')::numeric,
              nullif(p->>'due_day','')::smallint)
      returning id into new_debt;
    result := jsonb_build_object('kind','debt','debt_id', new_debt, 'name', p->>'name');

  else
    return jsonb_build_object('ok', false, 'error', 'unknown_kind');
  end if;

  update public.pending_confirmations
     set status = 'confirmed', executed_at = now(),
         result_snapshot = result,
         confirmed_from_message_id = p_source_message_id
   where id = c.id;

  return jsonb_build_object('ok', true, 'idempotent', false, 'result', result);
end $function$;