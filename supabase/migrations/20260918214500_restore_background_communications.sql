-- Restore Nino background communication contracts after the Supabase cutover.
--
-- 1) notification_preferences lost two columns still required by the proactive
--    dispatcher and anticipation user-context loader.
-- 2) insights cron was sending a malformed/empty Authorization header even
--    though the Edge handler already authenticates x-cron-secret.
-- 3) anticipation had a single categorization-coverage requirement applied to
--    detectors that do not use categories at all, muting safe amount/time/cash
--    detectors for otherwise healthy users.

begin;

alter table public.notification_preferences
  add column if not exists max_proactive_per_day smallint not null default 1,
  add column if not exists muted_proactive_kinds text[] not null default '{}'::text[];

-- These detectors do not infer anything from category labels. Their own sample,
-- confidence, materiality and time-window gates remain active; only the
-- irrelevant category-coverage gate is removed.
update public.anticipation_detector_config
set min_coverage = 0,
    notes = case
      when coalesce(notes, '') like '%categorization_independent_v2%' then notes
      when nullif(trim(coalesce(notes, '')), '') is null then 'categorization_independent_v2'
      else notes || ' | categorization_independent_v2'
    end,
    updated_at = now()
where detector in (
  'small_spend_acceleration',
  'card_cycle_acceleration',
  'expected_recurring_payment',
  'upcoming_cash_pressure'
);

-- Internal cron authentication belongs to the handler via x-cron-secret.
-- Do not synthesize a Bearer header from app.settings.anon_key: that setting is
-- not populated in production and produced an invalid Authorization header.
create or replace function public.insights_generate_tick()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  secret_value text;
  request_id bigint;
begin
  select decrypted_secret into secret_value
    from vault.decrypted_secrets
   where name in ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
   order by case name
     when 'INTERNAL_CRON_SECRET' then 0
     when 'meunino_cron_secret' then 1
     else 2
   end, created_at desc
   limit 1;

  if nullif(secret_value,'') is null then
    insert into public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
    values('insights-generate',now(),false,'cron_secret_missing',0,1)
    on conflict (job_key) do update set
      last_run_at=excluded.last_run_at,
      last_ok=false,
      last_error_code=excluded.last_error_code,
      failed=public.job_heartbeats.failed+1,
      updated_at=now();
    return null;
  end if;

  select net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/insights-generate',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',secret_value,
      'x-internal-secret',secret_value
    ),
    body := jsonb_build_object('source','pg_cron')
  ) into request_id;

  insert into public.job_heartbeats(job_key,last_run_at,last_ok,last_error_code,processed,failed)
  values('insights-generate',now(),true,null,0,0)
  on conflict (job_key) do update set
    last_run_at=excluded.last_run_at,
    last_ok=true,
    last_error_code=null,
    updated_at=now();

  return request_id;
end;
$function$;

commit;
