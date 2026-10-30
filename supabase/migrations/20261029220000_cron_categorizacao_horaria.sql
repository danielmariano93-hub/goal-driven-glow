-- Worker de categorização de fundo passa para 1x por hora (decisão do produto: categoria pode demorar até 1 h).
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'nino-category-truth-v2-worker'), schedule := '7 * * * *');
