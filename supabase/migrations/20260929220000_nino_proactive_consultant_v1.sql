-- nino_proactive_consultant_v1
-- 1) Todas as funcionalidades do Nino valem para todos: a única flag que ainda
--    tinha rollout 0% com piloto de um usuário passa a 100% (sem efeito prático
--    hoje, porque runtime_v3_authority_v1 já está em 100%, mas deixa explícito).
update public.agent_runtime_flags
   set rollout_percent = 100, enabled = true, updated_at = now()
 where flag_name = 'conversation_brain_v1';

-- 2) Aviso matinal por dia da semana: pode voltar na semana seguinte (antes o
--    catálogo só permitia um a cada 14 dias).
update public.communication_catalog
   set cooldown_hours = 144, same_pattern_cooldown_days = 6, updated_at = now()
 where kind = 'weekday_spending_risk';
