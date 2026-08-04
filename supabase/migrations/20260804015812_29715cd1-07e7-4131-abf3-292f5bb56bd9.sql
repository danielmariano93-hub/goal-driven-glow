-- anticipation_contract.v1 — Motor de Antecipação Comportamental Financeira

-- 1. FATOS COMPORTAMENTAIS -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.behavioral_transaction_facts (
  user_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  formula_version text NOT NULL DEFAULT 'anticipation_contract.v1',
  local_date date NOT NULL,
  local_time time,
  occurred_at_precision text NOT NULL DEFAULT 'day' CHECK (occurred_at_precision IN ('day','hour','minute')),
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  week_start date NOT NULL,
  month_phase text NOT NULL CHECK (month_phase IN ('inicio','meio','fim')),
  card_cycle_id uuid,
  card_cycle_day smallint,
  category_id uuid,
  category_name text,
  category_confidence numeric NOT NULL DEFAULT 0,
  merchant_normalized text,
  merchant_canonical text,
  movement_kind text NOT NULL DEFAULT 'transaction',
  behavioral_class text NOT NULL DEFAULT 'consumption',
  amount_gross numeric NOT NULL DEFAULT 0,
  amount_net numeric NOT NULL DEFAULT 0,
  is_consumption boolean NOT NULL DEFAULT false,
  is_adjustable boolean NOT NULL DEFAULT false,
  is_fixed boolean NOT NULL DEFAULT false,
  is_exceptional boolean NOT NULL DEFAULT false,
  is_planned boolean NOT NULL DEFAULT false,
  is_refund boolean NOT NULL DEFAULT false,
  is_transfer boolean NOT NULL DEFAULT false,
  is_card_payment boolean NOT NULL DEFAULT false,
  is_debt_principal boolean NOT NULL DEFAULT false,
  data_confidence numeric NOT NULL DEFAULT 1,
  source_snapshot_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, transaction_id, formula_version)
);
GRANT SELECT ON public.behavioral_transaction_facts TO authenticated;
GRANT ALL ON public.behavioral_transaction_facts TO service_role;
ALTER TABLE public.behavioral_transaction_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY btf_owner_select ON public.behavioral_transaction_facts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS btf_user_date_idx ON public.behavioral_transaction_facts (user_id, local_date DESC);
CREATE INDEX IF NOT EXISTS btf_user_weekday_idx ON public.behavioral_transaction_facts (user_id, weekday, local_date DESC);

CREATE TABLE IF NOT EXISTS public.behavioral_daily_facts (
  user_id uuid NOT NULL,
  local_date date NOT NULL,
  formula_version text NOT NULL DEFAULT 'anticipation_contract.v1',
  weekday smallint NOT NULL,
  week_start date NOT NULL,
  month_phase text NOT NULL,
  total_consumption numeric NOT NULL DEFAULT 0,
  total_adjustable numeric NOT NULL DEFAULT 0,
  total_fixed numeric NOT NULL DEFAULT 0,
  total_card numeric NOT NULL DEFAULT 0,
  total_food numeric NOT NULL DEFAULT 0,
  total_leisure numeric NOT NULL DEFAULT 0,
  total_small_spend numeric NOT NULL DEFAULT 0,
  small_spend_count integer NOT NULL DEFAULT 0,
  entries_count integer NOT NULL DEFAULT 0,
  categorization_coverage numeric NOT NULL DEFAULT 0,
  amount_uncategorized numeric NOT NULL DEFAULT 0,
  is_payday_window boolean NOT NULL DEFAULT false,
  is_holiday boolean NOT NULL DEFAULT false,
  is_exceptional_day boolean NOT NULL DEFAULT false,
  data_confidence numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date, formula_version)
);
GRANT SELECT ON public.behavioral_daily_facts TO authenticated;
GRANT ALL ON public.behavioral_daily_facts TO service_role;
ALTER TABLE public.behavioral_daily_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY bdf_owner_select ON public.behavioral_daily_facts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.behavioral_cycle_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  cycle_kind text NOT NULL CHECK (cycle_kind IN ('week','month','card_cycle','payday_window')),
  cycle_key text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  formula_version text NOT NULL DEFAULT 'anticipation_contract.v1',
  total_consumption numeric NOT NULL DEFAULT 0,
  total_adjustable numeric NOT NULL DEFAULT 0,
  total_fixed numeric NOT NULL DEFAULT 0,
  total_card numeric NOT NULL DEFAULT 0,
  entries_count integer NOT NULL DEFAULT 0,
  days_covered integer NOT NULL DEFAULT 0,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_confidence numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, cycle_kind, cycle_key, formula_version)
);
GRANT SELECT ON public.behavioral_cycle_facts TO authenticated;
GRANT ALL ON public.behavioral_cycle_facts TO service_role;
ALTER TABLE public.behavioral_cycle_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY bcf_owner_select ON public.behavioral_cycle_facts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 2. PADRÕES, OPORTUNIDADES E RESULTADOS ---------------------------------
CREATE TABLE IF NOT EXISTS public.behavioral_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  detector text NOT NULL,
  pattern_key text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','validated','active','weakened','expired','muted')),
  sample_size integer NOT NULL DEFAULT 0,
  window_start date,
  window_end date,
  baseline_value numeric NOT NULL DEFAULT 0,
  pattern_value numeric NOT NULL DEFAULT 0,
  uplift_pct numeric NOT NULL DEFAULT 0,
  absolute_delta numeric NOT NULL DEFAULT 0,
  hit_rate numeric NOT NULL DEFAULT 0,
  consistency numeric NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  data_coverage numeric NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  exclusions jsonb NOT NULL DEFAULT '[]'::jsonb,
  formula_version text NOT NULL DEFAULT 'anticipation_contract.v1',
  detector_version text NOT NULL DEFAULT 'v1',
  last_seen_at timestamptz,
  validated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, detector, pattern_key, formula_version)
);
GRANT SELECT ON public.behavioral_patterns TO authenticated;
GRANT ALL ON public.behavioral_patterns TO service_role;
ALTER TABLE public.behavioral_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY bp_owner_select ON public.behavioral_patterns
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS bp_user_status_idx ON public.behavioral_patterns (user_id, status, detector);

CREATE TABLE IF NOT EXISTS public.anticipation_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pattern_id uuid REFERENCES public.behavioral_patterns(id) ON DELETE SET NULL,
  detector text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','attention','critical')),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','revalidating','ready','suppressed','dispatched','expired','missed','cancelled')),
  opportunity_date date NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  eligible_from timestamptz NOT NULL,
  optimal_send_at timestamptz,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  stale_policy text NOT NULL DEFAULT 'drop_after_window'
    CHECK (stale_policy IN ('drop_after_window','convert_to_in_app','send_summary_later','recompute_before_send')),
  expected_value numeric NOT NULL DEFAULT 0,
  baseline_value numeric NOT NULL DEFAULT 0,
  utility_score numeric NOT NULL DEFAULT 0,
  utility_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  title text NOT NULL,
  body text NOT NULL,
  action jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel_target text NOT NULL DEFAULT 'app' CHECK (channel_target IN ('app','whatsapp','both')),
  dry_run boolean NOT NULL DEFAULT true,
  dedup_key text NOT NULL,
  logical_dedup_key text NOT NULL,
  suppress_reason text,
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.anticipation_opportunities TO authenticated;
GRANT ALL ON public.anticipation_opportunities TO service_role;
ALTER TABLE public.anticipation_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY ao_owner_select ON public.anticipation_opportunities
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ao_live_logical_dedup_idx
  ON public.anticipation_opportunities (user_id, logical_dedup_key)
  WHERE status IN ('scheduled','revalidating','ready','dispatched');
CREATE INDEX IF NOT EXISTS ao_dispatch_idx
  ON public.anticipation_opportunities (status, eligible_from);
CREATE INDEX IF NOT EXISTS ao_user_date_idx
  ON public.anticipation_opportunities (user_id, opportunity_date DESC);

CREATE TABLE IF NOT EXISTS public.anticipation_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  opportunity_id uuid REFERENCES public.anticipation_opportunities(id) ON DELETE CASCADE,
  pattern_id uuid REFERENCES public.behavioral_patterns(id) ON DELETE SET NULL,
  detector text NOT NULL,
  opportunity_date date NOT NULL,
  predicted_value numeric NOT NULL DEFAULT 0,
  actual_value numeric NOT NULL DEFAULT 0,
  baseline_value numeric NOT NULL DEFAULT 0,
  outcome text NOT NULL DEFAULT 'unknown'
    CHECK (outcome IN ('unknown','confirmed','partial','not_confirmed','insufficient_data')),
  user_feedback text CHECK (user_feedback IN ('useful','not_useful','dismissed','muted')),
  interacted boolean NOT NULL DEFAULT false,
  acted boolean NOT NULL DEFAULT false,
  confidence_delta numeric NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  formula_version text NOT NULL DEFAULT 'anticipation_contract.v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id)
);
GRANT SELECT ON public.anticipation_outcomes TO authenticated;
GRANT ALL ON public.anticipation_outcomes TO service_role;
ALTER TABLE public.anticipation_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY aoc_owner_select ON public.anticipation_outcomes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.anticipation_detector_config (
  detector text NOT NULL,
  version text NOT NULL DEFAULT 'v1',
  active boolean NOT NULL DEFAULT false,
  kind text NOT NULL,
  min_sample integer NOT NULL DEFAULT 8,
  min_window_days integer NOT NULL DEFAULT 84,
  min_uplift_pct numeric NOT NULL DEFAULT 25,
  min_absolute_delta numeric NOT NULL DEFAULT 50,
  min_hit_rate numeric NOT NULL DEFAULT 0.6,
  min_confidence numeric NOT NULL DEFAULT 0.6,
  min_coverage numeric NOT NULL DEFAULT 0.85,
  min_utility_score numeric NOT NULL DEFAULT 0.5,
  lead_time_hours integer NOT NULL DEFAULT 12,
  window_hours integer NOT NULL DEFAULT 14,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (detector, version)
);
GRANT SELECT ON public.anticipation_detector_config TO authenticated;
GRANT ALL ON public.anticipation_detector_config TO service_role;
ALTER TABLE public.anticipation_detector_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY adc_read_authenticated ON public.anticipation_detector_config
  FOR SELECT TO authenticated USING (true);

-- 3. TRIGGERS updated_at -------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'behavioral_transaction_facts','behavioral_daily_facts','behavioral_cycle_facts',
    'behavioral_patterns','anticipation_opportunities','anticipation_outcomes',
    'anticipation_detector_config'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER touch_%1$s BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at()',
      t
    );
  END LOOP;
END $$;

-- 4. COLUNAS DE TEMPO EM transactions (aditivas, sem impacto contábil) ---
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS occurred_at_time time,
  ADD COLUMN IF NOT EXISTS occurred_at_timezone text,
  ADD COLUMN IF NOT EXISTS occurred_at_precision text,
  ADD COLUMN IF NOT EXISTS local_occurred_at timestamptz;
DO $$ BEGIN
  ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_occurred_at_precision_check
    CHECK (occurred_at_precision IS NULL OR occurred_at_precision IN ('day','hour','minute'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. PREFERÊNCIAS E FLAGS ------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS anticipation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS anticipation_whatsapp boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anticipation_kinds jsonb NOT NULL DEFAULT
    '{"comportamento":true,"cartao":true,"vencimentos":true,"metas":true,"compromissos":true,"recorrencias":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS muted_pattern_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.financial_feature_flags
  ADD COLUMN IF NOT EXISTS use_anticipation_engine boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anticipation_dry_run boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS anticipation_whatsapp_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.agent_settings
  ADD COLUMN IF NOT EXISTS anticipation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anticipation_dry_run boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS anticipation_rollout_pct smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS anticipation_rollout_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- 6. CATÁLOGO DE COMUNICAÇÃO --------------------------------------------
ALTER TABLE public.communication_catalog
  ADD COLUMN IF NOT EXISTS stale_policy text NOT NULL DEFAULT 'drop_after_window',
  ADD COLUMN IF NOT EXISTS default_window_hours integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS min_utility_score numeric NOT NULL DEFAULT 0.5;

INSERT INTO public.communication_catalog
  (kind, label, family, description, active, base_priority, allowed_channels, default_channels,
   sensitivity, fallback_policy, min_severity_for_whatsapp, cooldown_hours, max_per_day,
   content_mode, stale_policy, default_window_hours, min_utility_score, audience_note)
VALUES
  ('weekday_spending_risk','Dia da semana com gasto acima do habitual','anticipation',
   'Antecipa dias da semana em que o gasto ajustável costuma subir.',false,210,
   ARRAY['app','whatsapp'],ARRAY['app'],'normal','app_only','attention',72,1,'template','recompute_before_send',14,0.55,
   'Requer ao menos 12 semanas de histórico.'),
  ('weekend_spending_risk','Fim de semana com gasto acima do habitual','anticipation',
   'Antecipa fins de semana com concentração de gasto ajustável.',false,205,
   ARRAY['app','whatsapp'],ARRAY['app'],'normal','app_only','attention',72,1,'template','recompute_before_send',20,0.55,
   'Requer ao menos 12 semanas de histórico.'),
  ('month_phase_spending_risk','Fase do mês com gasto acima do habitual','anticipation',
   'Antecipa início, meio ou fim de mês com gasto historicamente maior.',false,200,
   ARRAY['app','whatsapp'],ARRAY['app'],'normal','app_only','attention',120,1,'template','convert_to_in_app',24,0.6,
   'Requer 4 a 6 meses de histórico.'),
  ('card_cycle_acceleration','Fatura acelerando no ciclo','anticipation',
   'Avisa quando a fatura em aberto cresce mais rápido que nos ciclos anteriores.',false,240,
   ARRAY['app','whatsapp'],ARRAY['app'],'normal','app_only','attention',72,1,'template','recompute_before_send',24,0.6,
   'Requer 3 ciclos fechados do mesmo cartão.'),
  ('upcoming_cash_pressure','Pressão de caixa à frente','anticipation',
   'Avisa quando compromissos previstos podem apertar o caixa antes da próxima entrada.',false,260,
   ARRAY['app','whatsapp'],ARRAY['app'],'normal','app_only','attention',48,1,'template','recompute_before_send',36,0.6,
   'Depende de recorrências e entradas previstas.'),
  ('expected_recurring_payment','Compromisso recorrente chegando','anticipation',
   'Antecipa pagamentos recorrentes esperados com base no histórico.',false,220,
   ARRAY['app','whatsapp'],ARRAY['app'],'normal','app_only','attention',72,1,'template','send_summary_later',24,0.5,
   'Requer 3 ocorrências do mesmo compromisso.'),
  ('small_spend_acceleration','Gastos pequenos somando mais que o habitual','anticipation',
   'Antecipa acúmulo de gastos pequenos acima do padrão pessoal.',false,190,
   ARRAY['app','whatsapp'],ARRAY['app'],'normal','app_only','critical',120,1,'template','convert_to_in_app',24,0.55,
   'Requer 8 semanas de histórico.')
ON CONFLICT (kind) DO NOTHING;

INSERT INTO public.communication_templates (kind, channel, title_template, body_template, allowed_variables, active, version)
SELECT c.kind, ch.channel,
  CASE ch.channel WHEN 'app' THEN c.label ELSE 'Meu Nino' END,
  '{{body}}',
  ARRAY['body','periodo','amostra','valor_previsto','valor_habitual','diferenca'],
  true, 1
FROM public.communication_catalog c
CROSS JOIN (VALUES ('app'),('whatsapp')) AS ch(channel)
WHERE c.family = 'anticipation'
ON CONFLICT (kind, channel, version) DO NOTHING;

INSERT INTO public.anticipation_detector_config
  (detector, kind, min_sample, min_window_days, min_uplift_pct, min_absolute_delta,
   min_hit_rate, min_confidence, min_coverage, min_utility_score, lead_time_hours, window_hours, active, notes)
VALUES
  ('weekday_spending_risk','weekday_spending_risk',12,84,25,60,0.6,0.6,0.85,0.55,12,14,false,'12 a 26 semanas'),
  ('weekend_spending_risk','weekend_spending_risk',12,84,25,80,0.6,0.6,0.85,0.55,14,20,false,'12 a 26 semanas'),
  ('month_phase_spending_risk','month_phase_spending_risk',4,120,25,120,0.6,0.65,0.85,0.6,24,24,false,'4 a 6 meses'),
  ('card_cycle_acceleration','card_cycle_acceleration',3,90,20,150,0.6,0.65,0.85,0.6,24,24,false,'3 a 6 ciclos'),
  ('upcoming_cash_pressure','upcoming_cash_pressure',3,90,0,100,0.5,0.6,0.8,0.6,36,36,false,'compromissos previstos'),
  ('expected_recurring_payment','expected_recurring_payment',3,90,0,50,0.66,0.6,0.8,0.5,24,24,false,'3 a 12 meses'),
  ('small_spend_acceleration','small_spend_acceleration',8,56,30,80,0.6,0.6,0.85,0.55,12,24,false,'8 semanas')
ON CONFLICT (detector, version) DO NOTHING;
