
-- Adiciona telemetria de entrega em agent_artifacts
ALTER TABLE public.agent_artifacts
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT;

-- Seed inicial dos thresholds de categorização (idempotente)
INSERT INTO public.platform_public_config (key, value)
VALUES ('categorization.thresholds',
        '{"AUTO":0.85,"SUGGEST":0.6,"per_source":{"rule":0.75,"history":0.85,"alias":0.98,"llm":0.75}}'::jsonb)
ON CONFLICT (key) DO NOTHING;
