-- admin_v4_command_center com período livre (p_from..p_to) e eficiência por modelo.
-- - Período anterior = janela de mesmo tamanho imediatamente antes de p_from.
-- - Até 48 h a série é por hora; acima disso, por dia (America/Sao_Paulo).
-- - Por modelo: conversas atendidas, tempo, tokens, custo estimado, taxa de falha final e
--   "falhou de primeira" (o modelo foi tentado primeiro e o Nino precisou trocar de modelo).
create or replace function public.admin_v4_command_center(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tz text := 'America/Sao_Paulo';
  v_to timestamptz := least(coalesce(p_to, now()), now() + interval '1 minute');
  v_from timestamptz := coalesce(p_from, v_to - interval '7 days');
  v_span interval;
  v_prev_from timestamptz;
  v_hourly boolean;
  v_out jsonb;
begin
  perform public._require_perm('cockpit.read');
  if v_from >= v_to then v_from := v_to - interval '1 hour'; end if;
  if v_to - v_from > interval '366 days' then v_from := v_to - interval '366 days'; end if;
  v_span := v_to - v_from;
  v_prev_from := v_from - v_span;
  v_hourly := v_span <= interval '48 hours';

  with base as (
    select r.id, r.user_id, r.started_at, r.status, r.path, r.channel, r.latency_ms,
           coalesce(r.tokens_in, 0) tin, coalesce(r.tokens_out, 0) tout, r.model,
           nullif(split_part(split_part(coalesce(r.error_sanitized, r.error_masked, ''), '(', 1), ':', 1), '') err_family,
           coalesce(r.error_sanitized, r.error_masked) err_raw,
           case when r.model like 'v3-%' then split_part(r.model, ':', 1) else null end tier,
           case when r.model like 'v3-%' then substr(r.model, strpos(r.model, ':') + 1) else r.model end chain
    from public.agent_runs r
    where r.started_at >= v_prev_from and r.started_at < v_to
      and coalesce(r.channel, '') <> 'simulator'
      and not exists (select 1 from public.profiles p where p.id = r.user_id and p.is_test)
  ),
  parsed as (
    select b.*,
      nullif(split_part(chain, '->', 1), '') first_model,
      nullif(split_part(chain, '->', 2), '') second_model,
      (strpos(chain, '->') > 0) has_second
    from base b
  ),
  priced as (
    select p.*,
      case
        when tier = 'v3-fallback' then second_model
        when tier = 'v3-deep' then second_model
        when chain in ('routing', 'deterministic') or chain like 'deterministic:%' or chain is null then null
        when tier is null and has_second then second_model
        else first_model
      end served_model,
      (tier = 'v3-fallback' or (tier is null and has_second and chain not like 'deterministic%')) failed_first,
      (tier = 'v3-deep') escalated,
      case
        when coalesce(first_model, '') ilike '%qwen%' then 0.29 when coalesce(first_model, '') ilike '%120b%' then 0.15
        when coalesce(first_model, '') ilike '%20b%' then 0.075 else 0.20 end as _p_first_in
    from parsed p
  ),
  costed as (
    select pr.*,
      (case
         when coalesce(served_model, first_model, '') ilike '%qwen%' then 0.29
         when coalesce(served_model, first_model, '') ilike '%120b%' then 0.15
         when coalesce(served_model, first_model, '') ilike '%20b%' then 0.075
         when chain in ('routing', 'deterministic') or chain like 'deterministic:%' then 0 else 0.20 end) p_in,
      (case
         when coalesce(served_model, first_model, '') ilike '%qwen%' then 0.59
         when coalesce(served_model, first_model, '') ilike '%120b%' then 0.60
         when coalesce(served_model, first_model, '') ilike '%20b%' then 0.30
         when chain in ('routing', 'deterministic') or chain like 'deterministic:%' then 0 else 0.80 end) p_out
    from priced pr
  ),
  cur as (select *, (tin * p_in + tout * p_out) / 1000000.0 cost from costed where started_at >= v_from),
  prev as (select *, (tin * p_in + tout * p_out) / 1000000.0 cost from costed where started_at < v_from),
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
    select case when v_hourly then to_char(date_trunc('hour', started_at at time zone v_tz), 'YYYY-MM-DD"T"HH24:00')
                else to_char((started_at at time zone v_tz)::date, 'YYYY-MM-DD') end as day,
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
  served as (
    select served_model model, count(*) turns,
           round(percentile_cont(0.5) within group (order by latency_ms)) p50,
           round(percentile_cont(0.95) within group (order by latency_ms)) p95,
           sum(tin + tout) tokens, round(sum(cost)::numeric, 4) cost_usd,
           round(count(*) filter (where status = 'error')::numeric / greatest(1, count(*)), 4) error_rate
    from cur where served_model is not null group by 1
  ),
  tried as (
    select first_model model, count(*) attempts,
           count(*) filter (where failed_first) failed_first,
           count(*) filter (where escalated) escalated
    from cur where first_model is not null and chain not like 'deterministic%' and chain <> 'routing' group by 1
  ),
  by_model as (
    select coalesce(s.model, t.model) model,
           coalesce(s.turns, 0) turns, s.p50, s.p95, coalesce(s.tokens, 0) tokens, coalesce(s.cost_usd, 0) cost_usd,
           coalesce(s.error_rate, 0) error_rate,
           coalesce(t.attempts, 0) attempts, coalesce(t.failed_first, 0) failed_first, coalesce(t.escalated, 0) escalated,
           case when coalesce(t.attempts, 0) > 0 then round(t.failed_first::numeric / t.attempts, 4) else null end first_try_failure_rate
    from served s full join tried t on t.model = s.model
    order by coalesce(s.turns, 0) + coalesce(t.attempts, 0) desc
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
    where created_at >= v_from and created_at < v_to
      and not exists (select 1 from public.profiles p where p.id = outbound_messages.user_id and p.is_test)
  ),
  msg_daily as (
    select case when v_hourly then to_char(date_trunc('hour', created_at at time zone v_tz), 'YYYY-MM-DD"T"HH24:00')
                else to_char((created_at at time zone v_tz)::date, 'YYYY-MM-DD') end as day,
           count(*) filter (where status in ('sent', 'delivered')) sent,
           count(*) filter (where status = 'delivered') delivered,
           count(*) filter (where status in ('failed', 'dead')) failed
    from public.outbound_messages o
    where created_at >= v_from and created_at < v_to
      and not exists (select 1 from public.profiles p where p.id = o.user_id and p.is_test)
    group by 1 order by 1
  ),
  msg_fail_reasons as (
    select left(coalesce(last_error, 'sem detalhe'), 90) reason, count(*) n
    from public.outbound_messages o
    where created_at >= v_from and created_at < v_to and status in ('failed', 'dead')
      and not exists (select 1 from public.profiles p where p.id = o.user_id and p.is_test)
    group by 1 order by 2 desc limit 5
  ),
  stuck as (
    select count(*) n from public.outbound_messages
    where status::text in ('queued', 'pending', 'sending', 'processing') and created_at < now() - interval '15 minutes'
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'granularity', case when v_hourly then 'hour' else 'day' end,
    'window_days', greatest(1, round(extract(epoch from v_span) / 86400)),
    'generated_at', now(),
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

revoke all on function public.admin_v4_command_center(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_v4_command_center(timestamptz, timestamptz) to authenticated, service_role;

-- Versão antiga (p_days) vira atalho para a nova.
create or replace function public.admin_v4_command_center(p_days integer default 7)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$ select public.admin_v4_command_center(now() - make_interval(days => greatest(1, least(366, coalesce(p_days, 7)))), now()); $$;

revoke all on function public.admin_v4_command_center(integer) from public, anon;
grant execute on function public.admin_v4_command_center(integer) to authenticated, service_role;
