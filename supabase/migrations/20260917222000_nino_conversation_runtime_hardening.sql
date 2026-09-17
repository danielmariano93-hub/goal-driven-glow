-- Nino conversation runtime hardening — 2026-09-17
-- Keeps persisted model metadata aligned with the owned Groq runtime and
-- prevents uninstrumented AI calls from being mislabeled as Lovable AI.

ALTER TABLE public.ai_usage_ledger
  ALTER COLUMN provider SET DEFAULT 'unknown'::text;

UPDATE public.ai_model_routes
SET
  primary_model = CASE task
    WHEN 'fast_operation' THEN 'openai/gpt-oss-20b'
    WHEN 'semantic_classification' THEN 'openai/gpt-oss-20b'
    WHEN 'vision' THEN 'qwen/qwen3.8-27b'
    ELSE 'openai/gpt-oss-120b'
  END,
  fallback_model = CASE task
    WHEN 'fast_operation' THEN 'openai/gpt-oss-120b'
    WHEN 'semantic_classification' THEN 'openai/gpt-oss-120b'
    WHEN 'vision' THEN NULL
    ELSE 'openai/gpt-oss-20b'
  END,
  updated_at = now()
WHERE task IN (
  'fast_operation',
  'semantic_classification',
  'financial_analysis',
  'complex_reasoning',
  'document_text',
  'vision'
);

UPDATE public.agent_settings
SET model = 'openai/gpt-oss-120b',
    max_steps = LEAST(max_steps, 3),
    updated_at = now()
WHERE id = 1;

UPDATE public.agent_prompt_versions
SET model = 'openai/gpt-oss-120b',
    max_steps = LEAST(max_steps, 3),
    updated_at = now()
WHERE status::text = 'active';
