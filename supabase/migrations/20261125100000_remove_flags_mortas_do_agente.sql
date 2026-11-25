-- Flags que não são lidas por nenhum código e estavam desligadas (0%):
-- v1 do compilador semântico (substituído pelo v3) e três experimentos "shadow" encerrados.
-- Remover evita que alguém ligue, por engano, um caminho que não existe mais.
DELETE FROM public.agent_runtime_flags
WHERE flag_name IN ('semantic_ir_v1', 'conversation_brain_shadow_v1', 'ai_provider_shadow_v1', 'runtime_v3_shadow')
  AND enabled = false;
