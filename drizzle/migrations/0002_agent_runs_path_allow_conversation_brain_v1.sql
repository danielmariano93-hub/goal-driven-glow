-- Observabilidade da Conversation Architecture V2.
-- O código da main grava agent_runs.path = 'conversation_brain_v1'; o CHECK
-- atual rejeita esse valor e as runs V2 ficam invisíveis (insert falha em
-- silêncio). Mudança aditiva: mantém todos os valores legados aceitos.
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_path_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_path_check
  CHECK (
    path IS NULL OR path IN (
      'llm',
      'deterministic_tool',
      'deterministic_fallback',
      'fast_log',
      'conversation_brain_v1'
    )
  );