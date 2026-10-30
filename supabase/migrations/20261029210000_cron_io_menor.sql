-- Reduz E/S de disco do cron sem tirar latência de nada que a pessoa percebe:
-- 1) histórico do cron: 372 mil execuções, tabela sem índice e limpeza diária de ~5 s por rodada.
--    Guarda 1 dia (não 7) e limpa de hora em hora, em lotes pequenos.
-- 2) workers de fundo (categorização e fatos financeiros) passam de 1 para 3 minutos.
--    Envio de WhatsApp, pipeline de mensagens e snapshot da Home continuam a cada minuto.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'nino-cron-history-retention-7d'),
  schedule := '20 * * * *',
  command := $$delete from cron.job_run_details where end_time < now() - interval '1 day';$$
);
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'nino-category-truth-v2-worker'), schedule := '*/3 * * * *');
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'finance-facts-worker-1m'), schedule := '*/3 * * * *');
