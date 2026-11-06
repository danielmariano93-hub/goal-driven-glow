-- Rodar a bateria pelo painel: fila de rodadas, ajustes da rodada automática e rotina de 1 minuto que toca a fila.
-- Uma rodada completa dura mais do que uma Edge Function aguenta; o worker (nino-synthetic, ação `tick`) processa uma
-- fatia por chamada. Só contas de teste são usadas; clientes reais nunca entram.

create table if not exists public.synthetic_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  source text not null default 'manual' check (source in ('manual', 'schedule')),
  label text,
  config jsonb not null default '{}'::jsonb,
  cursor jsonb not null default '{}'::jsonb,
  run_id uuid references public.synthetic_runs(id) on delete set null,
  total int not null default 0,
  done int not null default 0,
  error text,
  requested_by uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists synthetic_jobs_active_idx on public.synthetic_jobs (created_at) where status in ('queued', 'running');
alter table public.synthetic_jobs enable row level security;
drop policy if exists synthetic_jobs_admin_read on public.synthetic_jobs;
create policy synthetic_jobs_admin_read on public.synthetic_jobs for select to authenticated using (public.is_current_user_admin());

create table if not exists public.synthetic_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  every_hours int not null default 24 check (every_hours between 1 and 168),
  tpm int not null default 120000 check (tpm between 20000 and 400000),
  lanes int not null default 2 check (lanes between 1 and 4),
  last_enqueued_at timestamptz
);
insert into public.synthetic_settings (id) values (1) on conflict do nothing;
alter table public.synthetic_settings enable row level security;
drop policy if exists synthetic_settings_admin_read on public.synthetic_settings;
create policy synthetic_settings_admin_read on public.synthetic_settings for select to authenticated using (public.is_current_user_admin());

-- Estado para o painel: ajustes, rodada em andamento e as últimas rodadas da fila.
create or replace function public.admin_synthetic_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'settings', (select to_jsonb(s) from public.synthetic_settings s where id = 1),
    'active', (select to_jsonb(j) - 'config' - 'cursor' from public.synthetic_jobs j where status in ('queued', 'running') order by created_at limit 1),
    'recent', coalesce((select jsonb_agg(to_jsonb(j) - 'config' - 'cursor' order by j.created_at desc) from (select * from public.synthetic_jobs order by created_at desc limit 5) j), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_synthetic_state() from public, anon;
grant execute on function public.admin_synthetic_state() to authenticated;

-- Enfileira uma rodada. Só uma por vez; a configuração é saneada (personas conhecidas, repetições 1 a 3).
create or replace function public.admin_synthetic_enqueue(p_config jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb; v_id uuid; v_personas jsonb; v_only jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  if exists (select 1 from public.synthetic_jobs where status in ('queued', 'running')) then
    return jsonb_build_object('ok', false, 'reason', 'already_running');
  end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_personas from jsonb_array_elements_text(coalesce(p_config->'personas', '[]'::jsonb)) x where x ~ '^[a-z0-9_]{2,40}$';
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_only from jsonb_array_elements_text(coalesce(p_config->'only', '[]'::jsonb)) x where x ~ '^[A-Z][0-9]{2}$';
  v_cfg := jsonb_build_object(
    'personas', v_personas, 'only', v_only,
    'styles', case when p_config->>'styles' in ('rotate', 'all') then p_config->>'styles' else 'rotate' end,
    'reps', greatest(1, least(3, coalesce((p_config->>'reps')::int, 1))),
    'llm', coalesce((p_config->>'llm')::boolean, false),
    'ref', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'));
  insert into public.synthetic_jobs (source, label, config, requested_by)
  values ('manual', coalesce(nullif(left(p_config->>'label', 80), ''), 'Rodada pelo painel'), v_cfg, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'job_id', v_id);
end $$;
revoke all on function public.admin_synthetic_enqueue(jsonb) from public, anon;
grant execute on function public.admin_synthetic_enqueue(jsonb) to authenticated;

create or replace function public.admin_synthetic_cancel(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  update public.synthetic_jobs set status = 'cancelled', lease_until = null, finished_at = now()
   where id = p_job and status in ('queued', 'running');
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_synthetic_cancel(uuid) from public, anon;
grant execute on function public.admin_synthetic_cancel(uuid) to authenticated;

create or replace function public.admin_synthetic_settings_save(_enabled boolean, _every_hours integer, _tpm integer default null, _lanes integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  update public.synthetic_settings set
    enabled = coalesce(_enabled, enabled),
    every_hours = greatest(1, least(168, coalesce(_every_hours, every_hours))),
    tpm = greatest(20000, least(400000, coalesce(_tpm, tpm))),
    lanes = greatest(1, least(4, coalesce(_lanes, lanes)))
   where id = 1;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_synthetic_settings_save(boolean, integer, integer, integer) from public, anon;
grant execute on function public.admin_synthetic_settings_save(boolean, integer, integer, integer) to authenticated;

-- Rotina de 1 minuto: enfileira a rodada automática quando vence e, havendo rodada ativa, chama o worker.
create or replace function public.synthetic_tick()
returns bigint language plpgsql security definer set search_path to 'public', 'extensions', 'vault' as $$
declare s record; secret_value text; request_id bigint;
begin
  select * into s from public.synthetic_settings where id = 1;
  if s.enabled and (s.last_enqueued_at is null or s.last_enqueued_at <= now() - make_interval(hours => s.every_hours))
     and not exists (select 1 from public.synthetic_jobs where status in ('queued', 'running')) then
    insert into public.synthetic_jobs (source, label, config)
    values ('schedule', 'Rodada automática', jsonb_build_object('personas', '[]'::jsonb, 'only', '[]'::jsonb, 'styles', 'rotate', 'reps', 1, 'llm', false,
            'ref', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')));
    update public.synthetic_settings set last_enqueued_at = now() where id = 1;
  end if;
  if not exists (select 1 from public.synthetic_jobs where status in ('queued', 'running')) then return null; end if;
  select decrypted_secret into secret_value from vault.decrypted_secrets
   where name in ('INTERNAL_CRON_SECRET', 'meunino_cron_secret', 'nocontrole_cron_secret')
   order by case name when 'INTERNAL_CRON_SECRET' then 0 when 'meunino_cron_secret' then 1 else 2 end, created_at desc limit 1;
  if nullif(secret_value, '') is null then return null; end if;
  select net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/nino-synthetic',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret_value, 'x-internal-secret', secret_value),
    body := jsonb_build_object('action', 'tick'), timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end $$;
revoke all on function public.synthetic_tick() from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'synthetic-tick-1m') then perform cron.unschedule('synthetic-tick-1m'); end if;
  perform cron.schedule('synthetic-tick-1m', '* * * * *', $cmd$SELECT public.synthetic_tick();$cmd$);
end
$do$;
