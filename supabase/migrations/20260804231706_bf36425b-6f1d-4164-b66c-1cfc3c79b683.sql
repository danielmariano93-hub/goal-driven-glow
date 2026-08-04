SELECT cron.unschedule('nino-intelligence-30m')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nino-intelligence-30m');

SELECT cron.schedule(
  'nino-intelligence-30m',
  '*/30 * * * *',
  $$ SELECT public.nino_intelligence_tick(); $$
);