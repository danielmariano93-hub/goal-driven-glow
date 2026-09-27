-- Date-aware and concurrency-safe split receipt confirmation.
-- Keeps the explicit paid_at supplied by the user instead of silently using now().

create or replace function public.split_add_payment_v3(
  p_participant_id uuid,
  p_amount numeric,
  p_paid_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rest numeric := p_amount;
  inst record;
  v_balance numeric;
  v_total_balance numeric := 0;
  v_apply numeric;
  v_result jsonb;
  v_payment_ids jsonb := '[]'::jsonb;
  v_transaction_ids jsonb := '[]'::jsonb;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'session_expired'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'invalid_amount'); end if;

  perform 1 from public.shared_expense_participants
   where id = p_participant_id and owner_user_id = uid
   for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'participant_not_owned'); end if;

  -- Lock every payable installment before computing the balance. Two concurrent
  -- confirmations for the same participant therefore cannot both spend the same
  -- receivable balance.
  for inst in
    select id, amount, paid_amount
      from public.shared_expense_installments
     where participant_id = p_participant_id
       and owner_user_id = uid
       and status in ('pending','partial')
     order by coalesce(due_date, '2999-12-31'::date), installment_number
     for update
  loop
    v_total_balance := v_total_balance + greatest(inst.amount - inst.paid_amount, 0);
  end loop;

  if v_total_balance <= 0 then return jsonb_build_object('ok', false, 'error', 'nothing_to_receive'); end if;
  if p_amount > v_total_balance then
    return jsonb_build_object('ok', false, 'error', 'payment_exceeds_receivable', 'balance', v_total_balance);
  end if;

  for inst in
    select id, amount, paid_amount
      from public.shared_expense_installments
     where participant_id = p_participant_id
       and owner_user_id = uid
       and status in ('pending','partial')
     order by coalesce(due_date, '2999-12-31'::date), installment_number
     for update
  loop
    exit when rest <= 0;
    v_balance := greatest(inst.amount - inst.paid_amount, 0);
    if v_balance <= 0 then continue; end if;
    v_apply := least(rest, v_balance);
    v_result := public.split_add_installment_payment(
      inst.id,
      v_apply,
      coalesce(p_paid_at, now()),
      'participant_allocation'
    );
    rest := rest - coalesce((v_result->>'applied')::numeric, v_apply);
    if nullif(v_result->>'payment_id','') is not null then
      v_payment_ids := v_payment_ids || jsonb_build_array(v_result->>'payment_id');
    end if;
    if nullif(v_result->>'transaction_id','') is not null then
      v_transaction_ids := v_transaction_ids || jsonb_build_array(v_result->>'transaction_id');
    end if;
  end loop;

  if rest > 0.005 then
    raise exception 'split_payment_allocation_incomplete';
  end if;

  return jsonb_build_object(
    'ok', true,
    'amount', p_amount,
    'balance_before', v_total_balance,
    'balance_after', greatest(v_total_balance - p_amount, 0),
    'paid_at', coalesce(p_paid_at, now()),
    'payment_ids', v_payment_ids,
    'transaction_ids', v_transaction_ids
  );
end;
$$;

revoke all on function public.split_add_payment_v3(uuid,numeric,timestamptz) from public;
grant execute on function public.split_add_payment_v3(uuid,numeric,timestamptz) to authenticated, service_role;

create or replace function public.agent_execute_split_receive_confirmation_v1(
  p_confirmation_id uuid,
  p_source_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.pending_confirmations;
  p jsonb;
  r jsonb;
  v_prev_uid text;
  v_participant_id uuid;
  v_amount numeric;
  v_paid_at timestamptz;
begin
  select * into c
    from public.pending_confirmations
   where id = p_confirmation_id
   for update;

  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if c.kind <> 'split_receive' then return jsonb_build_object('ok', false, 'error', 'wrong_confirmation_kind'); end if;
  if c.status = 'confirmed' and c.result_snapshot is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'result', c.result_snapshot);
  end if;
  if c.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if c.status = 'expired' or c.expires_at < now() then
    update public.pending_confirmations set status='expired' where id=c.id and status='pending';
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  p := coalesce(c.payload, '{}'::jsonb);
  v_participant_id := nullif(p->>'participant_id','')::uuid;
  v_amount := nullif(p->>'amount','')::numeric;
  if v_participant_id is null then return jsonb_build_object('ok', false, 'error', 'participant_required'); end if;
  if v_amount is null or v_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'invalid_amount'); end if;

  v_paid_at := case
    when nullif(p->>'paid_at','') is null
      then ((now() at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo')
    else ((p->>'paid_at')::date::timestamp at time zone 'America/Sao_Paulo')
  end;

  v_prev_uid := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claim.sub', c.user_id::text, true);
  r := public.split_add_payment_v3(v_participant_id, v_amount, v_paid_at);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_uid, ''), true);

  if coalesce((r->>'ok')::boolean, false) is not true then
    return coalesce(r, jsonb_build_object('ok', false, 'error', 'split_receive_failed'));
  end if;

  r := r || jsonb_build_object(
    'kind','split_receive',
    'participant_id',v_participant_id,
    'shared_expense_id',p->>'shared_expense_id'
  );

  update public.pending_confirmations
     set status='confirmed', executed_at=now(), result_snapshot=r,
         confirmed_from_message_id=p_source_message_id
   where id=c.id;

  return jsonb_build_object('ok', true, 'idempotent', false, 'result', r);
end;
$$;

revoke all on function public.agent_execute_split_receive_confirmation_v1(uuid,uuid) from public;
grant execute on function public.agent_execute_split_receive_confirmation_v1(uuid,uuid) to authenticated, service_role;
