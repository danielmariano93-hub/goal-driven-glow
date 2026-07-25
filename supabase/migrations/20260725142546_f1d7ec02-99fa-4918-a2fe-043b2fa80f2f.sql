ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS artifact_ids uuid[] NULL;

CREATE INDEX IF NOT EXISTS conversation_messages_artifact_ids_gin
  ON public.conversation_messages USING gin (artifact_ids);

COMMENT ON COLUMN public.conversation_messages.artifact_ids IS
  'Onda 2 — FK lógica para public.agent_artifacts; permite reidratar gráficos/relatórios ao reabrir a conversa.';