-- Analytics + categorization inteligente (aditivo, seguro)

-- 1. transactions: metadados de categorização
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS category_confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS category_source text CHECK (category_source IN ('user','alias','history','rule','llm','none')),
  ADD COLUMN IF NOT EXISTS category_reason text,
  ADD COLUMN IF NOT EXISTS user_edited_at timestamptz;

-- 2. merchant_aliases: reforçar contrato para pipeline híbrido
ALTER TABLE public.merchant_aliases
  ADD COLUMN IF NOT EXISTS canonical_name text,
  ADD COLUMN IF NOT EXISTS normalized_pattern text,
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2) DEFAULT 0.9,
  ADD COLUMN IF NOT EXISTS confirmed_by_user_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_merchant_aliases_user_pattern
  ON public.merchant_aliases(user_id, normalized_pattern)
  WHERE normalized_pattern IS NOT NULL;

-- 3. agent_artifacts: gráficos/relatórios gerados pelo assessor
CREATE TABLE IF NOT EXISTS public.agent_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  media_path text,
  media_mime text,
  media_expires_at timestamptz,
  formula_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_artifacts TO authenticated;
GRANT ALL ON public.agent_artifacts TO service_role;

ALTER TABLE public.agent_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_artifacts" ON public.agent_artifacts;
CREATE POLICY "own_artifacts" ON public.agent_artifacts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_user_created
  ON public.agent_artifacts(user_id, created_at DESC);

-- 4. outbound_messages: campos de mídia para envio de gráficos
ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS artifact_id uuid REFERENCES public.agent_artifacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS media_url text,
  ADD COLUMN IF NOT EXISTS media_mime text,
  ADD COLUMN IF NOT EXISTS media_status text CHECK (media_status IN ('pending','sent','failed','fallback_text'));

-- 5. agent_runs: rastreio para observabilidade e paridade
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS intent_requested text,
  ADD COLUMN IF NOT EXISTS intent_served text,
  ADD COLUMN IF NOT EXISTS tools_used text[],
  ADD COLUMN IF NOT EXISTS formula_versions jsonb;
