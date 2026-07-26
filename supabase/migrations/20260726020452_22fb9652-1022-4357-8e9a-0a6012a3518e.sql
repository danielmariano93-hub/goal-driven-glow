-- Client universe now excludes test accounts as well as platform admins.
begin;

alter table public.profiles
  add column if not exists is_test boolean not null default false;

-- Classify the three seed test users (@t.test, no onboarding).
update public.profiles p
   set is_test = true
  from auth.users u
 where u.id = p.id
   and p.onboarding_completed_at is null
   and lower(u.email) like '%@t.test';

-- is_client_user: real client = not admin, not role=admin, not test.
create or replace function public.is_client_user(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    _user_id is not null
    and not exists (
      select 1 from public.platform_admins pa
       where pa.user_id = _user_id and pa.active = true
    )
    and not exists (
      select 1 from public.user_roles ur
       where ur.user_id = _user_id and ur.role = 'admin'
    )
    and not exists (
      select 1 from public.profiles p
       where p.id = _user_id and p.is_test = true
    );
$$;

-- Recreate v_client_users / v_client_universe (they already use is_client_user,
-- but replace to invalidate any cached plans).
create or replace view public.v_client_users
with (security_invoker = true) as
  select u.id as user_id,
         up.pseudo_id,
         u.created_at as registered_at,
         p.onboarding_completed_at
    from auth.users u
    left join public.user_pseudonyms up on up.user_id = u.id
    left join public.profiles p on p.id = u.id
   where public.is_client_user(u.id);

create or replace view public.v_client_universe
with (security_invoker = true) as
  select u.id as user_id,
         u.created_at
    from auth.users u
   where public.is_client_user(u.id);

-- Admin helper: toggle test flag (auditable, restricted).
create or replace function public.admin_mark_user_as_test(_user_id uuid, _is_test boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role platform_role;
begin
  v_role := public.current_platform_admin_role();
  if v_role is null or v_role not in ('platform_owner','platform_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.profiles
     set is_test = coalesce(_is_test, false)
   where id = _user_id;

  insert into public.platform_admin_audit(actor_user_id, action, target_user_id, meta)
  values (auth.uid(), 'admin_mark_user_as_test', _user_id, jsonb_build_object('is_test', _is_test));

  return jsonb_build_object('ok', true, 'user_id', _user_id, 'is_test', _is_test);
end;
$$;

revoke all on function public.admin_mark_user_as_test(uuid, boolean) from public;
revoke execute on function public.admin_mark_user_as_test(uuid, boolean) from anon, sandbox_exec;
grant execute on function public.admin_mark_user_as_test(uuid, boolean) to authenticated, service_role;

-- Extend contract health with test_users count.
create or replace function public.admin_v2_contract_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing text[];
begin
  perform public._require_perm('operations.read');

  select coalesce(array_agg(expected.name order by expected.name), '{}'::text[])
    into v_missing
  from (
    values
      ('admin_v2_cockpit(date,date)'),
      ('admin_v2_daily_evolution(date,date,text)'),
      ('admin_v2_growth_summary(date,date,text)'),
      ('admin_v2_growth_cohorts(integer)'),
      ('admin_v2_growth_funnel(integer)'),
      ('admin_v2_clients_list(date,date,text,integer,text,text)'),
      ('admin_v2_whatsapp_monitor(integer)'),
      ('admin_v2_message_intelligence(integer)'),
      ('admin_v2_retry_failed_outbound(integer)')
  ) as expected(name)
  where to_regprocedure('public.' || expected.name) is null;

  return jsonb_build_object(
    'healthy', cardinality(v_missing) = 0,
    'missing_contracts', to_jsonb(v_missing),
    'counts', jsonb_build_object(
      'auth_users', (select count(*)::integer from auth.users),
      'client_users', (select count(*)::integer from public.v_client_users),
      'test_users', (select count(*)::integer from public.profiles where is_test = true),
      'product_events', (select count(*)::integer from public.product_events),
      'transactions', (select count(*)::integer from public.transactions),
      'outbound_messages', (select count(*)::integer from public.outbound_messages),
      'active_admins', (select count(*)::integer from public.platform_admins where active)
    ),
    'contracts', jsonb_build_object(
      'cockpit', jsonb_build_object('function','admin_v2_cockpit','arguments', jsonb_build_array('_from','_to')),
      'daily_evolution', jsonb_build_object('function','admin_v2_daily_evolution','arguments', jsonb_build_array('_from','_to','_tz')),
      'growth_summary', jsonb_build_object('function','admin_v2_growth_summary','arguments', jsonb_build_array('_from','_to','_tz')),
      'clients', jsonb_build_object('function','admin_v2_clients_list','arguments', jsonb_build_array('_from','_to','_tz','_limit','_lifecycle','_financial'))
    ),
    'formula_version', 'admin.contract-health.v2',
    'measured_at', now()
  );
end;
$$;

revoke all on function public.admin_v2_contract_health() from public;
revoke execute on function public.admin_v2_contract_health() from anon, sandbox_exec;
grant execute on function public.admin_v2_contract_health() to authenticated, service_role;

commit;