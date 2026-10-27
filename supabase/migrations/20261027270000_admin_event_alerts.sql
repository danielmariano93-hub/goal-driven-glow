-- Alertas de EVENTOS para o admin (além das falhas do sistema): novos cadastros,
-- pedidos de exclusão de conta, lista de espera, feedback de telas e WhatsApp conectado.
-- O vigia `ops-alerts-tick` (a cada 5 min) junta os eventos novos numa única mensagem de WhatsApp.
-- Usa marca d'água (`events_watermark`): só avança depois que a mensagem foi entregue.

alter table public.ops_alert_settings
  add column if not exists events_enabled boolean not null default true,
  add column if not exists events_watermark timestamptz not null default now();

create or replace function public.ops_events_collect()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  s public.ops_alert_settings;
  u timestamptz := now();
  lines jsonb := '[]'::jsonb;
  r record;
  total int;
begin
  select * into s from public.ops_alert_settings where id = 1;
  if not found or not s.events_enabled then
    return jsonb_build_object('enabled', false, 'lines', '[]'::jsonb, 'until', u, 'admin_phone', s.whatsapp_to);
  end if;

  -- Novos cadastros (e-mail mascarado; contas de teste/sandbox ficam de fora)
  for r in
    select p.display_name, p.created_at, (select au.email from auth.users au where au.id = p.id) as email
      from public.profiles p
     where p.created_at > s.events_watermark and p.created_at <= u
       and not coalesce(p.is_test, false) and not coalesce(p.is_sandbox, false)
     order by p.created_at
  loop
    lines := lines || jsonb_build_object('type', 'signup', 'at', r.created_at,
      'text', '🆕 Novo cadastro: ' || coalesce(nullif(btrim(r.display_name), ''), '(sem nome)')
              || case when r.email is not null then ' · ' || left(r.email, 2) || '***@' || split_part(r.email, '@', 2) else '' end);
  end loop;
  if jsonb_array_length(lines) > 0 then
    select count(*) into total from public.profiles p
     where not coalesce(p.is_test, false) and not coalesce(p.is_sandbox, false);
    lines := lines || jsonb_build_object('type', 'signup_total', 'at', u, 'text', '👥 Total de usuários: ' || total);
  end if;

  -- Pedidos de exclusão de conta
  for r in
    select d.requested_at, p.display_name
      from public.account_deletion_requests d
      left join public.profiles p on p.id = d.user_id
     where d.requested_at > s.events_watermark and d.requested_at <= u
     order by d.requested_at
  loop
    lines := lines || jsonb_build_object('type', 'deletion_request', 'at', r.requested_at,
      'text', '🗑️ Pedido de exclusão de conta: ' || coalesce(nullif(btrim(r.display_name), ''), '(sem nome)'));
  end loop;

  -- Lista de espera de planos
  for r in
    select w.created_at, w.email from public.plan_waitlist w
     where w.created_at > s.events_watermark and w.created_at <= u order by w.created_at
  loop
    lines := lines || jsonb_build_object('type', 'waitlist', 'at', r.created_at,
      'text', '📝 Lista de espera: ' || left(r.email, 2) || '***@' || split_part(r.email, '@', 2));
  end loop;

  -- Feedback de telas
  for r in
    select f.created_at, f.screen, f.rating::text as rating, left(coalesce(f.comment, ''), 100) as comment
      from public.screen_feedback f
     where f.created_at > s.events_watermark and f.created_at <= u order by f.created_at
  loop
    lines := lines || jsonb_build_object('type', 'feedback', 'at', r.created_at,
      'text', '💬 Feedback em ' || coalesce(r.screen, 'tela') || ' (' || coalesce(r.rating, '?') || ')'
              || case when r.comment <> '' then ': “' || r.comment || '”' else '' end);
  end loop;

  -- WhatsApp conectado por um usuário
  for r in
    select l.created_at, p.display_name
      from public.whatsapp_links l
      left join public.profiles p on p.id = l.user_id
     where l.status::text = 'active' and l.created_at > s.events_watermark and l.created_at <= u
       and not coalesce(p.is_test, false)
     order by l.created_at
  loop
    lines := lines || jsonb_build_object('type', 'whatsapp_linked', 'at', r.created_at,
      'text', '📱 WhatsApp conectado: ' || coalesce(nullif(btrim(r.display_name), ''), '(sem nome)'));
  end loop;

  return jsonb_build_object('enabled', true, 'lines', lines, 'until', u, 'admin_phone', s.whatsapp_to,
    'notify_whatsapp', s.notify_whatsapp, 'ntfy_topic', s.ntfy_topic);
end $$;
revoke all on function public.ops_events_collect() from public, anon, authenticated;
grant execute on function public.ops_events_collect() to service_role;

create or replace function public.ops_events_ack(_until timestamptz)
returns void
language sql
security definer
set search_path = 'public'
as $$
  update public.ops_alert_settings
     set events_watermark = greatest(events_watermark, _until), updated_at = now()
   where id = 1
$$;
revoke all on function public.ops_events_ack(timestamptz) from public, anon, authenticated;
grant execute on function public.ops_events_ack(timestamptz) to service_role;

-- A rotina de 5 minutos nunca chegou a ser criada em produção: cria a função e agenda o cron.
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
grant execute on function public.ops_alerts_tick() to service_role;

select cron.schedule('ops-alerts-5m', '*/5 * * * *', $cmd$SELECT public.ops_alerts_tick();$cmd$);
