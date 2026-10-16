-- Avaliação da IA do Mapa com o modelo real: dispara a função `mapa-eval` com o segredo do vault (nunca sai do banco).
-- Só service_role executa. O retorno fica em net._http_response (o id volta). Use `offset`/`limit` para lotes.
create or replace function public.mapa_eval_tick(p_offset int default 0, p_limit int default 100, p_judge boolean default true)
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
   order by case name when 'INTERNAL_CRON_SECRET' then 0 when 'meunino_cron_secret' then 1 else 2 end, created_at desc
   limit 1;
  if nullif(secret_value, '') is null then raise exception 'cron_secret_missing'; end if;
  select net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/mapa-eval',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', secret_value),
    body := jsonb_build_object('offset', p_offset, 'limit', p_limit, 'judge', p_judge),
    timeout_milliseconds := 150000
  ) into request_id;
  return request_id;
end;
$function$;
revoke all on function public.mapa_eval_tick(int, int, boolean) from public, anon, authenticated;
grant execute on function public.mapa_eval_tick(int, int, boolean) to service_role;
