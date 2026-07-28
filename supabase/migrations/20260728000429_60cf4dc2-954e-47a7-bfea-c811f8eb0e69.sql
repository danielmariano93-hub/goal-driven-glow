-- ============ P0: orquestração e telemetria do motor proativo ============
ALTER TABLE public.agent_settings
  ADD COLUMN IF NOT EXISTS proactive_channels text[] NOT NULL DEFAULT ARRAY['app']::text[],
  ADD COLUMN IF NOT EXISTS proactive_rollout_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS last_tick_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_tick_duration_ms integer,
  ADD COLUMN IF NOT EXISTS last_tick_users integer,
  ADD COLUMN IF NOT EXISTS last_tick_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS next_tick_at timestamptz;

-- ============ P0: dicas do Nino (user_insights) ============
ALTER TABLE public.user_insights
  ADD COLUMN IF NOT EXISTS dedup_key text,
  ADD COLUMN IF NOT EXISTS family text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE INDEX IF NOT EXISTS user_insights_user_dedup_idx
  ON public.user_insights (user_id, dedup_key, generated_at DESC);
CREATE INDEX IF NOT EXISTS user_insights_user_family_idx
  ON public.user_insights (user_id, family, generated_at DESC);

-- ============ P0: camada única de feedback ============
CREATE TABLE IF NOT EXISTS public.communication_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_table text NOT NULL CHECK (source_table IN ('user_insights','communication_deliveries','pending_proactive_suggestions')),
  source_id uuid,
  kind text NOT NULL,
  family text,
  dedup_key text,
  feedback text NOT NULL CHECK (feedback IN ('useful','not_useful','dismissed','acted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_feedback_unique_idx
  ON public.communication_feedback (user_id, source_table, coalesce(dedup_key, ''), coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS communication_feedback_user_kind_idx
  ON public.communication_feedback (user_id, kind, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.communication_feedback TO authenticated;
GRANT ALL ON public.communication_feedback TO service_role;

ALTER TABLE public.communication_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own communication feedback"
  ON public.communication_feedback FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER communication_feedback_touch
  BEFORE UPDATE ON public.communication_feedback
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- ============ P0: catálogo administrável de tipos de comunicação ============
CREATE TABLE IF NOT EXISTS public.communication_catalog (
  kind text PRIMARY KEY,
  label text NOT NULL,
  family text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  base_priority integer NOT NULL DEFAULT 100,
  allowed_channels text[] NOT NULL DEFAULT ARRAY['app']::text[],
  cooldown_hours integer NOT NULL DEFAULT 72,
  dismiss_cooldown_days integer NOT NULL DEFAULT 7,
  not_useful_cooldown_days integer NOT NULL DEFAULT 30,
  max_per_day integer NOT NULL DEFAULT 1,
  requires_manual_approval boolean NOT NULL DEFAULT false,
  content_mode text NOT NULL DEFAULT 'deterministic' CHECK (content_mode IN ('deterministic','template','ai_personalized')),
  audience_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.communication_catalog TO authenticated;
GRANT ALL ON public.communication_catalog TO service_role;

ALTER TABLE public.communication_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catalog readable by authenticated"
  ON public.communication_catalog FOR SELECT TO authenticated USING (true);

CREATE POLICY "catalog managed by platform admins"
  ON public.communication_catalog FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid() AND pa.active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = auth.uid() AND pa.active));

CREATE TRIGGER communication_catalog_touch
  BEFORE UPDATE ON public.communication_catalog
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- ============ P0: visão unificada de comunicações ============
CREATE OR REPLACE VIEW public.v_communication_ledger
WITH (security_invoker = true) AS
  SELECT
    ui.user_id,
    'user_insights'::text          AS source_table,
    ui.id                          AS source_id,
    coalesce(ui.type, 'tip')       AS kind,
    coalesce(ui.family, 'geral')   AS family,
    'app'::text                    AS channel,
    ui.status                      AS status,
    ui.dedup_key                   AS dedup_key,
    ui.generated_at                AS created_at,
    ui.feedback                    AS feedback,
    0::numeric                     AS cost_usd
  FROM public.user_insights ui
  UNION ALL
  SELECT
    cd.user_id,
    'communication_deliveries'::text,
    cd.id,
    cd.kind,
    coalesce(cc.family, 'proativo'),
    cd.channel,
    cd.status,
    cd.dedup_key,
    cd.created_at,
    NULL::text,
    coalesce(cd.cost_usd, 0)
  FROM public.communication_deliveries cd
  LEFT JOIN public.communication_catalog cc ON cc.kind = cd.kind;

GRANT SELECT ON public.v_communication_ledger TO authenticated;
GRANT SELECT ON public.v_communication_ledger TO service_role;

-- ============ P1: visibilidade de memórias ============
ALTER TABLE public.agent_memory
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'user'
  CHECK (visibility IN ('user','internal'));

UPDATE public.agent_memory
  SET visibility = 'internal'
  WHERE kind = 'advisor_review' OR key ~ '^(weekly|monthly):';

-- ============ P0.3: cooldown de revisões ============
ALTER TABLE public.advisor_reviews
  ADD COLUMN IF NOT EXISTS last_generated_at timestamptz NOT NULL DEFAULT now();

-- ============ Catálogo inicial ============
INSERT INTO public.communication_catalog (kind, label, family, description, base_priority, allowed_channels, cooldown_hours, content_mode) VALUES
  ('categorize_transaction','Lançamento sem categoria','categorizacao','Pede para categorizar um lançamento específico.',80,ARRAY['app'],72,'deterministic'),
  ('duplicate_expense','Possível gasto duplicado','gastos','Dois lançamentos muito parecidos em pouco tempo.',220,ARRAY['app','whatsapp'],48,'deterministic'),
  ('goal_at_risk','Meta em risco','metas','O ritmo atual não alcança a meta no prazo.',240,ARRAY['app','whatsapp'],168,'deterministic'),
  ('spending_spike','Gasto atípico','gastos','Gasto muito acima do padrão da categoria.',230,ARRAY['app','whatsapp'],72,'deterministic'),
  ('forgotten_bill','Conta próxima ou vencida','recorrencias','Compromisso recorrente perto do vencimento.',260,ARRAY['app','whatsapp'],24,'deterministic'),
  ('engagement_drop','Queda de uso','habitos','O usuário parou de registrar lançamentos.',120,ARRAY['app'],168,'deterministic'),
  ('recurring_pattern','Padrão recorrente','recorrencias','Cobrança repetida que pode virar recorrência.',150,ARRAY['app'],168,'deterministic'),
  ('saving_opportunity','Oportunidade de economia','evolucao','Espaço identificado para economizar.',170,ARRAY['app'],168,'deterministic'),
  ('underused_subscription','Assinatura pouco usada','gastos','Assinatura recorrente com baixo uso aparente.',160,ARRAY['app'],336,'deterministic'),
  ('emotional_spending','Emoção e gastos','emocoes','Relação entre estado emocional e gastos.',140,ARRAY['app'],336,'deterministic'),
  ('impulsive_spending','Gastos concentrados','emocoes','Vários gastos em curto intervalo.',140,ARRAY['app'],336,'deterministic'),
  ('financial_procrastination','Compromissos adiados','habitos','Contas sendo adiadas repetidamente.',150,ARRAY['app'],336,'deterministic'),
  ('financial_discipline','Disciplina financeira','habitos','Reconhecimento de constância positiva.',110,ARRAY['app'],336,'deterministic'),
  ('relapse_risk','Mudança recente de hábito','habitos','Sinal de retorno a um padrão antigo.',150,ARRAY['app'],336,'deterministic'),
  ('advisor_review_weekly','Revisão semanal pronta','evolucao','Aviso de que a revisão semanal foi gerada.',130,ARRAY['app'],144,'deterministic'),
  ('advisor_review_monthly','Fechamento mensal pronto','evolucao','Aviso de que o fechamento mensal foi gerado.',130,ARRAY['app'],600,'deterministic')
ON CONFLICT (kind) DO NOTHING;