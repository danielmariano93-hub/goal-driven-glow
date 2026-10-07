-- A conciliação do mês atual (modo relatório) também fica registrada em bank_sync_runs.
alter table public.bank_sync_runs drop constraint if exists bank_sync_runs_mode_check;
alter table public.bank_sync_runs add constraint bank_sync_runs_mode_check check (mode in ('preview','stage','reconcile'));
