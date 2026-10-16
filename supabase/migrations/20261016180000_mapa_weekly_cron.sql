-- Mapa Financeiro: leitura semanal das contas liberadas (segunda 06:45 em São Paulo = 09:45 UTC).
-- Segredo lido do vault no momento do disparo, no mesmo padrão de behavior_observed_weekly_tick.
create or replace function public.mapa_weekly_tick()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  secret_value text;
  request_id bigint;
begin
  select decrypted_secret into secret_value
    from vault.decrypted_secrets
   where name in ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
   order by case name when 'INTERNAL_CRON_SECRET' then 0 when 'meunino_cron_secret' then 1 else 2 end,
            created_at desc
   limit 1;
  if nullif(secret_value, '') is null then
    raise exception 'cron_secret_missing';
  end if;
  select net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/mapa-weekly',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', secret_value),
    body := jsonb_build_object('source','weekly_cron')
  ) into request_id;
  return request_id;
end;
$function$;
revoke all on function public.mapa_weekly_tick() from public, anon, authenticated;
grant execute on function public.mapa_weekly_tick() to service_role;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'mapa-weekly') then
    perform cron.unschedule('mapa-weekly');
  end if;
  perform cron.schedule('mapa-weekly', '45 9 * * 1', 'select public.mapa_weekly_tick();');
end;
$do$;
