-- Indicador "Tela pronta": quanto tempo a pessoa espera entre abrir uma tela e ela estar utilizável
-- (conteúdo desenhado e consultas iniciais respondidas). Medido no aparelho, por tela, com p75 (padrão de RUM).
create table if not exists public.client_perf_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  occurred_at timestamptz not null default now(),
  route text not null,
  nav_kind text not null check (nav_kind in ('cold','soft')),
  ready_ms integer not null check (ready_ms between 0 and 120000),
  timed_out boolean not null default false,
  ttfb_ms integer,
  fcp_ms integer,
  lcp_ms integer,
  device text not null default 'desconhecido' check (device in ('ios','android','desktop','desconhecido')),
  standalone boolean not null default false,
  conn text,
  build text
);
create index if not exists client_perf_events_route_idx on public.client_perf_events (route, occurred_at desc);
create index if not exists client_perf_events_time_idx on public.client_perf_events (occurred_at desc);
alter table public.client_perf_events enable row level security;
revoke all on public.client_perf_events from anon, authenticated;
-- sem políticas: leitura e escrita só pelas funções abaixo

-- Gravação (app → banco): valida, limita e normaliza. Nunca derruba a tela: erros viram no-op para quem chama.
create or replace function public.client_perf_record(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); it jsonb; n int := 0; v_route text; v_kind text; v_ready int; v_dev text; recent int;
begin
  if uid is null or p_events is null or jsonb_typeof(p_events) <> 'array' then return 0; end if;
  select count(*) into recent from public.client_perf_events where user_id = uid and occurred_at > now() - interval '1 hour';
  if recent >= 600 then return 0; end if;
  for it in select * from jsonb_array_elements(p_events) limit 25 loop
    v_route := left(coalesce(it->>'route', ''), 80);
    continue when v_route !~ '^/[a-z0-9/:_-]*$';
    v_kind := case when it->>'nav_kind' = 'cold' then 'cold' else 'soft' end;
    continue when coalesce(it->>'ready_ms', '') !~ '^[0-9]+(\.[0-9]+)?$';
    v_ready := least(120000, (it->>'ready_ms')::numeric)::int;
    v_dev := case when it->>'device' in ('ios','android','desktop') then it->>'device' else 'desconhecido' end;
    insert into public.client_perf_events(user_id, route, nav_kind, ready_ms, timed_out, ttfb_ms, fcp_ms, lcp_ms, device, standalone, conn, build)
    values (uid, v_route, v_kind, v_ready, coalesce((it->>'timed_out')::boolean, false),
      case when (it->>'ttfb_ms') ~ '^[0-9]+(\.[0-9]+)?$' then least(120000, (it->>'ttfb_ms')::numeric)::int end,
      case when (it->>'fcp_ms') ~ '^[0-9]+(\.[0-9]+)?$' then least(120000, (it->>'fcp_ms')::numeric)::int end,
      case when (it->>'lcp_ms') ~ '^[0-9]+(\.[0-9]+)?$' then least(120000, (it->>'lcp_ms')::numeric)::int end,
      v_dev, coalesce((it->>'standalone')::boolean, false), left(it->>'conn', 12), left(it->>'build', 12));
    n := n + 1;
  end loop;
  return n;
exception when others then
  return 0;
end $function$;
revoke all on function public.client_perf_record(jsonb) from public, anon;
grant execute on function public.client_perf_record(jsonb) to authenticated;

-- Leitura (painel admin): p50/p75/p95 por tela, por aparelho, por versão e por dia.
-- "Rápida" = pronta em até 2 s (tela já aberta no app) ou 3 s (primeira abertura, que baixa o app).
create or replace function public.admin_perf_screens(_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare d int := greatest(1, least(coalesce(_days, 7), 60)); result jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with e as (
    select *, (ready_ms <= case when nav_kind = 'cold' then 3000 else 2000 end and not timed_out) as fast
      from public.client_perf_events where occurred_at >= now() - make_interval(days => d)
  )
  select jsonb_build_object(
    'days', d,
    'overall', (select jsonb_build_object('n', count(*), 'p50', percentile_cont(0.5) within group (order by ready_ms),
        'p75', percentile_cont(0.75) within group (order by ready_ms), 'p95', percentile_cont(0.95) within group (order by ready_ms),
        'fast_pct', round(100.0 * count(*) filter (where fast) / nullif(count(*), 0), 1),
        'timed_out', count(*) filter (where timed_out), 'users', count(distinct user_id)) from e),
    'soft', (select jsonb_build_object('n', count(*), 'p75', percentile_cont(0.75) within group (order by ready_ms)) from e where nav_kind = 'soft'),
    'cold', (select jsonb_build_object('n', count(*), 'p75', percentile_cont(0.75) within group (order by ready_ms),
        'ttfb_p75', percentile_cont(0.75) within group (order by ttfb_ms), 'fcp_p75', percentile_cont(0.75) within group (order by fcp_ms),
        'lcp_p75', percentile_cont(0.75) within group (order by lcp_ms)) from e where nav_kind = 'cold'),
    'screens', coalesce((select jsonb_agg(x order by x.p75 desc) from (
        select route, count(*) n, round(percentile_cont(0.5) within group (order by ready_ms)) p50,
               round(percentile_cont(0.75) within group (order by ready_ms)) p75, round(percentile_cont(0.95) within group (order by ready_ms)) p95,
               round(100.0 * count(*) filter (where fast) / count(*), 1) fast_pct, count(*) filter (where timed_out) timed_out
          from e where nav_kind = 'soft' group by route having count(*) >= 3) x), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(x order by x.day) from (
        select (occurred_at at time zone 'America/Sao_Paulo')::date as day, count(*) n,
               round(percentile_cont(0.5) within group (order by ready_ms)) p50, round(percentile_cont(0.75) within group (order by ready_ms)) p75
          from e group by 1) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(x order by x.n desc) from (
        select device, standalone, count(*) n, round(percentile_cont(0.75) within group (order by ready_ms)) p75 from e group by 1, 2) x), '[]'::jsonb),
    'builds', coalesce((select jsonb_agg(x order by x.last_seen desc) from (
        select build, count(*) n, round(percentile_cont(0.75) within group (order by ready_ms)) p75, max(occurred_at) last_seen
          from e where build is not null group by 1 order by max(occurred_at) desc limit 5) x), '[]'::jsonb)
  ) into result;
  return result;
end $function$;
revoke all on function public.admin_perf_screens(integer) from public, anon;
grant execute on function public.admin_perf_screens(integer) to authenticated;

-- Retenção: o histórico detalhado vale 45 dias (o painel só olha até 60 dias e o dado é de tendência, não de auditoria).
select cron.schedule('client-perf-retention', '17 3 * * *', $$delete from public.client_perf_events where occurred_at < now() - interval '45 days'$$);
