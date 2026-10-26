-- Alertas operacionais para o admin: o Nino avisa quando algo cai (WhatsApp sem enviar, rotina parada, IA falhando…).
-- Motivo: em 20/10 o servidor do WhatsApp ficou inalcançável (domínio expirado) e ninguém foi avisado por dias.
-- Canais: painel (sempre), push ntfy (independente do WhatsApp) e WhatsApp (só para falhas que não são do próprio WhatsApp).

create table if not exists public.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null,
  severity text not null check (severity in ('critical', 'warning')),
  title text not null,
  detail text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  notified_at timestamptz,
  notify_count int not null default 0,
  recovery_notified_at timestamptz
);
create unique index if not exists uq_ops_alerts_open on public.ops_alerts (alert_key) where status = 'open';
create index if not exists idx_ops_alerts_recent on public.ops_alerts (first_seen_at desc);

create table if not exists public.ops_alert_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  ntfy_topic text check (ntfy_topic is null or ntfy_topic ~ '^[A-Za-z0-9_-]{8,64}$'),
  notify_whatsapp boolean not null default true,
  renotify_minutes int not null default 120 check (renotify_minutes between 0 and 1440),
  whatsapp_to text check (whatsapp_to is null or whatsapp_to ~ '^\+?[0-9]{10,15}$'),
  updated_at timestamptz not null default now()
);
insert into public.ops_alert_settings(id) values (1) on conflict do nothing;

alter table public.ops_alerts enable row level security;
alter table public.ops_alert_settings enable row level security;
revoke all on public.ops_alerts, public.ops_alert_settings from anon, authenticated;
grant all on public.ops_alerts, public.ops_alert_settings to service_role;

-- Condições de queda detectadas no banco. A checagem do servidor do WAHA (rede) é feita na Edge Function.
create or replace function public.ops_alerts_evaluate()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  r jsonb := '[]'::jsonb;
  n int; e text; j record;
begin
  -- 1) WhatsApp sem conseguir enviar (falha/morta nos últimos 30 min, ou fila presa com várias tentativas)
  select count(*), (array_agg(left(coalesce(o.last_error, ''), 90) order by o.updated_at desc))[1] into n, e
    from public.outbound_messages o
   where o.kind <> 'notification'
     and ((o.status::text in ('failed', 'dead') and coalesce(o.dead_letter_at, o.updated_at) > now() - interval '30 minutes')
          or (o.status::text in ('queued', 'processing') and o.attempts >= 3 and o.created_at < now() - interval '10 minutes'))
     and not exists (select 1 from public.profiles p where p.id = o.user_id and p.is_test);
  if n > 0 then
    r := r || jsonb_build_object('key', 'whatsapp_send_failing', 'severity', 'critical',
      'title', 'O Nino não está conseguindo enviar mensagens no WhatsApp',
      'detail', n || ' mensagem(ns) falharam ou estão presas.' || case when e <> '' then ' Último erro: ' || e else '' end);
  end if;

  -- 2) Mensagens recebidas que não foram processadas
  select count(*) into n from public.inbound_messages
   where from_phone is not null and processed_at is null and ignored_reason is null
     and received_at < now() - interval '10 minutes' and received_at > now() - interval '2 days';
  if n > 0 then
    r := r || jsonb_build_object('key', 'inbound_unprocessed', 'severity', 'critical',
      'title', 'Mensagens recebidas não estão sendo processadas',
      'detail', n || ' mensagem(ns) do WhatsApp esperam processamento há mais de 10 minutos.');
  end if;

  -- 3) Rotinas agendadas paradas ou falhando
  for j in
    select x.jobname, x.max_min, d.status, d.start_time
      from (values ('whatsapp-send-dispatch-1m', 10), ('whatsapp-ack-watchdog-10m', 30), ('agent-runs-orphan-sweep-5m', 20), ('agent-proactive-hourly', 130)) as x(jobname, max_min)
      join cron.job cj on cj.jobname = x.jobname and cj.active
      left join lateral (select status, start_time from cron.job_run_details where jobid = cj.jobid order by start_time desc limit 1) d on true
     where d.start_time is null or d.status <> 'succeeded' or d.start_time < now() - make_interval(mins => x.max_min)
  loop
    r := r || jsonb_build_object('key', 'cron_' || j.jobname, 'severity', 'critical',
      'title', 'Rotina automática parada: ' || j.jobname,
      'detail', case when j.start_time is null then 'Nunca executou.' else 'Última execução em ' || to_char(j.start_time at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ' (' || j.status || ').' end);
  end loop;

  -- 4) IA falhando
  select count(*) filter (where not success) into n from public.ai_usage_ledger
   where occurred_at > now() - interval '30 minutes';
  if n >= 3 then
    r := r || jsonb_build_object('key', 'ai_failing', 'severity', 'warning',
      'title', 'Chamadas de IA estão falhando',
      'detail', n || ' falhas nos últimos 30 minutos.');
  end if;

  -- 5) Conversas com erro
  select count(*) into n from public.agent_runs
   where started_at > now() - interval '30 minutes' and status::text = 'error'
     and coalesce(channel, '') <> 'simulator';
  if n >= 3 then
    r := r || jsonb_build_object('key', 'agent_errors', 'severity', 'warning',
      'title', 'Conversas do Nino terminando em erro',
      'detail', n || ' conversas com erro nos últimos 30 minutos.');
  end if;

  return r;
end $$;
revoke all on function public.ops_alerts_evaluate() from public, anon, authenticated;
grant execute on function public.ops_alerts_evaluate() to service_role;

-- Sincroniza as condições ativas com os alertas abertos e devolve o que precisa ser avisado (novo, lembrete, recuperado).
create or replace function public.ops_alerts_sync(_active jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  s public.ops_alert_settings;
  a jsonb; o public.ops_alerts; out jsonb := '[]'::jsonb; keys text[] := '{}';
begin
  select * into s from public.ops_alert_settings where id = 1;
  for a in select * from jsonb_array_elements(coalesce(_active, '[]'::jsonb)) loop
    keys := keys || (a->>'key');
    select * into o from public.ops_alerts where alert_key = a->>'key' and status = 'open';
    if not found then
      insert into public.ops_alerts(alert_key, severity, title, detail)
      values (a->>'key', coalesce(a->>'severity', 'warning'), a->>'title', a->>'detail') returning * into o;
      out := out || jsonb_build_object('id', o.id, 'kind', 'new', 'key', o.alert_key, 'severity', o.severity, 'title', o.title, 'detail', o.detail);
    else
      update public.ops_alerts set last_seen_at = now(), severity = coalesce(a->>'severity', severity), title = a->>'title', detail = a->>'detail' where id = o.id returning * into o;
      if o.notified_at is null then
        out := out || jsonb_build_object('id', o.id, 'kind', 'new', 'key', o.alert_key, 'severity', o.severity, 'title', o.title, 'detail', o.detail);
      elsif s.renotify_minutes > 0 and o.notified_at < now() - make_interval(mins => s.renotify_minutes) then
        out := out || jsonb_build_object('id', o.id, 'kind', 'reminder', 'key', o.alert_key, 'severity', o.severity, 'title', o.title, 'detail', o.detail, 'since', o.first_seen_at);
      end if;
    end if;
  end loop;
  for o in select * from public.ops_alerts where status = 'open' and not (alert_key = any(keys)) loop
    update public.ops_alerts set status = 'resolved', resolved_at = now() where id = o.id;
    if o.notified_at is not null then
      out := out || jsonb_build_object('id', o.id, 'kind', 'recovered', 'key', o.alert_key, 'severity', o.severity, 'title', o.title, 'detail', o.detail, 'since', o.first_seen_at);
    end if;
  end loop;
  return jsonb_build_object('notify', out,
    'settings', jsonb_build_object('enabled', s.enabled, 'ntfy_topic', s.ntfy_topic, 'notify_whatsapp', s.notify_whatsapp),
    'admin_phone', s.whatsapp_to);
end $$;
revoke all on function public.ops_alerts_sync(jsonb) from public, anon, authenticated;
grant execute on function public.ops_alerts_sync(jsonb) to service_role;

create or replace function public.ops_alerts_ack(_id uuid, _kind text)
returns void
language sql
security definer
set search_path = 'public'
as $$
  update public.ops_alerts
     set notified_at = case when _kind in ('new', 'reminder') then now() else notified_at end,
         notify_count = notify_count + case when _kind in ('new', 'reminder') then 1 else 0 end,
         recovery_notified_at = case when _kind = 'recovered' then now() else recovery_notified_at end
   where id = _id
$$;
revoke all on function public.ops_alerts_ack(uuid, text) from public, anon, authenticated;
grant execute on function public.ops_alerts_ack(uuid, text) to service_role;

create or replace function public.admin_ops_alerts_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.is_current_user_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'open', coalesce((select jsonb_agg(jsonb_build_object('key', alert_key, 'severity', severity, 'title', title, 'detail', detail, 'since', first_seen_at, 'last_seen', last_seen_at) order by (severity = 'critical') desc, first_seen_at) from public.ops_alerts where status = 'open'), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x.since desc) from (select alert_key as key, severity, title, first_seen_at as since, resolved_at, status from public.ops_alerts order by first_seen_at desc limit 15) x), '[]'::jsonb),
    'settings', (select jsonb_build_object('enabled', enabled, 'ntfy_topic', ntfy_topic, 'notify_whatsapp', notify_whatsapp, 'renotify_minutes', renotify_minutes, 'whatsapp_to', whatsapp_to) from public.ops_alert_settings where id = 1)
  );
end $$;
revoke all on function public.admin_ops_alerts_get() from public, anon;
grant execute on function public.admin_ops_alerts_get() to authenticated;

drop function if exists public.admin_ops_alert_settings_save(boolean, text, boolean, integer);
create or replace function public.admin_ops_alert_settings_save(_enabled boolean, _ntfy_topic text, _notify_whatsapp boolean, _renotify_minutes integer, _whatsapp_to text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_current_user_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.ops_alert_settings
     set enabled = coalesce(_enabled, enabled),
         ntfy_topic = nullif(btrim(coalesce(_ntfy_topic, '')), ''),
         notify_whatsapp = coalesce(_notify_whatsapp, notify_whatsapp),
         renotify_minutes = greatest(0, least(1440, coalesce(_renotify_minutes, renotify_minutes))),
         whatsapp_to = nullif(regexp_replace(coalesce(_whatsapp_to, ''), '[^0-9+]', '', 'g'), ''),
         updated_at = now()
   where id = 1;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_ops_alert_settings_save(boolean, text, boolean, integer, text) from public, anon;
grant execute on function public.admin_ops_alert_settings_save(boolean, text, boolean, integer, text) to authenticated;

-- Rotina a cada 5 minutos (mesmo padrão das demais: segredo no cofre, chamada pela Edge Function).
create or replace function public.ops_alerts_tick()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare secret_value text; request_id bigint;
begin
  select decrypted_secret into secret_value from vault.decrypted_secrets
   where name in ('INTERNAL_CRON_SECRET', 'meunino_cron_secret', 'nocontrole_cron_secret')
   order by case name when 'INTERNAL_CRON_SECRET' then 0 when 'meunino_cron_secret' then 1 else 2 end, created_at desc limit 1;
  if nullif(secret_value, '') is null then return null; end if;
  select net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/ops-alerts-tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret_value, 'x-internal-secret', secret_value),
    body := jsonb_build_object('source', 'pg_cron')
  ) into request_id;
  return request_id;
end $$;
revoke all on function public.ops_alerts_tick() from public, anon, authenticated;
