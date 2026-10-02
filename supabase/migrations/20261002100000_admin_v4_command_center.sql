-- admin_v4_command_center: painel acionável do admin (volume, qualidade, latência,
-- tokens, custo estimado, entrega de mensagens e itens de atenção).
-- Exclui usuários de teste e o canal "simulator". Custo é ESTIMADO por tokens × preço
-- público do modelo (o runtime ainda não grava custo real por execução).
create or replace function public.admin_v4_command_center(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_days int := greatest(1, least(90, coalesce(p_days, 7)));
  v_tz text := 'America/Sao_Paulo';
  v_to timestamptz := now();
  v_from timestamptz := now() - make_interval(days => v_days);
  v_prev_from timestamptz := now() - make_interval(days => v_days * 2);
  v_out jsonb;
begin
  perform public._require_perm('cockpit.read');

  with base as (
    select r.id, r.user_id, r.started_at, r.status, r.path, r.channel, r.latency_ms,
           coalesce(r.tokens_in, 0) tin, coalesce(r.tokens_out, 0) tout, r.model, r.capability,
           nullif(split_part(split_part(coalesce(r.error_sanitized, r.error_masked, ''), '(', 1), ':', 1), '') err_family,
           coalesce(r.error_sanitized, r.error_masked) err_raw,
           case
             when r.model ilike '%qwen%' then 'qwen3 27b'
             when r.model ilike '%120b%' then 'gpt-oss 120b'
             when r.model ilike '%20b%' then 'gpt-oss 20b'
             when r.model ilike 'deterministic%' or r.model = 'routing' or r.model is null then 'sem LLM'
             else regexp_replace(r.model, '^v3-[a-z_]+:', '')
           end model_family,
           case
             when r.model ilike '%qwen%' then 0.29 when r.model ilike '%120b%' then 0.15
             when r.model ilike '%20b%' then 0.075 else 0 end p_in,
           case
             when r.model ilike '%qwen%' then 0.59 when r.model ilike '%120b%' then 0.60
             when r.model ilike '%20b%' then 0.30 else 0 end p_out
    from public.agent_runs r
    where r.started_at >= v_prev_from
      and coalesce(r.channel, '') <> 'simulator'
      and not exists (select 1 from public.profiles p where p.id = r.user_id and p.is_test)
  ),
  cur as (select *, (tin * p_in + tout * p_out) / 1000000.0 cost from base where started_at >= v_from),
  prev as (select *, (tin * p_in + tout * p_out) / 1000000.0 cost from base where started_at < v_from),
  agg as (
    select
      (select count(*) from cur) turns,
      (select count(*) from prev) turns_prev,
      (select count(distinct user_id) from cur) users,
      (select count(distinct user_id) from prev) users_prev,
      (select round(count(*) filter (where status = 'error')::numeric / greatest(1, count(*)), 4) from cur) err_rate,
      (select round(count(*) filter (where status = 'error')::numeric / greatest(1, count(*)), 4) from prev) err_rate_prev,
      (select round(percentile_cont(0.5) within group (order by latency_ms)) from cur where latency_ms is not null) p50,
      (select round(percentile_cont(0.95) within group (order by latency_ms)) from cur where latency_ms is not null) p95,
      (select round(percentile_cont(0.5) within group (order by latency_ms)) from prev where latency_ms is not null) p50_prev,
      (select round(percentile_cont(0.95) within group (order by latency_ms)) from prev where latency_ms is not null) p95_prev,
      (select coalesce(sum(tin), 0) from cur) tin,
      (select coalesce(sum(tout), 0) from cur) tout,
      (select coalesce(sum(tin + tout), 0) from prev) tok_prev,
      (select round(coalesce(sum(cost), 0)::numeric, 4) from cur) cost,
      (select round(coalesce(sum(cost), 0)::numeric, 4) from prev) cost_prev,
      (select round(count(*) filter (where path = 'llm')::numeric / greatest(1, count(*)), 4) from cur) llm_share,
      (select round(count(*) filter (where path = 'deterministic_fallback')::numeric / greatest(1, count(*)), 4) from cur) fallback_rate
  ),
  daily as (
    select to_char((started_at at time zone v_tz)::date, 'YYYY-MM-DD') as day,
           count(*) turns, count(*) filter (where status = 'error') errors,
           round(percentile_cont(0.5) within group (order by latency_ms)) p50,
           round(percentile_cont(0.95) within group (order by latency_ms)) p95,
           sum(tin) tokens_in, sum(tout) tokens_out,
           round(sum(cost)::numeric, 4) cost_usd, count(distinct user_id) users
    from cur group by 1 order by 1
  ),
  by_path as (
    select coalesce(path, 'desconhecido') path, count(*) turns,
           round(percentile_cont(0.95) within group (order by latency_ms)) p95,
           round(count(*) filter (where status = 'error')::numeric / greatest(1, count(*)), 4) error_rate
    from cur group by 1 order by 2 desc
  ),
  by_model as (
    select model_family, count(*) turns,
           round(percentile_cont(0.5) within group (order by latency_ms)) p50,
           round(percentile_cont(0.95) within group (order by latency_ms)) p95,
           sum(tin + tout) tokens, round(sum(cost)::numeric, 4) cost_usd,
           round(count(*) filter (where status = 'error')::numeric / greatest(1, count(*)), 4) error_rate
    from cur group by 1 order by 2 desc
  ),
  by_channel as (
    select coalesce(channel, 'desconhecido') channel, count(*) turns,
           round(percentile_cont(0.95) within group (order by latency_ms)) p95,
           round(count(*) filter (where status = 'error')::numeric / greatest(1, count(*)), 4) error_rate
    from cur group by 1 order by 2 desc
  ),
  top_errors as (
    select err_family reason, count(*) n, max(started_at) last_at,
           (array_agg(left(err_raw, 160) order by started_at desc))[1] sample
    from cur where status = 'error' and err_family is not null
    group by 1 order by 2 desc limit 8
  ),
  msg as (
    select
      count(*) filter (where status in ('sent', 'delivered')) ok_n,
      count(*) filter (where status in ('failed', 'dead')) failed_n,
      count(*) filter (where status = 'delivered') delivered_n,
      count(*) total_n
    from public.outbound_messages
    where created_at >= v_from
      and not exists (select 1 from public.profiles p where p.id = outbound_messages.user_id and p.is_test)
  ),
  msg_daily as (
    select to_char((created_at at time zone v_tz)::date, 'YYYY-MM-DD') as day,
           count(*) filter (where status in ('sent', 'delivered')) sent,
           count(*) filter (where status = 'delivered') delivered,
           count(*) filter (where status in ('failed', 'dead')) failed
    from public.outbound_messages o
    where created_at >= v_from
      and not exists (select 1 from public.profiles p where p.id = o.user_id and p.is_test)
    group by 1 order by 1
  ),
  msg_fail_reasons as (
    select left(coalesce(last_error, 'sem detalhe'), 90) reason, count(*) n
    from public.outbound_messages o
    where created_at >= v_from and status in ('failed', 'dead')
      and not exists (select 1 from public.profiles p where p.id = o.user_id and p.is_test)
    group by 1 order by 2 desc limit 5
  ),
  stuck as (
    select count(*) n from public.outbound_messages
    where status::text in ('queued', 'pending', 'sending', 'processing') and created_at < now() - interval '15 minutes'
  )
  select jsonb_build_object(
    'window_days', v_days,
    'generated_at', now(),
    'from', v_from, 'to', v_to,
    'cost_note', 'Custo estimado: tokens × preço público do modelo. O runtime ainda não registra custo real por execução.',
    'totals', (select to_jsonb(agg) from agg),
    'daily', coalesce((select jsonb_agg(to_jsonb(daily)) from daily), '[]'::jsonb),
    'by_path', coalesce((select jsonb_agg(to_jsonb(by_path)) from by_path), '[]'::jsonb),
    'by_model', coalesce((select jsonb_agg(to_jsonb(by_model)) from by_model), '[]'::jsonb),
    'by_channel', coalesce((select jsonb_agg(to_jsonb(by_channel)) from by_channel), '[]'::jsonb),
    'top_errors', coalesce((select jsonb_agg(to_jsonb(top_errors)) from top_errors), '[]'::jsonb),
    'messaging', jsonb_build_object(
      'total', (select total_n from msg), 'sent', (select ok_n from msg),
      'delivered', (select delivered_n from msg), 'failed', (select failed_n from msg),
      'stuck_queue', (select n from stuck),
      'daily', coalesce((select jsonb_agg(to_jsonb(msg_daily)) from msg_daily), '[]'::jsonb),
      'fail_reasons', coalesce((select jsonb_agg(to_jsonb(msg_fail_reasons)) from msg_fail_reasons), '[]'::jsonb)
    )
  ) into v_out;

  return v_out;
end;
$function$;

revoke all on function public.admin_v4_command_center(integer) from public, anon;
grant execute on function public.admin_v4_command_center(integer) to authenticated;
