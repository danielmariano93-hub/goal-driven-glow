-- Nino lifecycle hardening v1
-- Missing conversational CRUD/payment actions commit through one atomic,
-- idempotent confirmation boundary. No LLM is allowed inside this function.

create or replace function public.agent_execute_lifecycle_confirmation_v1(
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
  patch jsonb;
  r jsonb;
  v_prev_uid text;
  v_id uuid;
  v_name text;
  v_slug text;
  v_balance numeric;
  v_amount numeric;
  v_status text;
  v_rows integer;
begin
  select * into c
    from public.pending_confirmations
   where id = p_confirmation_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if c.status = 'confirmed' and c.result_snapshot is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'result', c.result_snapshot);
  end if;
  if c.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'cancelled');
  end if;
  if c.status = 'expired' or c.expires_at < now() then
    update public.pending_confirmations set status = 'expired'
     where id = c.id and status = 'pending';
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  p := coalesce(c.payload, '{}'::jsonb);

  if c.kind = 'debt_payment' then
    -- record_debt_payment is the single debt accounting authority and already
    -- enforces ownership, overpayment protection, row locking and idempotency.
    v_prev_uid := current_setting('request.jwt.claim.sub', true);
    perform set_config('request.jwt.claim.sub', c.user_id::text, true);
    r := public.record_debt_payment(
      p_debt_id := (p->>'debt_id')::uuid,
      p_account_id := nullif(p->>'account_id','')::uuid,
      p_paid_at := coalesce(nullif(p->>'paid_at','')::date, current_date),
      p_amount := (p->>'amount')::numeric,
      p_interest_amount := coalesce(nullif(p->>'interest_amount','')::numeric, 0),
      p_fee_amount := coalesce(nullif(p->>'fee_amount','')::numeric, 0),
      p_installments_covered := coalesce(nullif(p->>'installments_covered','')::integer, 0),
      p_notes := nullif(p->>'notes',''),
      p_idempotency_key := 'nino-confirmation:' || c.id::text
    );
    perform set_config('request.jwt.claim.sub', coalesce(v_prev_uid, ''), true);
    if coalesce((r->>'ok')::boolean, false) is not true then
      return coalesce(r, jsonb_build_object('ok', false, 'error', 'debt_payment_failed'));
    end if;
    r := r || jsonb_build_object('kind', 'debt_payment', 'debt_id', p->>'debt_id');

  elsif c.kind = 'goal_update' then
    patch := coalesce(p->'patch', '{}'::jsonb);
    select id, name into v_id, v_name from public.goals
     where id = (p->>'goal_id')::uuid and user_id = c.user_id for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'goal_not_owned'); end if;
    if patch ? 'target_amount' and (patch->>'target_amount')::numeric <= 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_target_amount');
    end if;
    if patch ? 'priority' and ((patch->>'priority')::integer < 1 or (patch->>'priority')::integer > 5) then
      return jsonb_build_object('ok', false, 'error', 'invalid_priority');
    end if;
    if patch ? 'status' and (patch->>'status') not in ('active','paused','completed') then
      return jsonb_build_object('ok', false, 'error', 'invalid_goal_status');
    end if;
    update public.goals g set
      name = case when patch ? 'name' then nullif(btrim(patch->>'name'),'') else g.name end,
      target_amount = case when patch ? 'target_amount' then (patch->>'target_amount')::numeric else g.target_amount end,
      target_date = case when patch ? 'target_date' then nullif(patch->>'target_date','')::date else g.target_date end,
      priority = case when patch ? 'priority' then (patch->>'priority')::smallint else g.priority end,
      status = case when patch ? 'status' then (patch->>'status')::public.goal_status else g.status end,
      updated_at = now()
    where g.id = v_id and g.user_id = c.user_id;
    r := jsonb_build_object('kind','goal_update','goal_id',v_id,'changed_fields',
      (select coalesce(jsonb_agg(k),'[]'::jsonb) from jsonb_object_keys(patch) k));

  elsif c.kind = 'goal_delete' then
    v_id := (p->>'goal_id')::uuid;
    delete from public.goals where id = v_id and user_id = c.user_id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then return jsonb_build_object('ok', false, 'error', 'goal_not_owned'); end if;
    r := jsonb_build_object('kind','goal_delete','goal_id',v_id,'deleted',true);

  elsif c.kind = 'category_create' then
    v_name := nullif(btrim(p->>'name'),'');
    if v_name is null then return jsonb_build_object('ok', false, 'error', 'category_name_required'); end if;
    if coalesce(p->>'type','expense') not in ('income','expense') then
      return jsonb_build_object('ok', false, 'error', 'category_type_invalid');
    end if;
    v_slug := trim(both '-' from lower(regexp_replace(v_name, '[^[:alnum:]]+', '-', 'g')));
    if v_slug = '' then v_slug := 'categoria'; end if;
    if exists(select 1 from public.categories where user_id=c.user_id and archived_at is null and lower(name)=lower(v_name)) then
      return jsonb_build_object('ok', false, 'error', 'category_already_exists');
    end if;
    insert into public.categories(user_id,slug,name,type)
    values(c.user_id,v_slug,v_name,(coalesce(p->>'type','expense'))::public.category_type)
    returning id into v_id;
    r := jsonb_build_object('kind','category_create','category_id',v_id,'name',v_name);

  elsif c.kind = 'category_update' then
    v_id := (p->>'category_id')::uuid;
    v_name := nullif(btrim(p->>'new_name'),'');
    if v_name is null then return jsonb_build_object('ok', false, 'error', 'category_new_name_required'); end if;
    update public.categories set name=v_name, updated_at=now()
     where id=v_id and user_id=c.user_id and archived_at is null;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then return jsonb_build_object('ok', false, 'error', 'category_not_owned'); end if;
    r := jsonb_build_object('kind','category_update','category_id',v_id,'name',v_name);

  elsif c.kind = 'category_delete' then
    v_id := (p->>'category_id')::uuid;
    update public.categories set archived_at=coalesce(archived_at,now()), updated_at=now()
     where id=v_id and user_id=c.user_id and archived_at is null;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then return jsonb_build_object('ok', false, 'error', 'category_not_owned'); end if;
    r := jsonb_build_object('kind','category_delete','category_id',v_id,'archived',true);

  elsif c.kind = 'split_receive' then
    v_id := (p->>'participant_id')::uuid;
    v_amount := (p->>'amount')::numeric;
    if v_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'invalid_amount'); end if;
    select coalesce(sum(balance_due),0) into v_balance
      from public.split_receivables_v1
     where participant_id=v_id and owner_user_id=c.user_id and balance_due > 0;
    if v_balance <= 0 then return jsonb_build_object('ok', false, 'error', 'nothing_to_receive'); end if;
    if v_amount > v_balance then return jsonb_build_object('ok', false, 'error', 'payment_exceeds_receivable'); end if;
    v_prev_uid := current_setting('request.jwt.claim.sub', true);
    perform set_config('request.jwt.claim.sub', c.user_id::text, true);
    perform public.split_add_payment_v2(v_id, v_amount);
    perform set_config('request.jwt.claim.sub', coalesce(v_prev_uid, ''), true);
    r := jsonb_build_object('kind','split_receive','participant_id',v_id,
      'shared_expense_id',p->>'shared_expense_id','amount',v_amount,'balance_before',v_balance);

  elsif c.kind = 'split_update' then
    v_id := (p->>'split_id')::uuid;
    patch := coalesce(p->'patch','{}'::jsonb);
    if patch ? 'due_date' and nullif(patch->>'due_date','') is null then patch := patch - 'due_date'; end if;
    update public.shared_expenses s set
      title = case when patch ? 'title' then nullif(btrim(patch->>'title'),'') else s.title end,
      due_date = case when patch ? 'due_date' then (patch->>'due_date')::date else s.due_date end,
      reminder_enabled = case when patch ? 'reminder_enabled' then (patch->>'reminder_enabled')::boolean else s.reminder_enabled end,
      pix_key = case when patch ? 'pix_key' then nullif(patch->>'pix_key','') else s.pix_key end,
      updated_at = now()
     where s.id=v_id and s.owner_user_id=c.user_id and s.deleted_at is null;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then return jsonb_build_object('ok', false, 'error', 'split_not_owned'); end if;
    r := jsonb_build_object('kind','split_update','shared_expense_id',v_id,'changed_fields',
      (select coalesce(jsonb_agg(k),'[]'::jsonb) from jsonb_object_keys(patch) k));

  elsif c.kind = 'split_delete' then
    v_id := (p->>'split_id')::uuid;
    v_prev_uid := current_setting('request.jwt.claim.sub', true);
    perform set_config('request.jwt.claim.sub', c.user_id::text, true);
    perform public.split_delete(v_id);
    perform set_config('request.jwt.claim.sub', coalesce(v_prev_uid, ''), true);
    r := jsonb_build_object('kind','split_delete','shared_expense_id',v_id,'deleted',true);

  elsif c.kind = 'recurring_create' then
    if (p->>'amount')::numeric <= 0 then return jsonb_build_object('ok', false, 'error', 'invalid_amount'); end if;
    if coalesce((p->>'day_of_month')::integer,0) not between 1 and 31 then
      return jsonb_build_object('ok', false, 'error', 'invalid_day_of_month');
    end if;
    if coalesce(p->>'frequency','monthly') not in ('daily','weekly','monthly','yearly') then
      return jsonb_build_object('ok', false, 'error', 'invalid_frequency');
    end if;
    if not exists(select 1 from public.accounts where id=(p->>'account_id')::uuid and user_id=c.user_id and active) then
      return jsonb_build_object('ok', false, 'error', 'account_not_owned');
    end if;
    insert into public.recurring_rules(
      user_id,kind,name,amount,account_id,category_id,frequency,day_of_month,start_date,end_date,status
    ) values (
      c.user_id,coalesce(p->>'kind','expense')::public.transaction_type,p->>'name',(p->>'amount')::numeric,
      (p->>'account_id')::uuid,nullif(p->>'category_id','')::uuid,
      coalesce(p->>'frequency','monthly')::public.recurring_frequency,(p->>'day_of_month')::smallint,
      coalesce(nullif(p->>'start_date','')::date,current_date),nullif(p->>'end_date','')::date,'active'::public.recurring_status
    ) returning id into v_id;
    r := jsonb_build_object('kind','recurring_create','recurring_id',v_id,'name',p->>'name');

  elsif c.kind = 'recurring_update' then
    v_id := (p->>'recurring_id')::uuid;
    patch := coalesce(p->'patch','{}'::jsonb);
    if patch ? 'amount' and (patch->>'amount')::numeric <= 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_amount');
    end if;
    if patch ? 'day_of_month' and (patch->>'day_of_month')::integer not between 1 and 31 then
      return jsonb_build_object('ok', false, 'error', 'invalid_day_of_month');
    end if;
    if patch ? 'status' and (patch->>'status') not in ('active','paused','finished') then
      return jsonb_build_object('ok', false, 'error', 'invalid_recurring_status');
    end if;
    update public.recurring_rules x set
      name=case when patch ? 'name' then nullif(btrim(patch->>'name'),'') else x.name end,
      amount=case when patch ? 'amount' then (patch->>'amount')::numeric else x.amount end,
      day_of_month=case when patch ? 'day_of_month' then (patch->>'day_of_month')::smallint else x.day_of_month end,
      status=case when patch ? 'status' then (patch->>'status')::public.recurring_status else x.status end,
      end_date=case when patch ? 'end_date' then nullif(patch->>'end_date','')::date else x.end_date end,
      updated_at=now()
     where x.id=v_id and x.user_id=c.user_id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then return jsonb_build_object('ok', false, 'error', 'recurring_not_owned'); end if;
    r := jsonb_build_object('kind','recurring_update','recurring_id',v_id,'changed_fields',
      (select coalesce(jsonb_agg(k),'[]'::jsonb) from jsonb_object_keys(patch) k));

  elsif c.kind = 'recurring_delete' then
    v_id := (p->>'recurring_id')::uuid;
    update public.recurring_rules set status='finished'::public.recurring_status,
      end_date=coalesce(end_date,current_date),updated_at=now()
     where id=v_id and user_id=c.user_id and status <> 'finished';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then return jsonb_build_object('ok', false, 'error', 'recurring_not_owned_or_finished'); end if;
    r := jsonb_build_object('kind','recurring_delete','recurring_id',v_id,'finished',true);

  else
    return jsonb_build_object('ok', false, 'error', 'unsupported_lifecycle_kind');
  end if;

  update public.pending_confirmations
     set status='confirmed', executed_at=now(), result_snapshot=r,
         confirmed_from_message_id=p_source_message_id
   where id=c.id;

  return jsonb_build_object('ok', true, 'idempotent', false, 'result', r);
end;
$$;

revoke all on function public.agent_execute_lifecycle_confirmation_v1(uuid,uuid) from public;
grant execute on function public.agent_execute_lifecycle_confirmation_v1(uuid,uuid) to authenticated, service_role;
