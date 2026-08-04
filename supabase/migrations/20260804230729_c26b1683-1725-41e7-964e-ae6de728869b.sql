-- =========================================================
-- NINO INTELLIGENCE CORE — uma inteligência, várias superfícies
-- =========================================================

DO $$ BEGIN
  CREATE TYPE public.nino_item_kind AS ENUM (
    'change','risk','opportunity','achievement','data_quality','pattern',
    'commitment','projection','pending_confirmation','recommendation','closed_period_summary'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.nino_temporal_role AS ENUM ('now','historical','future','closed_period');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.nino_item_status AS ENUM ('candidate','active','superseded','expired','acted','dismissed','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------
-- 1) FATOS DERIVADOS CANÔNICOS
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_insight_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  as_of timestamptz NOT NULL DEFAULT now(),
  fact_type text NOT NULL,
  metric_key text NOT NULL,
  current_value numeric,
  comparison_value numeric,
  absolute_delta numeric,
  percentage_delta numeric,
  category_id uuid,
  merchant_normalized text,
  transaction_ids uuid[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  coverage numeric NOT NULL DEFAULT 1,
  confidence numeric NOT NULL DEFAULT 0.5,
  formula_version text NOT NULL DEFAULT 'insight_facts.v1',
  source_snapshot_id text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS financial_insight_facts_identity_idx
  ON public.financial_insight_facts (
    user_id, fact_type, metric_key, period_start, period_end,
    COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(merchant_normalized, '')
  );
CREATE INDEX IF NOT EXISTS financial_insight_facts_user_idx
  ON public.financial_insight_facts (user_id, as_of DESC);

GRANT SELECT ON public.financial_insight_facts TO authenticated;
GRANT ALL ON public.financial_insight_facts TO service_role;
ALTER TABLE public.financial_insight_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "facts_owner_read" ON public.financial_insight_facts;
CREATE POLICY "facts_owner_read" ON public.financial_insight_facts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ---------------------------------------------------------
-- 2) CATÁLOGO DE NARRATIVAS
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nino_narrative_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.nino_item_kind NOT NULL,
  narrative_key text NOT NULL,
  variant text NOT NULL DEFAULT 'medium',
  title_template text NOT NULL,
  body_template text NOT NULL,
  tone text NOT NULL DEFAULT 'neutro',
  caution_level text NOT NULL DEFAULT 'normal',
  default_cta_label text,
  default_cta_route text,
  required_evidence text[] NOT NULL DEFAULT '{}',
  allowed_terms text[] NOT NULL DEFAULT '{}',
  forbidden_terms text[] NOT NULL DEFAULT ARRAY['garantido','certamente','com certeza','sempre','nunca mais','lucro garantido'],
  allowed_channels text[] NOT NULL DEFAULT ARRAY['app','whatsapp'],
  narrative_version text NOT NULL DEFAULT 'nino_narrative.v1',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (narrative_key, variant)
);

GRANT SELECT ON public.nino_narrative_catalog TO authenticated;
GRANT ALL ON public.nino_narrative_catalog TO service_role;
ALTER TABLE public.nino_narrative_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "narrative_read_all" ON public.nino_narrative_catalog;
CREATE POLICY "narrative_read_all" ON public.nino_narrative_catalog
  FOR SELECT TO authenticated USING (active);

-- ---------------------------------------------------------
-- 3) ARTEFATO CANÔNICO DE INTELIGÊNCIA
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nino_intelligence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind public.nino_item_kind NOT NULL,
  temporal_role public.nino_temporal_role NOT NULL DEFAULT 'now',
  status public.nino_item_status NOT NULL DEFAULT 'active',
  priority integer NOT NULL DEFAULT 50,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  explanation text NOT NULL DEFAULT '',
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  primary_action jsonb,
  secondary_action jsonb,
  source text NOT NULL DEFAULT 'engine',
  source_period_start date,
  source_period_end date,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  confidence numeric NOT NULL DEFAULT 0.5,
  data_quality text NOT NULL DEFAULT 'ok',
  pattern_id uuid REFERENCES public.behavioral_patterns(id) ON DELETE SET NULL,
  report_id uuid REFERENCES public.financial_reports(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.anticipation_opportunities(id) ON DELETE SET NULL,
  review_id uuid REFERENCES public.advisor_reviews(id) ON DELETE SET NULL,
  insight_id uuid,
  suggestion_id uuid,
  dedup_key text NOT NULL,
  formula_version text NOT NULL DEFAULT 'nino_items.v1',
  narrative_version text NOT NULL DEFAULT 'nino_narrative.v1',
  created_by text NOT NULL DEFAULT 'engine',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  acted_at timestamptz,
  dismissed_at timestamptz,
  superseded_at timestamptz,
  UNIQUE (user_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS nino_items_user_status_idx
  ON public.nino_intelligence_items (user_id, status, temporal_role, priority DESC);
CREATE INDEX IF NOT EXISTS nino_items_validity_idx
  ON public.nino_intelligence_items (user_id, valid_until);

GRANT SELECT, UPDATE ON public.nino_intelligence_items TO authenticated;
GRANT ALL ON public.nino_intelligence_items TO service_role;
ALTER TABLE public.nino_intelligence_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "items_owner_read" ON public.nino_intelligence_items;
CREATE POLICY "items_owner_read" ON public.nino_intelligence_items
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "items_owner_update" ON public.nino_intelligence_items;
CREATE POLICY "items_owner_update" ON public.nino_intelligence_items
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------
-- 4) EXPOSIÇÕES (observabilidade ponta a ponta)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nino_item_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.nino_intelligence_items(id) ON DELETE CASCADE,
  surface text NOT NULL,
  channel text NOT NULL DEFAULT 'app',
  rank integer,
  selection_reason text,
  blocked_reason text,
  shown_at timestamptz,
  acted_at timestamptz,
  feedback text,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nino_exposures_item_idx ON public.nino_item_exposures (item_id, surface);
CREATE INDEX IF NOT EXISTS nino_exposures_user_idx ON public.nino_item_exposures (user_id, created_at DESC);

GRANT SELECT ON public.nino_item_exposures TO authenticated;
GRANT ALL ON public.nino_item_exposures TO service_role;
ALTER TABLE public.nino_item_exposures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exposures_owner_read" ON public.nino_item_exposures;
CREATE POLICY "exposures_owner_read" ON public.nino_item_exposures
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ---------------------------------------------------------
-- 5) ESTADO POR SUPERFÍCIE (novidade e continuidade)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nino_surface_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  surface text NOT NULL,
  section text NOT NULL DEFAULT 'all',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_item_id uuid,
  continuity_topic text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, surface, section)
);

GRANT SELECT ON public.nino_surface_state TO authenticated;
GRANT ALL ON public.nino_surface_state TO service_role;
ALTER TABLE public.nino_surface_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "surface_state_owner_read" ON public.nino_surface_state;
CREATE POLICY "surface_state_owner_read" ON public.nino_surface_state
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ---------------------------------------------------------
-- 6) TRIGGERS updated_at
-- ---------------------------------------------------------
DROP TRIGGER IF EXISTS touch_financial_insight_facts ON public.financial_insight_facts;
CREATE TRIGGER touch_financial_insight_facts BEFORE UPDATE ON public.financial_insight_facts
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
DROP TRIGGER IF EXISTS touch_nino_items ON public.nino_intelligence_items;
CREATE TRIGGER touch_nino_items BEFORE UPDATE ON public.nino_intelligence_items
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
DROP TRIGGER IF EXISTS touch_nino_narrative ON public.nino_narrative_catalog;
CREATE TRIGGER touch_nino_narrative BEFORE UPDATE ON public.nino_narrative_catalog
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
DROP TRIGGER IF EXISTS touch_nino_exposures ON public.nino_item_exposures;
CREATE TRIGGER touch_nino_exposures BEFORE UPDATE ON public.nino_item_exposures
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
DROP TRIGGER IF EXISTS touch_nino_surface_state ON public.nino_surface_state;
CREATE TRIGGER touch_nino_surface_state BEFORE UPDATE ON public.nino_surface_state
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- ---------------------------------------------------------
-- 7) FEATURE FLAGS (por usuário, ligadas por padrão)
-- ---------------------------------------------------------
ALTER TABLE public.financial_feature_flags
  ADD COLUMN IF NOT EXISTS use_nino_unified_intelligence boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS use_nino_home_orchestrator boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS use_reports_unified boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS use_more_menu_v2 boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------
-- 8) SEED DO CATÁLOGO DE NARRATIVAS
-- ---------------------------------------------------------
INSERT INTO public.nino_narrative_catalog
  (kind, narrative_key, variant, title_template, body_template, tone, caution_level, default_cta_label, default_cta_route, required_evidence)
VALUES
  ('change','spend_change','medium','Seus gastos {direction} {delta_pct}',
   'No período atual você registrou {current} contra {previous} do período anterior. A diferença é de {delta_abs}. {driver_sentence}',
   'direto','normal','Ver relatório','/app/relatorios',ARRAY['current','previous']),
  ('change','category_driver','medium','{category} explicou {share} da diferença',
   '{category} somou {current} no período, contra {previous} antes. Foi a categoria que mais mexeu no resultado.',
   'direto','normal','Ver categorias','/app/relatorios',ARRAY['current']),
  ('data_quality','uncategorized','medium','{count} lançamentos ainda sem categoria',
   'Isso soma {total} e reduz a precisão das leituras. Classificar os maiores primeiro melhora todas as análises seguintes.',
   'convidativo','baixo','Organizar agora','/app/lancamentos',ARRAY['count']),
  ('pattern','behavior_pattern','medium','{label}',
   '{plain_language_reason} {next_validation_condition}',
   'cauteloso','alto','Ver o que o Nino aprendeu','/app/nino',ARRAY['label']),
  ('risk','cash_pressure','medium','{title}','{body}','cauteloso','alto','Ver preparação','/app/nino?section=prepare-se',ARRAY['title']),
  ('opportunity','anticipation','medium','{title}','{body}','direto','normal','Ver preparação','/app/nino?section=prepare-se',ARRAY['title']),
  ('closed_period_summary','report_summary','medium','{title}','{body}','direto','normal','Abrir fechamento','/app/relatorios?tab=fechamentos',ARRAY['title']),
  ('recommendation','advisor_action','medium','{title}','{body}','direto','normal','Ver plano','/app/nino',ARRAY['title']),
  ('pending_confirmation','split_pending','medium','{title}','{body}','direto','normal','Ver divisão','/app/divisao-do-role',ARRAY['title']),
  ('achievement','stability','medium','Nada urgente mudou',
   'Seus dados foram analisados até {as_of}. Seu principal ponto de atenção continua sendo {continuity_topic}.',
   'tranquilo','baixo','Ver detalhes','/app/nino',ARRAY[]::text[])
ON CONFLICT (narrative_key, variant) DO UPDATE
  SET title_template = EXCLUDED.title_template,
      body_template = EXCLUDED.body_template,
      default_cta_label = EXCLUDED.default_cta_label,
      default_cta_route = EXCLUDED.default_cta_route,
      updated_at = now();