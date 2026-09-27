-- Frequency-aware recurring lifecycle confirmation.
-- Keeps the rule and its future planned occurrences consistent in one DB txn.

create or replace function public.agent_execute_recurring_confirmation_v1(
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
  v_patch jsonb;
  v_id uuid;
  v_account_id uuid;
  v_category_id uuid;
  v_name text;
  v_kind public.transaction_type;
  v_amount numeric;
  v_frequency public.recurring_frequency;
  v_day smallint;
  v_weekday smallint;
  v_start date;
  v_end date;
  v_status public.recurring_status;
  v_generated integer := 0;
  r jsonb;
begin
  select * into c
    from public.pending_confirmations
   where id = p_confirmation_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if c.kind not in ('recurring_create','recurring_update','recurring_delete') then
    return jsonb_build_object('ok', false, 'error', 'wrong_confirmation_kind');
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

  if c.kind = 'recurring_create' then
    v_name := nullif(btrim(p->>'name'), '');
    v_amount := nullif(p->>'amount', '')::numeric;
    v_account_id := nullif(p->>'account_id', '')::uuid;
    v_category_id := nullif(p->>'category_id', '')::uuid;
    v_kind := coalesce(nullif(p->>'kind', '')::public.transaction_type, 'expense'::public.transaction_type);
    v_frequency := coalesce(nullif(p->>'frequency', '')::public.recurring_frequency, 'monthly'::public.recurring_frequency);
    v_day := nullif(p->>'day_of_month', '')::smallint;
    v_weekday := nullif(p->>'weekday', '')::smallint;
    v_start := coalesce(nullif(p->>'start_date', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
    v_end := nullif(p->>'end_date', '')::date;

    if v_name is null then return jsonb_build_object('ok', false, 'error', 'recurring_name_required'); end if;
    if v_amount is null or v_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'recurring_amount_invalid'); end if;
    if v_account_id is null or not exists(
      select 1 from public.accounts a where a.id = v_account_id and a.user_id = c.user_id and a.active = true
    ) then return jsonb_build_object('ok', false, 'error', 'account_not_owned'); end if;
    if v_category_id is not null and not exists(
      select 1 from public.categories cat
       where cat.id = v_category_id and cat.archived_at is null
         and (cat.user_id = c.user_id or cat.user_id is null)
    ) then return jsonb_build_object('ok', false, 'error', 'category_not_owned'); end if;
    if v_end is not null and v_end < v_start then return jsonb_build_object('ok', false, 'error', 'recurring_end_before_start'); end if;
    if v_frequency = 'monthly' and (v_day is null or v_day not between 1 and 31) then
      return jsonb_build_object('ok', false, 'error', 'recurring_monthly_day_required');
    end if;
    if v_frequency = 'weekly' and (v_weekday is null or v_weekday not between 0 and 6) then
      return jsonb_build_object('ok', false, 'error', 'recurring_weekday_required');
    end if;
    if v_frequency <> 'monthly' then v_day := null; end if;
    if v_frequency <> 'weekly' then v_weekday := null; end if;

    insert into public.recurring_rules(
      user_id, kind, name, amount, account_id, category_id, frequency,
      day_of_month, weekday, start_date, end_date, status, last_generated_at
    ) values (
      c.user_id, v_kind, v_name, v_amount, v_account_id, v_category_id, v_frequency,
      v_day, v_weekday, v_start, v_end, 'active'::public.recurring_status, null
    ) returning id into v_id;

    perform set_config('request.jwt.claim.sub', c.user_id::text, true);
    v_generated := public.recurring_generate_due(60);

    r := jsonb_build_object(
      'kind','recurring_create','recurring_id',v_id,'name',v_name,
      'frequency',v_frequency,'generated_occurrences',v_generated
    );

  elsif c.kind = 'recurring_update' then
    v_id := nullif(p->>'recurring_id', '')::uuid;
    v_patch := coalesce(p->'patch', '{}'::jsonb);
    if v_id is null then return jsonb_build_object('ok', false, 'error', 'recurring_id_required'); end if;

    select
      coalesce(nullif(v_patch->>'name',''), rr.name),
      coalesce(nullif(v_patch->>'amount','')::numeric, rr.amount),
      coalesce(nullif(v_patch->>'account_id','')::uuid, rr.account_id),
      case when v_patch ? 'category_id' then nullif(v_patch->>'category_id','')::uuid else rr.category_id end,
      coalesce(nullif(v_patch->>'frequency','')::public.recurring_frequency, rr.frequency),
      case when v_patch ? 'day_of_month' then nullif(v_patch->>'day_of_month','')::smallint else rr.day_of_month end,
      case when v_patch ? 'weekday' then nullif(v_patch->>'weekday','')::smallint else rr.weekday end,
      coalesce(nullif(v_patch->>'start_date','')::date, rr.start_date),
      case when v_patch ? 'end_date' then nullif(v_patch->>'end_date','')::date else rr.end_date end,
      coalesce(nullif(v_patch->>'status','')::public.recurring_status, rr.status),
      rr.kind
      into v_name, v_amount, v_account_id, v_category_id, v_frequency, v_day, v_weekday,
           v_start, v_end, v_status, v_kind
      from public.recurring_rules rr
     where rr.id = v_id and rr.user_id = c.user_id
     for update;

    if not found then return jsonb_build_object('ok', false, 'error', 'recurring_not_found'); end if;
    if v_name is null or btrim(v_name) = '' then return jsonb_build_object('ok', false, 'error', 'recurring_name_required'); end if;
    if v_amount is null or v_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'recurring_amount_invalid'); end if;
    if not exists(select 1 from public.accounts a where a.id = v_account_id and a.user_id = c.user_id and a.active = true) then
      return jsonb_build_object('ok', false, 'error', 'account_not_owned');
    end if;
    if v_category_id is not null and not exists(
      select 1 from public.categories cat
       where cat.id = v_category_id and cat.archived_at is null
         and (cat.user_id = c.user_id or cat.user_id is null)
    ) then return jsonb_build_object('ok', false, 'error', 'category_not_owned'); end if;
    if v_end is not null and v_end < v_start then return jsonb_build_object('ok', false, 'error', 'recurring_end_before_start'); end if;
    if v_frequency = 'monthly' and (v_day is null or v_day not between 1 and 31) then
      return jsonb_build_object('ok', false, 'error', 'recurring_monthly_day_required');
    end if;
    if v_frequency = 'weekly' and (v_weekday is null or v_weekday not between 0 and 6) then
      return jsonb_build_object('ok', false, 'error', 'recurring_weekday_required');
    end if;
    if v_frequency <> 'monthly' then v_day := null; end if;
    if v_frequency <> 'weekly' then v_weekday := null; end if;

    -- Confirmed/skipped history is immutable. Only future planning is rebuilt.
    delete from public.recurring_occurrences
     where recurring_rule_id = v_id and user_id = c.user_id and status = 'planned';

    update public.recurring_rules
       set name = v_name,
           amount = v_amount,
           account_id = v_account_id,
           category_id = v_category_id,
           frequency = v_frequency,
           day_of_month = v_day,
           weekday = v_weekday,
           start_date = v_start,
           end_date = v_end,
           status = v_status,
           last_generated_at = null,
           updated_at = now()
     where id = v_id and user_id = c.user_id;

    if v_status = 'active'::public.recurring_status then
      perform set_config('request.jwt.claim.sub', c.user_id::text, true);
      v_generated := public.recurring_generate_due(60);
    end if;

    r := jsonb_build_object(
      'kind','recurring_update','recurring_id',v_id,'name',v_name,
      'frequency',v_frequency,'generated_occurrences',v_generated,
      'changed_fields',coalesce((select jsonb_agg(key) from jsonb_object_keys(v_patch) key),'[]'::jsonb)
    );

  else
    v_id := nullif(p->>'recurring_id', '')::uuid;
    if v_id is null then return jsonb_build_object('ok', false, 'error', 'recurring_id_required'); end if;
    if not exists(select 1 from public.recurring_rules rr where rr.id = v_id and rr.user_id = c.user_id) then
      return jsonb_build_object('ok', false, 'error', 'recurring_not_found');
    end if;

    delete from public.recurring_occurrences
     where recurring_rule_id = v_id and user_id = c.user_id and status = 'planned';
    update public.recurring_rules
       set status = 'finished'::public.recurring_status, updated_at = now()
     where id = v_id and user_id = c.user_id;

    r := jsonb_build_object('kind','recurring_delete','recurring_id',v_id,'status','finished');
  end if;

  update public.pending_confirmations
     set status = 'confirmed', executed_at = now(), result_snapshot = r,
         confirmed_from_message_id = p_source_message_id
   where id = c.id;

  return jsonb_build_object('ok', true, 'idempotent', false, 'result', r);
end;
$$;

revoke all on function public.agent_execute_recurring_confirmation_v1(uuid,uuid) from public;
grant execute on function public.agent_execute_recurring_confirmation_v1(uuid,uuid) to authenticated, service_role;
