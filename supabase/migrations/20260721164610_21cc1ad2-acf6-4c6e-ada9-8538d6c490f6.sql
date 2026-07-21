
-- =========================================================
-- Fase 3 — Agent Core Inteligente: schema unificado
-- =========================================================

-- 1) agent_memory ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.500,
  source TEXT NOT NULL DEFAULT 'inferred',
  use_count INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_memory_source_chk CHECK (source IN ('user','inferred','correction')),
  CONSTRAINT agent_memory_conf_chk CHECK (confidence >= 0 AND confidence <= 1),
  UNIQUE (user_id, kind, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_memory TO authenticated;
GRANT ALL ON public.agent_memory TO service_role;

ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_agent_memory_all" ON public.agent_memory
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS agent_memory_user_kind_idx
  ON public.agent_memory (user_id, kind, last_used_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS agent_memory_expires_idx
  ON public.agent_memory (expires_at) WHERE expires_at IS NOT NULL;

-- 2) user_profiles_snapshot -----------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles_snapshot (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  estimated_income NUMERIC(14,2),
  savings_capacity NUMERIC(14,2),
  net_worth NUMERIC(14,2),
  risk_level TEXT,
  behavior_tags TEXT[] NOT NULL DEFAULT '{}',
  spending_pattern JSONB NOT NULL DEFAULT '{}'::jsonb,
  seasonality JSONB NOT NULL DEFAULT '{}'::jsonb,
  monthly_evolution JSONB NOT NULL DEFAULT '[]'::jsonb,
  top_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  indicators JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles_snapshot TO authenticated;
GRANT ALL ON public.user_profiles_snapshot TO service_role;

ALTER TABLE public.user_profiles_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_profile_snapshot_all" ON public.user_profiles_snapshot
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3) user_ai_preferences --------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_ai_preferences (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tone TEXT NOT NULL DEFAULT 'friendly',
  verbosity TEXT NOT NULL DEFAULT 'balanced',
  explanation_style TEXT NOT NULL DEFAULT 'plain',
  example_style TEXT NOT NULL DEFAULT 'concrete',
  suggestion_frequency TEXT NOT NULL DEFAULT 'medium',
  technical_level TEXT NOT NULL DEFAULT 'basic',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ai_preferences TO authenticated;
GRANT ALL ON public.user_ai_preferences TO service_role;

ALTER TABLE public.user_ai_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_ai_prefs_all" ON public.user_ai_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4) pending_proactive_suggestions ----------------------------------
CREATE TABLE IF NOT EXISTS public.pending_proactive_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action JSONB,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  channel_ready TEXT NOT NULL DEFAULT 'app',
  dedup_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  CONSTRAINT pps_status_chk CHECK (status IN ('pending','dispatched','dismissed','expired')),
  CONSTRAINT pps_channel_chk CHECK (channel_ready IN ('app','whatsapp','both')),
  UNIQUE (user_id, dedup_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_proactive_suggestions TO authenticated;
GRANT ALL ON public.pending_proactive_suggestions TO service_role;

ALTER TABLE public.pending_proactive_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_proactive_all" ON public.pending_proactive_suggestions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS pps_user_status_idx
  ON public.pending_proactive_suggestions (user_id, status, created_at DESC);

-- 5) user_insights — colunas incrementais (idempotente) --------------
DO $$ BEGIN
  ALTER TABLE public.user_insights ADD COLUMN IF NOT EXISTS severity TEXT;
  ALTER TABLE public.user_insights ADD COLUMN IF NOT EXISTS score NUMERIC(6,3);
  ALTER TABLE public.user_insights ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE public.user_insights ADD COLUMN IF NOT EXISTS dedup_key TEXT;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- 6) agent_settings — defaults globais (idempotente) ----------------
DO $$ BEGIN
  ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS default_proactivity TEXT DEFAULT 'medium';
  ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS default_retention_days INT DEFAULT 180;
  ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS default_technical_level TEXT DEFAULT 'basic';
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- 7) trigger de updated_at ------------------------------------------
CREATE OR REPLACE FUNCTION public._touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_touch_agent_memory ON public.agent_memory;
CREATE TRIGGER trg_touch_agent_memory BEFORE UPDATE ON public.agent_memory
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_ai_prefs ON public.user_ai_preferences;
CREATE TRIGGER trg_touch_ai_prefs BEFORE UPDATE ON public.user_ai_preferences
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
