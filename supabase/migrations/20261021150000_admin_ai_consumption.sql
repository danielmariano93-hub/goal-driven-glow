-- Consumo de IA de TODAS as funções (ai_usage_ledger): proativo, relatórios, categorização, insights, conversa.
-- A Visão geral só olhava `agent_runs` (conversas); quando o chat resolve tudo pelo registro rápido, tokens e custo
-- apareciam zerados mesmo com a IA sendo usada nos bastidores.
create or replace function public.admin_ai_consumption(_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare d int := greatest(1, least(coalesce(_days, 7), 90)); result jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with l as (
    select (occurred_at at time zone 'America/Sao_Paulo')::date as day, workload, model, success, error_code, latency_ms,
           coalesce(input_tokens, 0) tin, coalesce(output_tokens, 0) tout, coalesce(provider_cost_usd, estimated_cost_usd, 0) cost, occurred_at
      from public.ai_usage_ledger
     where occurred_at >= now() - make_interval(days => d)
       and not exists (select 1 from public.profiles p where p.id = ai_usage_ledger.user_id and p.is_test)
  )
  select jsonb_build_object(
    'days', d,
    'totals', (select jsonb_build_object('calls', count(*), 'tokens_in', coalesce(sum(tin), 0), 'tokens_out', coalesce(sum(tout), 0),
                 'cost_usd', round(coalesce(sum(cost), 0)::numeric, 4), 'failures', count(*) filter (where not success)) from l),
    'daily', coalesce((select jsonb_agg(x order by x.day) from (
        select day, count(*) calls, sum(tin) tokens_in, sum(tout) tokens_out, round(sum(cost)::numeric, 4) cost_usd from l group by day) x), '[]'::jsonb),
    'by_workload', coalesce((select jsonb_agg(x order by x.cost_usd desc, x.calls desc) from (
        select workload, count(*) calls, sum(tin + tout) tokens, round(sum(cost)::numeric, 4) cost_usd,
               count(*) filter (where not success) failures, round(avg(latency_ms)) avg_ms from l group by workload) x), '[]'::jsonb),
    'by_model', coalesce((select jsonb_agg(x order by x.calls desc) from (
        select model, count(*) calls, sum(tin + tout) tokens, round(sum(cost)::numeric, 4) cost_usd,
               count(*) filter (where not success) failures, round(avg(latency_ms)) avg_ms from l group by model) x), '[]'::jsonb),
    'failures', coalesce((select jsonb_agg(x order by x.n desc) from (
        select workload, coalesce(error_code, 'sem_codigo') error_code, count(*) n, max(occurred_at) last_at from l where not success group by 1, 2 limit 10) x), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.admin_ai_consumption(integer) from public, anon;
grant execute on function public.admin_ai_consumption(integer) to authenticated;
