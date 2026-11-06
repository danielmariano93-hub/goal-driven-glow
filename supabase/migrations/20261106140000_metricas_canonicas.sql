-- nino_metrics_canonical.v1 — uma definição por conceito, lida por todos os painéis de qualidade.
-- Motivo: o mesmo conceito aparecia com números diferentes em telas diferentes. Em 06/11/2026 (7 dias):
--   operations_health: 519 conversas, 134 erros, 74,2% de sucesso, p50 8,4 s   (contava simulador)
--   command_center:     52 conversas,   3 erros, 94,2% de sucesso, p50 1,8 s   (excluía simulador)
-- Regra: "conversa real" = fora do simulador e fora de contas de teste/sandbox; "pedir um dado" (needs_*) não é falha.
-- Custo/tokens NÃO usam esta visão: o simulador gasta dinheiro de verdade e precisa aparecer na conta.
-- Telas por usuário (ficha do cliente, reprocesso de mensagem) também ficam de fora: lá o dado bruto é o objetivo.

-- 1) Conversas reais. A visão é gerada a partir das colunas de agent_runs (a coluna `status` é traduzida; a original fica em `raw_status`).
create or replace function public.refresh_v_real_agent_runs()
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare cols text;
begin
  select string_agg(
           case when column_name = 'status'
                then 'case when a.status::text = ''error'' and coalesce(a.error_sanitized, a.error_masked, '''') like ''needs\_%'' then ''done''::' || quote_ident(udt_schema) || '.' || quote_ident(udt_name) || ' else a.status end as status'
                else 'a.' || quote_ident(column_name) end, ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'agent_runs';
  execute 'create or replace view public.v_real_agent_runs as select ' || cols || ', a.status as raw_status from public.agent_runs a '
       || 'where coalesce(a.channel, '''') <> ''simulator'' '
       || 'and not exists (select 1 from public.profiles p where p.id = a.user_id and (p.is_test or p.is_sandbox))';
  execute 'revoke all on public.v_real_agent_runs from public, anon, authenticated';
  execute 'grant select on public.v_real_agent_runs to service_role';
end $$;
revoke all on function public.refresh_v_real_agent_runs() from public, anon, authenticated;
grant execute on function public.refresh_v_real_agent_runs() to service_role;
select public.refresh_v_real_agent_runs();
comment on view public.v_real_agent_runs is 'Conversas reais do agente: sem simulador, sem contas de teste/sandbox; needs_* (pedir um dado) conta como concluída. status = resultado para o produto; raw_status = original. Recriar com refresh_v_real_agent_runs() se agent_runs ganhar colunas.';

-- 2) Mensagens reais enviadas: para usuários reais, sem avisos internos (notification/system).
create or replace view public.v_real_outbound as
select o.*
  from public.outbound_messages o
 where o.kind::text not in ('notification', 'system')
   and not exists (select 1 from public.profiles p where p.id = o.user_id and (p.is_test or p.is_sandbox));
revoke all on public.v_real_outbound from public, anon, authenticated;
grant select on public.v_real_outbound to service_role;
comment on view public.v_real_outbound is 'Mensagens de WhatsApp para usuários reais, sem avisos internos. Para fila e reprocesso use outbound_messages.';

-- 3) Painéis de qualidade passam a ler as visões. Substituição textual, idempotente; a definição original fica guardada para desfazer.
create table if not exists public.admin_function_backups (
  id bigint generated always as identity primary key,
  fn_name text not null,
  definition text not null,
  reason text not null,
  saved_at timestamptz not null default now()
);
alter table public.admin_function_backups enable row level security;
revoke all on public.admin_function_backups from public, anon, authenticated;
grant all on public.admin_function_backups to service_role;

do $do$
declare
  fn record; def text; patched text; n_runs int := 0; n_out int := 0;
begin
  for fn in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('admin_v2_operations_health', 'admin_v2_cockpit', 'admin_v2_metrics_universe', 'admin_v2_daily_evolution',
                         'admin_platform_status', 'admin_v2_agent_autonomy', 'admin_v4_command_center', 'ops_alerts_evaluate', 'feature_health_snapshot')
  loop
    def := pg_get_functiondef(fn.oid);
    patched := replace(def, 'public.agent_runs', 'public.v_real_agent_runs');
    if fn.proname = 'admin_v2_cockpit' then
      patched := replace(patched, 'public.outbound_messages', 'public.v_real_outbound');
    end if;
    if patched <> def then
      insert into public.admin_function_backups(fn_name, definition, reason) values (fn.proname, def, 'metricas_canonicas.v1');
      execute patched; n_runs := n_runs + 1;
    end if;
  end loop;

  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_v2_messaging_failure_7d';
  if def is not null and def like '%public.outbound_messages%' then
    insert into public.admin_function_backups(fn_name, definition, reason) values ('admin_v2_messaging_failure_7d', def, 'metricas_canonicas.v1');
    execute replace(def, 'public.outbound_messages', 'public.v_real_outbound'); n_out := n_out + 1;
  end if;
  raise notice 'funções de conversas ajustadas: %, de mensagens: %', n_runs, n_out;
end
$do$;
