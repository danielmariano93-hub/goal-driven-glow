-- ADMIN CONTRACT HEALTH
-- Diagnostic endpoint without PII. It makes frontend/backend drift visible
-- before a whole administrative page becomes blank.

begin;

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
      'product_events', (select count(*)::integer from public.product_events),
      'transactions', (select count(*)::integer from public.transactions),
      'outbound_messages', (select count(*)::integer from public.outbound_messages),
      'active_admins', (select count(*)::integer from public.platform_admins where active)
    ),
    'contracts', jsonb_build_object(
      'cockpit', jsonb_build_object(
        'function', 'admin_v2_cockpit',
        'arguments', jsonb_build_array('_from', '_to')
      ),
      'daily_evolution', jsonb_build_object(
        'function', 'admin_v2_daily_evolution',
        'arguments', jsonb_build_array('_from', '_to', '_tz')
      ),
      'growth_summary', jsonb_build_object(
        'function', 'admin_v2_growth_summary',
        'arguments', jsonb_build_array('_from', '_to', '_tz')
      ),
      'clients', jsonb_build_object(
        'function', 'admin_v2_clients_list',
        'arguments', jsonb_build_array('_from', '_to', '_tz', '_limit', '_lifecycle', '_financial')
      )
    ),
    'formula_version', 'admin.contract-health.v1',
    'measured_at', now()
  );
end;
$$;

revoke all on function public.admin_v2_contract_health() from public;
revoke execute on function public.admin_v2_contract_health() from anon, sandbox_exec;
grant execute on function public.admin_v2_contract_health() to authenticated, service_role;

-- Harden the two functions introduced by the previous patch in environments
-- that automatically grant EXECUTE to anon during DDL.
revoke execute on function public.admin_v2_message_intelligence(integer) from anon, sandbox_exec;
revoke execute on function public.admin_v2_retry_failed_outbound(integer) from anon, sandbox_exec;

commit;
