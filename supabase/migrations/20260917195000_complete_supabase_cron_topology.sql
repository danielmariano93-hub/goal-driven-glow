-- Mirror the production cron topology in the owned Supabase project.
-- Jobs remain inactive until the coordinated production cutover to avoid
-- duplicate processing while the legacy backend is still receiving traffic.

DO $$
DECLARE j bigint;
BEGIN
  j := cron.schedule('anticipation-dispatch-15m','9,24,39,54 * * * *',$cmd$
    SELECT net.http_post(
      url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/anticipation-tick',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',coalesce((
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
          ORDER BY CASE name WHEN 'INTERNAL_CRON_SECRET' THEN 0 WHEN 'meunino_cron_secret' THEN 1 ELSE 2 END, created_at DESC
          LIMIT 1
        ),'')
      ),
      body := jsonb_build_object('source','cron','only',jsonb_build_array('dispatch'),'dry_run',false,'dispatch_limit',100)
    );
  $cmd$); PERFORM cron.alter_job(j, active => false);

  j := cron.schedule('anticipation-facts-nightly','40 3 * * *',$cmd$
    SELECT net.http_post(
      url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/anticipation-tick',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',coalesce((
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
          ORDER BY CASE name WHEN 'INTERNAL_CRON_SECRET' THEN 0 WHEN 'meunino_cron_secret' THEN 1 ELSE 2 END, created_at DESC
          LIMIT 1
        ),'')
      ),
      body := jsonb_build_object('source','cron','only',jsonb_build_array('run'),'dry_run',false,'limit',200)
    );
  $cmd$); PERFORM cron.alter_job(j, active => false);

  j := cron.schedule('anticipation-hourly','27 * * * *',$cmd$
    SELECT net.http_post(
      url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/anticipation-tick',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',coalesce((
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
          ORDER BY CASE name WHEN 'INTERNAL_CRON_SECRET' THEN 0 WHEN 'meunino_cron_secret' THEN 1 ELSE 2 END, created_at DESC
          LIMIT 1
        ),'')
      ),
      body := jsonb_build_object('source','cron','dry_run',false,'only',jsonb_build_array('run','dispatch','outcomes'))
    );
  $cmd$); PERFORM cron.alter_job(j, active => false);

  j := cron.schedule('financial-reports-monthly','30 10 1 * *',$cmd$SELECT public.financial_reports_monthly_tick();$cmd$);
  PERFORM cron.alter_job(j, active => false);

  j := cron.schedule('financial-reports-weekly','0 10 * * 1',$cmd$SELECT public.financial_reports_weekly_tick();$cmd$);
  PERFORM cron.alter_job(j, active => false);

  j := cron.schedule('nino-cron-history-retention-7d','20 4 * * *',$cmd$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';$cmd$);
  PERFORM cron.alter_job(j, active => false);

  j := cron.schedule('product_aggregates_full','15 3 * * *',$cmd$SELECT public.refresh_product_aggregates_full(3);$cmd$);
  PERFORM cron.alter_job(j, active => false);

  j := cron.schedule('product_aggregates_incremental','*/15 * * * *',$cmd$SELECT public.refresh_product_aggregates_incremental();$cmd$);
  PERFORM cron.alter_job(j, active => false);

  j := cron.schedule('product_events_prune','0 4 * * *',$cmd$SELECT public.prune_product_events(90);$cmd$);
  PERFORM cron.alter_job(j, active => false);

  j := cron.schedule('whatsapp-ack-watchdog-10m','*/10 * * * *',$cmd$SELECT public.whatsapp_ack_watchdog_tick();$cmd$);
  PERFORM cron.alter_job(j, active => false);
END $$;
