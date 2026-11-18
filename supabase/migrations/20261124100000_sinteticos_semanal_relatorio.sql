-- Usuários sintéticos: rodada SEMANAL sorteada (domingo 3h, horário de Brasília), com teto de custo e relatório no WhatsApp.
-- A rodada manual ("Rodar agora") continua igual. Só adiciona colunas e troca funções; nada é apagado.

alter table public.synthetic_settings add column if not exists schedule_kind text not null default 'weekly' check (schedule_kind in ('weekly', 'interval'));
alter table public.synthetic_settings add column if not exists schedule_dow int not null default 0 check (schedule_dow between 0 and 6);   -- 0 = domingo
alter table public.synthetic_settings add column if not exists schedule_hour int not null default 3 check (schedule_hour between 0 and 23);
alter table public.synthetic_settings add column if not exists sample_size int not null default 120 check (sample_size between 20 and 600);
alter table public.synthetic_settings add column if not exists token_cap int not null default 800000 check (token_cap between 100000 and 5000000);
alter table public.synthetic_settings add column if not exists report_whatsapp boolean not null default true;

-- A rodada automática venceu? Semanal: já passou o último "domingo 3h" (em Brasília) e ainda não rodou depois dele.
create or replace function public.synthetic_schedule_due(p_now timestamptz, p_last timestamptz, p_kind text, p_every_hours int, p_dow int, p_hour int)
returns boolean language sql stable set search_path = public as $$
  select case
    when p_kind = 'interval' then p_last is null or p_last <= p_now - make_interval(hours => greatest(1, p_every_hours))
    else (
      select p_last is null or p_last < (s.slot_local at time zone 'America/Sao_Paulo')
      from (
        select case when x.slot_local > x.ln then x.slot_local - interval '7 days' else x.slot_local end as slot_local
        from (
          select (p_now at time zone 'America/Sao_Paulo') as ln,
                 date_trunc('day', p_now at time zone 'America/Sao_Paulo') + p_hour * interval '1 hour'
                   - (((extract(dow from (p_now at time zone 'America/Sao_Paulo'))::int - p_dow + 7) % 7) * interval '1 day') as slot_local
        ) x
      ) s
    )
  end;
$$;
revoke all on function public.synthetic_schedule_due(timestamptz, timestamptz, text, int, int, int) from public, anon, authenticated;

-- Rotina de 1 minuto: enfileira a rodada quando vence (semanal sorteada ou por intervalo) e, havendo rodada ativa, chama o worker.
create or replace function public.synthetic_tick()
returns bigint language plpgsql security definer set search_path to 'public', 'extensions', 'vault' as $$
declare s record; secret_value text; request_id bigint; v_cfg jsonb;
begin
  select * into s from public.synthetic_settings where id = 1;
  if s.enabled and public.synthetic_schedule_due(now(), s.last_enqueued_at, s.schedule_kind, s.every_hours, s.schedule_dow, s.schedule_hour)
     and not exists (select 1 from public.synthetic_jobs where status in ('queued', 'running')) then
    if s.schedule_kind = 'weekly' then
      v_cfg := jsonb_build_object('personas', '[]'::jsonb, 'only', '[]'::jsonb, 'styles', 'all', 'reps', 1, 'llm', false,
        'random', true, 'sample', s.sample_size, 'seed', floor(random() * 2147483647)::int, 'token_cap', s.token_cap, 'report', s.report_whatsapp,
        'ref', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'));
      insert into public.synthetic_jobs (source, label, config) values ('schedule', 'Rodada semanal', v_cfg);
    else
      v_cfg := jsonb_build_object('personas', '[]'::jsonb, 'only', '[]'::jsonb, 'styles', 'rotate', 'reps', 1, 'llm', false, 'report', s.report_whatsapp,
        'ref', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'));
      insert into public.synthetic_jobs (source, label, config) values ('schedule', 'Rodada automática', v_cfg);
    end if;
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

-- Salvar os ajustes (com os novos). Ao LIGAR a rodada automática, a primeira vez é a próxima janela (domingo), não já.
drop function if exists public.admin_synthetic_settings_save(boolean, integer, integer, integer);
create or replace function public.admin_synthetic_settings_save(
  _enabled boolean, _every_hours integer default null, _tpm integer default null, _lanes integer default null,
  _sample_size integer default null, _token_cap integer default null, _report_whatsapp boolean default null,
  _schedule_kind text default null, _schedule_dow integer default null, _schedule_hour integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  if _schedule_kind is not null and _schedule_kind not in ('weekly', 'interval') then raise exception 'invalid schedule kind'; end if;
  update public.synthetic_settings set
    last_enqueued_at = case when coalesce(_enabled, enabled) and not enabled then now() else last_enqueued_at end,
    enabled = coalesce(_enabled, enabled),
    every_hours = greatest(1, least(168, coalesce(_every_hours, every_hours))),
    tpm = greatest(20000, least(400000, coalesce(_tpm, tpm))),
    lanes = greatest(1, least(4, coalesce(_lanes, lanes))),
    sample_size = greatest(20, least(600, coalesce(_sample_size, sample_size))),
    token_cap = greatest(100000, least(5000000, coalesce(_token_cap, token_cap))),
    report_whatsapp = coalesce(_report_whatsapp, report_whatsapp),
    schedule_kind = coalesce(_schedule_kind, schedule_kind),
    schedule_dow = greatest(0, least(6, coalesce(_schedule_dow, schedule_dow))),
    schedule_hour = greatest(0, least(23, coalesce(_schedule_hour, schedule_hour)))
   where id = 1;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_synthetic_settings_save(boolean, integer, integer, integer, integer, integer, boolean, text, integer, integer) from public, anon;
grant execute on function public.admin_synthetic_settings_save(boolean, integer, integer, integer, integer, integer, boolean, text, integer, integer) to authenticated;

-- "Rodar agora" passa a poder pedir o relatório no WhatsApp (e, se quiser, um sorteio). O resto segue como antes.
create or replace function public.admin_synthetic_enqueue(p_config jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb; v_id uuid; v_personas jsonb; v_only jsonb; v_sample int;
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  if exists (select 1 from public.synthetic_jobs where status in ('queued', 'running')) then
    return jsonb_build_object('ok', false, 'reason', 'already_running');
  end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_personas from jsonb_array_elements_text(coalesce(p_config->'personas', '[]'::jsonb)) x where x ~ '^[a-z0-9_]{2,40}$';
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_only from jsonb_array_elements_text(coalesce(p_config->'only', '[]'::jsonb)) x where x ~ '^[A-Z][0-9]{2}$';
  v_sample := case when coalesce(p_config->>'sample', '') ~ '^[0-9]{1,4}$' then greatest(10, least(600, (p_config->>'sample')::int)) else null end;
  v_cfg := jsonb_build_object(
    'personas', v_personas, 'only', v_only,
    'styles', case when p_config->>'styles' in ('rotate', 'all') then p_config->>'styles' else 'rotate' end,
    'reps', greatest(1, least(3, coalesce((p_config->>'reps')::int, 1))),
    'llm', coalesce((p_config->>'llm')::boolean, false),
    'report', coalesce((p_config->>'report')::boolean, false),
    'ref', to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'));
  if v_sample is not null then
    v_cfg := v_cfg || jsonb_build_object('random', true, 'sample', v_sample, 'seed', floor(random() * 2147483647)::int,
      'styles', 'all');
  end if;
  insert into public.synthetic_jobs (source, label, config, requested_by)
  values ('manual', coalesce(nullif(left(p_config->>'label', 80), ''), 'Rodada pelo painel'), v_cfg, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'job_id', v_id);
end $$;
revoke all on function public.admin_synthetic_enqueue(jsonb) from public, anon;
grant execute on function public.admin_synthetic_enqueue(jsonb) to authenticated;
