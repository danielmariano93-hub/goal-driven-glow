-- Alertas claros e com frequência ajustável.
-- 1) A limpeza diária de product_events rodava (cron ok), mas a função em produção não gravava o heartbeat
--    (a migração 20261004130000 nunca foi aplicada lá): o painel mostrava "Urgente: sem execução comprovada" sem a rotina estar parada.
-- 2) A checagem de rede do WhatsApp (WAHA) deixa de ser a cada 5 min: o intervalo passa a ser configurável (padrão 12 h).
--    Enquanto um aviso do WhatsApp estiver aberto, a checagem continua a cada ciclo para detectar a volta rápido.
--    As checagens baratas de banco (mensagem presa, mensagem recebida sem processar) seguem a cada ciclo.

create or replace function public.prune_product_events(_days integer default 90)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_deleted int;
begin
  set local session_replication_role = replica;
  delete from public.product_events where occurred_at < now() - make_interval(days => _days);
  get diagnostics v_deleted = row_count;
  set local session_replication_role = origin;

  insert into public.job_heartbeats(job_key, last_run_at, last_ok, last_error_code, processed, failed)
  values ('product_events_prune', now(), true, null, v_deleted, 0)
  on conflict (job_key) do update
    set last_run_at = excluded.last_run_at, last_ok = true, last_error_code = null,
        processed = excluded.processed, failed = 0, updated_at = now();
  return v_deleted;
end;
$function$;

alter table public.ops_alert_settings
  add column if not exists waha_check_hours integer not null default 12 check (waha_check_hours between 1 and 168),
  add column if not exists waha_last_check_at timestamptz;

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
    'settings', (select jsonb_build_object('enabled', enabled, 'ntfy_topic', ntfy_topic, 'notify_whatsapp', notify_whatsapp, 'renotify_minutes', renotify_minutes, 'whatsapp_to', whatsapp_to, 'waha_check_hours', waha_check_hours) from public.ops_alert_settings where id = 1)
  );
end $$;
revoke all on function public.admin_ops_alerts_get() from public, anon;
grant execute on function public.admin_ops_alerts_get() to authenticated;

drop function if exists public.admin_ops_alert_settings_save(boolean, text, boolean, integer, text);
create or replace function public.admin_ops_alert_settings_save(_enabled boolean, _ntfy_topic text, _notify_whatsapp boolean, _renotify_minutes integer, _whatsapp_to text, _waha_check_hours integer default null)
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
         waha_check_hours = greatest(1, least(168, coalesce(_waha_check_hours, waha_check_hours))),
         updated_at = now()
   where id = 1;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_ops_alert_settings_save(boolean, text, boolean, integer, text, integer) from public, anon;
grant execute on function public.admin_ops_alert_settings_save(boolean, text, boolean, integer, text, integer) to authenticated;

-- Estado da checagem de rede: a Edge Function decide se já está na hora.
create or replace function public.ops_waha_check_state()
returns jsonb
language sql
security definer
set search_path = 'public'
as $$
  select jsonb_build_object(
    'hours', s.waha_check_hours,
    'last_check_at', s.waha_last_check_at,
    'open', exists (select 1 from public.ops_alerts a where a.status = 'open' and a.alert_key like 'waha%')
  ) from public.ops_alert_settings s where s.id = 1
$$;
revoke all on function public.ops_waha_check_state() from public, anon, authenticated;
grant execute on function public.ops_waha_check_state() to service_role;

create or replace function public.ops_waha_check_mark()
returns void
language sql
security definer
set search_path = 'public'
as $$ update public.ops_alert_settings set waha_last_check_at = now() where id = 1 $$;
revoke all on function public.ops_waha_check_mark() from public, anon, authenticated;
grant execute on function public.ops_waha_check_mark() to service_role;
