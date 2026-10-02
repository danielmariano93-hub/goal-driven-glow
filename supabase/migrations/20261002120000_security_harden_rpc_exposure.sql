-- Endurecimento de exposição de RPCs (auditoria de segurança de 02/10/2026).
-- Achado: ~121 funções SECURITY DEFINER do schema public eram executáveis por `anon`
-- (chave pública do app) via /rest/v1/rpc. Várias recebem user_id e tratam
-- `auth.uid() IS NULL` como "chamada de serviço": qualquer pessoa sem login lia dados
-- financeiros de qualquer usuário (nino_expense_sum, debt_obligation_state) e gravava
-- (agent_learn_merchant_category).

-- 1) anon e PUBLIC perdem EXECUTE em toda função SECURITY DEFINER do public,
--    exceto resolve_short_link (página pública de link curto).
--    authenticated e service_role mantêm o que já tinham.
do $$
declare
  r record;
  had_auth boolean;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prokind in ('f', 'p')
  loop
    had_auth := has_function_privilege('authenticated', r.oid, 'execute');
    execute format('revoke execute on function %s from public', r.sig);
    if r.proname = 'resolve_short_link' then
      execute format('grant execute on function %s to anon', r.sig);
    else
      execute format('revoke execute on function %s from anon', r.sig);
    end if;
    if had_auth then execute format('grant execute on function %s to authenticated', r.sig); end if;
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- 2) Funções novas não nascem executáveis por anon/PUBLIC.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- 3) Funções internas em SQL puro (sem corpo para guardar): só serviço/cron.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('finance_facts_mark_failed', 'finance_facts_mark_processed', 'insight_learning_bump', 'nino_expense_sum')
  loop
    execute format('revoke execute on function %s from authenticated', r.sig);
  end loop;
end $$;

-- 4) Funções internas plpgsql que recebem user_id: quem está logado só age sobre si mesmo
--    (auth.uid() nulo = serviço/cron, que anon já não alcança).
do $$
declare
  specs text[] := array[
    'agent_learn_merchant_category:p_user_id', 'backfill_card_competence:p_user_id',
    'challenge_sync_activity:_user_id', 'finance_facts_enqueue_history:p_user',
    'finance_facts_mark_processed_v2:p_user', 'finance_snapshot_refresh_done:p_user',
    'finance_snapshot_refresh_failed:p_user', 'match_card_installment:p_user_id',
    'nino_build_facts:_user_id', 'nino_consolidate_topics:_user_id', 'nino_curate_items:_user_id',
    'nino_group_duplicates:_user_id', 'nino_topic_threads_lifecycle:p_user_id',
    'refund_matcher_run:p_user_id', '_sg_notify:_user_id', '_split_claim_for_user:p_user_id',
    'agent_upsert_draft:p_user_id', 'ensure_pseudonym:_user_id', 'financial_truth_changed:_user_id',
    'notify_upsert:p_user_id', 'split_assert_financial_source:p_user_id'
  ];
  s text;
  fname text;
  arg text;
  r record;
  def text;
  guard text;
begin
  foreach s in array specs loop
    fname := split_part(s, ':', 1);
    arg := split_part(s, ':', 2);
    guard := format(E'\n  IF auth.uid() IS NOT NULL AND %1$s IS NOT NULL AND auth.uid() IS DISTINCT FROM %1$s THEN RAISE EXCEPTION ''forbidden'' USING ERRCODE = ''42501''; END IF;', arg);
    for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fname loop
      def := pg_get_functiondef(r.oid);
      if def !~* E'\nBEGIN\\s*\n' or def like '%''forbidden''%' then continue; end if;
      def := regexp_replace(def, E'\nBEGIN(\\s*\n)', E'\nBEGIN\\1' || replace(guard, '\', '\\') || E'\n', 'i');
      execute def;
    end loop;
  end loop;
end $$;

-- 5) Simulador do admin (injeta mensagem como qualquer usuário): só admin da plataforma.
do $$
declare
  r record;
  def text;
  guard text := E'\n  IF auth.uid() IS NOT NULL AND NOT public.has_platform_permission(''cockpit.read'') THEN RAISE EXCEPTION ''forbidden'' USING ERRCODE = ''42501''; END IF;';
begin
  for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('agent_sim_enqueue', 'agent_sim_reset') loop
    def := pg_get_functiondef(r.oid);
    if def !~* E'\nBEGIN\\s*\n' or def like '%has_platform_permission%' then continue; end if;
    def := regexp_replace(def, E'\nBEGIN(\\s*\n)', E'\nBEGIN\\1' || replace(guard, '\', '\\') || E'\n', 'i');
    execute def;
  end loop;
end $$;

-- 6) Views internas não são para a chave pública.
revoke all on public.v_agent_cost_by_user, public.v_agent_efficiency_daily, public.v_communication_ledger,
  public.my_shared_charges, public.split_receivables_v1 from anon;
