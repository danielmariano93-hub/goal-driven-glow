
-- =========================================================
-- Concorrência otimista em transactions
-- =========================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_transaction_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 1) + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bump_transaction_version ON public.transactions;
CREATE TRIGGER trg_bump_transaction_version
BEFORE UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.bump_transaction_version();

-- =========================================================
-- Grupo de parcelamento
-- =========================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS purchase_group_id uuid;

CREATE INDEX IF NOT EXISTS idx_tx_purchase_group
  ON public.transactions(user_id, purchase_group_id)
  WHERE purchase_group_id IS NOT NULL;

-- =========================================================
-- CHECK de payment_method (NOT VALID para não travar linhas legadas)
-- =========================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tx_payment_method_consistency') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT tx_payment_method_consistency
      CHECK (
        type = 'transfer'
        OR (payment_method = 'account' AND account_id IS NOT NULL AND credit_card_id IS NULL)
        OR (payment_method = 'credit_card' AND credit_card_id IS NOT NULL AND account_id IS NULL)
      ) NOT VALID;
  END IF;
END $$;

-- =========================================================
-- agent_execute_confirmation estendida
-- =========================================================
CREATE OR REPLACE FUNCTION public.agent_execute_confirmation(
  p_confirmation_id uuid,
  p_source_message_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  c record;
  p jsonb;
  new_txn uuid;
  first_txn uuid;
  new_goal uuid;
  new_debt uuid;
  new_tg uuid;
  new_group uuid;
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
  target record;
  expected_ver int;
  patch jsonb;
  scope text;
  affected_ids uuid[];
  rc int;
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
      if not found then return jsonb_build_object('ok', false, 'error', 'card_not_owned'); end if;

      n_inst := greatest(1, least(48, coalesce((p->>'installments_total')::int, 1)));
      total_cents := round((p->>'amount')::numeric * 100)::bigint;
      base_cents := total_cents / n_inst;
      extra_cents := (total_cents - base_cents * n_inst)::int;
      purchase := coalesce((p->>'occurred_at')::date, current_date);
      new_group := gen_random_uuid();

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
          purchase_date, competence_date, emotional_trigger, purchase_group_id
        ) values (
          c.user_id, null, nullif(p->>'category_id','')::uuid,
          (p->>'type')::public.transaction_type,
          'confirmed'::public.transaction_status,
          inst_amount, purchase, nullif(p->>'description',''),
          'credit_card', card_row.id, i, n_inst,
          purchase, comp_date, nullif(p->>'emotional_trigger',''), new_group
        ) returning id into new_txn;
        if i = 1 then first_txn := new_txn; end if;
      end loop;

      result := jsonb_build_object(
        'kind','transaction','transaction_id', first_txn,
        'purchase_group_id', new_group,
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
    insert into public.transactions(user_id, account_id, type, status, amount, occurred_at, description, transfer_group_id, direction, payment_method)
      values (c.user_id, (p->>'from_account_id')::uuid, 'transfer', 'confirmed',
              (p->>'amount')::numeric, coalesce((p->>'occurred_at')::date, current_date),
              nullif(p->>'description',''), new_tg, 'debit', 'account');
    insert into public.transactions(user_id, account_id, type, status, amount, occurred_at, description, transfer_group_id, direction, payment_method)
      values (c.user_id, (p->>'to_account_id')::uuid, 'transfer', 'confirmed',
              (p->>'amount')::numeric, coalesce((p->>'occurred_at')::date, current_date),
              nullif(p->>'description',''), new_tg, 'credit', 'account');
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

  elsif c.kind = 'transaction_update' then
    select * into target from public.transactions
      where id = (p->>'transaction_id')::uuid and user_id = c.user_id
      for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
    expected_ver := coalesce((p->>'expected_version')::int, target.version);
    if target.version <> expected_ver then
      return jsonb_build_object('ok', false, 'error', 'conflict', 'current_version', target.version);
    end if;
    patch := coalesce(p->'patch', '{}'::jsonb);
    scope := coalesce(nullif(p->>'scope',''), 'one');

    if scope = 'all' and target.purchase_group_id is not null then
      select array_agg(id) into affected_ids from public.transactions
        where user_id = c.user_id and purchase_group_id = target.purchase_group_id;
    elsif scope = 'future' and target.purchase_group_id is not null then
      select array_agg(id) into affected_ids from public.transactions
        where user_id = c.user_id and purchase_group_id = target.purchase_group_id
          and coalesce(installment_number, 1) >= coalesce(target.installment_number, 1);
    else
      affected_ids := ARRAY[target.id];
    end if;

    update public.transactions t set
      description = case when patch ? 'description' then nullif(patch->>'description','') else t.description end,
      category_id = case when patch ? 'category_id' then nullif(patch->>'category_id','')::uuid else t.category_id end,
      amount      = case when patch ? 'amount' then (patch->>'amount')::numeric else t.amount end,
      occurred_at = case when patch ? 'occurred_at' then (patch->>'occurred_at')::date else t.occurred_at end,
      notes       = case when patch ? 'notes' then nullif(patch->>'notes','') else t.notes end,
      purchase_date = case when patch ? 'purchase_date' then nullif(patch->>'purchase_date','')::date else t.purchase_date end,
      competence_date = case when patch ? 'competence_date' then nullif(patch->>'competence_date','')::date else t.competence_date end
    where t.id = any(affected_ids) and t.user_id = c.user_id;
    GET DIAGNOSTICS rc = ROW_COUNT;

    if patch ? 'category_id' and nullif(patch->>'category_id','') is not null then
      update public.user_insights
         set status = 'dismissed'
       where user_id = c.user_id
         and type = 'categorize_transaction'
         and status = 'active'
         and (evidence->>'transaction_id')::text = any(
              (select array_agg(x::text) from unnest(affected_ids) x)
            );
    end if;

    result := jsonb_build_object(
      'kind','transaction_update','transaction_id', target.id,
      'ids', to_jsonb(affected_ids), 'scope', scope,
      'changed_fields', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(patch) k),
      'rows', rc
    );

  elsif c.kind = 'transaction_delete' then
    select * into target from public.transactions
      where id = (p->>'transaction_id')::uuid and user_id = c.user_id
      for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
    expected_ver := coalesce((p->>'expected_version')::int, target.version);
    if target.version <> expected_ver then
      return jsonb_build_object('ok', false, 'error', 'conflict', 'current_version', target.version);
    end if;
    scope := coalesce(nullif(p->>'scope',''), 'one');
    if target.type = 'transfer' and target.transfer_group_id is not null then
      delete from public.transactions where user_id = c.user_id and transfer_group_id = target.transfer_group_id;
      result := jsonb_build_object('kind','transaction_delete','scope','transfer_pair');
    elsif scope = 'all' and target.purchase_group_id is not null then
      delete from public.transactions where user_id = c.user_id and purchase_group_id = target.purchase_group_id;
      result := jsonb_build_object('kind','transaction_delete','scope','all');
    elsif scope = 'future' and target.purchase_group_id is not null then
      delete from public.transactions where user_id = c.user_id
        and purchase_group_id = target.purchase_group_id
        and coalesce(installment_number, 1) >= coalesce(target.installment_number, 1);
      result := jsonb_build_object('kind','transaction_delete','scope','future');
    else
      delete from public.transactions where id = target.id and user_id = c.user_id;
      result := jsonb_build_object('kind','transaction_delete','scope','one','transaction_id', target.id);
    end if;

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

-- =========================================================
-- RPCs diretas do app
-- =========================================================
CREATE OR REPLACE FUNCTION public.transaction_update_direct(
  p_id uuid, p_expected_version integer, p_patch jsonb, p_scope text DEFAULT 'one'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare target record; affected_ids uuid[]; rc int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'unauthenticated'); end if;
  select * into target from public.transactions where id = p_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if target.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'current_version', target.version);
  end if;
  if p_scope = 'all' and target.purchase_group_id is not null then
    select array_agg(id) into affected_ids from public.transactions
      where user_id = auth.uid() and purchase_group_id = target.purchase_group_id;
  elsif p_scope = 'future' and target.purchase_group_id is not null then
    select array_agg(id) into affected_ids from public.transactions
      where user_id = auth.uid() and purchase_group_id = target.purchase_group_id
        and coalesce(installment_number, 1) >= coalesce(target.installment_number, 1);
  else
    affected_ids := ARRAY[target.id];
  end if;
  update public.transactions t set
    description = case when p_patch ? 'description' then nullif(p_patch->>'description','') else t.description end,
    category_id = case when p_patch ? 'category_id' then nullif(p_patch->>'category_id','')::uuid else t.category_id end,
    amount      = case when p_patch ? 'amount' then (p_patch->>'amount')::numeric else t.amount end,
    occurred_at = case when p_patch ? 'occurred_at' then (p_patch->>'occurred_at')::date else t.occurred_at end,
    notes       = case when p_patch ? 'notes' then nullif(p_patch->>'notes','') else t.notes end,
    purchase_date = case when p_patch ? 'purchase_date' then nullif(p_patch->>'purchase_date','')::date else t.purchase_date end,
    competence_date = case when p_patch ? 'competence_date' then nullif(p_patch->>'competence_date','')::date else t.competence_date end
  where t.id = any(affected_ids) and t.user_id = auth.uid();
  GET DIAGNOSTICS rc = ROW_COUNT;
  if p_patch ? 'category_id' and nullif(p_patch->>'category_id','') is not null then
    update public.user_insights set status = 'dismissed'
     where user_id = auth.uid() and type = 'categorize_transaction' and status = 'active'
       and (evidence->>'transaction_id')::text = any(
            (select array_agg(x::text) from unnest(affected_ids) x)
          );
  end if;
  return jsonb_build_object('ok', true, 'ids', to_jsonb(affected_ids), 'rows', rc, 'scope', p_scope);
end $$;

CREATE OR REPLACE FUNCTION public.transaction_delete_direct(
  p_id uuid, p_expected_version integer, p_scope text DEFAULT 'one'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare target record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'unauthenticated'); end if;
  select * into target from public.transactions where id = p_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if target.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'current_version', target.version);
  end if;
  if target.type = 'transfer' and target.transfer_group_id is not null then
    delete from public.transactions where user_id = auth.uid() and transfer_group_id = target.transfer_group_id;
    return jsonb_build_object('ok', true, 'scope', 'transfer_pair');
  end if;
  if p_scope = 'all' and target.purchase_group_id is not null then
    delete from public.transactions where user_id = auth.uid() and purchase_group_id = target.purchase_group_id;
    return jsonb_build_object('ok', true, 'scope', 'all');
  end if;
  if p_scope = 'future' and target.purchase_group_id is not null then
    delete from public.transactions where user_id = auth.uid()
      and purchase_group_id = target.purchase_group_id
      and coalesce(installment_number, 1) >= coalesce(target.installment_number, 1);
    return jsonb_build_object('ok', true, 'scope', 'future');
  end if;
  delete from public.transactions where id = target.id and user_id = auth.uid();
  return jsonb_build_object('ok', true, 'scope', 'one');
end $$;

REVOKE ALL ON FUNCTION public.transaction_update_direct(uuid, integer, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transaction_delete_direct(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transaction_update_direct(uuid, integer, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transaction_delete_direct(uuid, integer, text) TO authenticated;
