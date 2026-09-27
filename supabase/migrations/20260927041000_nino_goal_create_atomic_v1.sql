-- Atomic goal creation + optional initial contribution.
-- One pending confirmation commits both records or neither.

create or replace function public.agent_execute_goal_create_confirmation_v1(
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
  v_goal_id uuid;
  v_contribution_id uuid;
  v_name text;
  v_target numeric;
  v_initial numeric;
  v_priority integer;
  r jsonb;
begin
  select * into c
    from public.pending_confirmations
   where id = p_confirmation_id
   for update;

  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if c.kind <> 'goal_create' then return jsonb_build_object('ok', false, 'error', 'wrong_confirmation_kind'); end if;
  if c.status = 'confirmed' and c.result_snapshot is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'result', c.result_snapshot);
  end if;
  if c.status = 'cancelled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;
  if c.status = 'expired' or c.expires_at < now() then
    update public.pending_confirmations set status = 'expired' where id = c.id and status = 'pending';
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  p := coalesce(c.payload, '{}'::jsonb);
  v_name := nullif(btrim(p->>'name'), '');
  v_target := nullif(p->>'target_amount', '')::numeric;
  v_initial := nullif(p->>'initial_contribution', '')::numeric;
  v_priority := coalesce(nullif(p->>'priority', '')::integer, 3);

  if v_name is null then return jsonb_build_object('ok', false, 'error', 'goal_name_required'); end if;
  if v_target is null or v_target <= 0 then return jsonb_build_object('ok', false, 'error', 'invalid_target_amount'); end if;
  if v_priority not between 1 and 5 then return jsonb_build_object('ok', false, 'error', 'invalid_priority'); end if;
  if v_initial is not null and v_initial <= 0 then return jsonb_build_object('ok', false, 'error', 'invalid_initial_contribution'); end if;

  insert into public.goals(user_id, name, target_amount, target_date, priority)
  values(c.user_id, v_name, v_target, nullif(p->>'target_date', '')::date, v_priority::smallint)
  returning id into v_goal_id;

  if v_initial is not null then
    insert into public.goal_contributions(user_id, goal_id, account_id, amount, occurred_at, notes)
    values(
      c.user_id,
      v_goal_id,
      null,
      v_initial,
      coalesce(nullif(p->>'contribution_date', '')::date, (now() at time zone 'America/Sao_Paulo')::date),
      null
    )
    returning id into v_contribution_id;
  end if;

  r := jsonb_build_object(
    'kind', 'goal_create',
    'goal_id', v_goal_id,
    'name', v_name,
    'target_amount', v_target,
    'initial_contribution', v_initial,
    'contribution_id', v_contribution_id
  );

  update public.pending_confirmations
     set status = 'confirmed',
         executed_at = now(),
         result_snapshot = r,
         confirmed_from_message_id = p_source_message_id
   where id = c.id;

  return jsonb_build_object('ok', true, 'idempotent', false, 'result', r);
end;
$$;

revoke all on function public.agent_execute_goal_create_confirmation_v1(uuid,uuid) from public;
grant execute on function public.agent_execute_goal_create_confirmation_v1(uuid,uuid) to authenticated, service_role;
