SELECT cron.schedule(
  'finance-facts-worker-1m',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/finance-facts-worker',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',coalesce((
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
          ORDER BY CASE name WHEN 'INTERNAL_CRON_SECRET' THEN 0 WHEN 'meunino_cron_secret' THEN 1 ELSE 2 END,
                   created_at DESC
          LIMIT 1
        ),'')
      ),
      body := jsonb_build_object('limit',60)
    );
  $$
);