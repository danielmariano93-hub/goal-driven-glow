-- Add test_users to metrics_health block inside admin_v2_cockpit.
-- We only rewrite that jsonb key; SQL below re-defines the function preserving the rest.
-- Simpler: patch via CREATE OR REPLACE with the same body plus new field.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc
   where proname = 'admin_v2_cockpit'
     and pronamespace = 'public'::regnamespace
   limit 1;
  if v_def is null then raise exception 'admin_v2_cockpit not found'; end if;
  if position('''test_users''' in v_def) > 0 then
    return; -- already patched
  end if;
  v_def := replace(
    v_def,
    '''client_users'',(SELECT count(*)::int FROM public.v_client_users),',
    '''client_users'',(SELECT count(*)::int FROM public.v_client_users),' || chr(10) ||
    '      ''test_users'',(SELECT count(*)::int FROM public.profiles WHERE is_test),'
  );
  execute v_def;
end $$;