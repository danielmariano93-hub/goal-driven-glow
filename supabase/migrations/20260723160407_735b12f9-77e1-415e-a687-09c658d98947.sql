
-- 1. agent_turn_events (observabilidade unificada)
CREATE TABLE public.agent_turn_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid,
  user_id uuid NOT NULL,
  conversation_id uuid,
  channel text NOT NULL,
  intent text,
  tools_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  formula_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  stages_ms jsonb NOT NULL DEFAULT '{}'::jsonb,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10,6),
  model text,
  fallback_used boolean NOT NULL DEFAULT false,
  artifact_id uuid,
  artifact_status text NOT NULL DEFAULT 'none',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_turn_events_channel_check CHECK (channel IN ('app','whatsapp','simulator','other')),
  CONSTRAINT agent_turn_events_artifact_status_check CHECK (artifact_status IN ('none','generated','delivered','failed'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_turn_events TO service_role;
GRANT ALL ON public.agent_turn_events TO service_role;
ALTER TABLE public.agent_turn_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "turn_events_admin_read" ON public.agent_turn_events
  FOR SELECT TO authenticated USING (public.is_current_user_admin());
CREATE INDEX idx_turn_events_created ON public.agent_turn_events (created_at DESC);
CREATE INDEX idx_turn_events_channel ON public.agent_turn_events (channel, created_at DESC);
CREATE INDEX idx_turn_events_user ON public.agent_turn_events (user_id, created_at DESC);

-- 2. categorization_metrics_daily
CREATE TABLE public.categorization_metrics_daily (
  date date NOT NULL,
  category_source text NOT NULL DEFAULT 'all',
  total_tx integer NOT NULL DEFAULT 0,
  auto_applied integer NOT NULL DEFAULT 0,
  suggested integer NOT NULL DEFAULT 0,
  uncategorized integer NOT NULL DEFAULT 0,
  user_corrected_within_7d integer NOT NULL DEFAULT 0,
  coverage_pct numeric(5,2),
  precision_proxy_pct numeric(5,2),
  correction_rate_pct numeric(5,2),
  sem_categoria_pct numeric(5,2),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, category_source)
);
GRANT ALL ON public.categorization_metrics_daily TO service_role;
ALTER TABLE public.categorization_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cat_metrics_admin_read" ON public.categorization_metrics_daily
  FOR SELECT TO authenticated USING (public.is_current_user_admin());

-- 3. transactions.previous_category_id (user_edited_at já existe)
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS previous_category_id uuid;

-- 4. reconciliation_issues
CREATE TABLE public.reconciliation_issues (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  entity_id uuid,
  severity text NOT NULL DEFAULT 'medium',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT reconciliation_issues_severity_check CHECK (severity IN ('low','medium','high','critical'))
);
GRANT SELECT ON public.reconciliation_issues TO authenticated;
GRANT ALL ON public.reconciliation_issues TO service_role;
ALTER TABLE public.reconciliation_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reconciliation_issues_own" ON public.reconciliation_issues
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_current_user_admin());
CREATE INDEX idx_recon_issues_user ON public.reconciliation_issues (user_id, detected_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX idx_recon_issues_kind ON public.reconciliation_issues (kind, detected_at DESC);

-- 5. agent_artifacts: campos para mídia e paridade
ALTER TABLE public.agent_artifacts
  ADD COLUMN IF NOT EXISTS summary_text text,
  ADD COLUMN IF NOT EXISTS fallback_text text,
  ADD COLUMN IF NOT EXISTS rendered_at timestamptz,
  ADD COLUMN IF NOT EXISTS media_url text;

-- 6. platform_public_config: seed thresholds
INSERT INTO public.platform_public_config (key, value)
VALUES ('categorization.thresholds', '{"AUTO":0.85,"SUGGEST":0.6,"per_source":{"rule":0.75,"history":0.85,"alias":0.98,"llm":0.75}}')
ON CONFLICT (key) DO NOTHING;

-- 7. trigger: autoconfirmar alias após 3 correções do mesmo padrão
CREATE OR REPLACE FUNCTION public.merchant_alias_autoconfirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pattern text;
  v_count integer;
BEGIN
  IF NEW.category_id IS NULL OR NEW.normalized_description IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.user_edited_at IS NULL THEN
    RETURN NEW;
  END IF;
  v_pattern := lower(regexp_replace(NEW.normalized_description, '\s+', ' ', 'g'));
  SELECT count(*)::int INTO v_count
    FROM public.transactions
    WHERE user_id = NEW.user_id
      AND category_id = NEW.category_id
      AND user_edited_at IS NOT NULL
      AND lower(regexp_replace(coalesce(normalized_description,''), '\s+', ' ', 'g')) = v_pattern;
  IF v_count >= 3 THEN
    INSERT INTO public.merchant_aliases (user_id, alias_key, friendly_name, category_id, learned_from, normalized_pattern, confidence, confirmed_by_user_at)
    VALUES (NEW.user_id, v_pattern, coalesce(NEW.friendly_description, NEW.description, v_pattern), NEW.category_id, 'confirmation', v_pattern, 0.90, now())
    ON CONFLICT (user_id, alias_key) DO UPDATE
      SET category_id = EXCLUDED.category_id,
          confidence = 0.98,
          confirmed_by_user_at = now(),
          hits = merchant_aliases.hits + 1,
          last_used_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_alias_autoconfirm ON public.transactions;
CREATE TRIGGER transactions_alias_autoconfirm
  AFTER INSERT OR UPDATE OF category_id, user_edited_at ON public.transactions
  FOR EACH ROW
  WHEN (NEW.user_edited_at IS NOT NULL)
  EXECUTE FUNCTION public.merchant_alias_autoconfirm();
