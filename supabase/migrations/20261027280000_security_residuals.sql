-- Resíduos da auditoria de segurança: tabela de diagnóstico esquecida (só contadores agregados, sem dados de usuário).
drop table if exists public.wave1_pre_snapshot;
