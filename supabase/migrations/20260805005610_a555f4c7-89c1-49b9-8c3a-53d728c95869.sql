-- ============================================================
-- nino_contract.v2 — camada de curadoria editorial
-- ============================================================

ALTER TABLE public.nino_intelligence_items
  ADD COLUMN IF NOT EXISTS logical_topic_key text,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'intelligence',
  ADD COLUMN IF NOT EXISTS group_key text,
  ADD COLUMN IF NOT EXISTS group_size integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS impact_amount numeric,
  ADD COLUMN IF NOT EXISTS impact_pct numeric,
  ADD COLUMN IF NOT EXISTS selection_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS suppression_reason text;

-- Unicidade lógica é garantida por nino_consolidate_topics (o rebuild pode
-- reativar linhas antigas antes da consolidação, então o índice é de leitura).
CREATE INDEX IF NOT EXISTS nino_items_topic_active_idx
  ON public.nino_intelligence_items (user_id, logical_topic_key)
  WHERE status = 'active' AND logical_topic_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS nino_items_category_active_idx
  ON public.nino_intelligence_items (user_id, category, priority DESC)
  WHERE status = 'active';

-- ------------------------------------------------------------
-- Decisões de duplicidade
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nino_duplicate_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pair_key text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('distinct','duplicate','ignored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pair_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nino_duplicate_decisions TO authenticated;
GRANT ALL ON public.nino_duplicate_decisions TO service_role;

ALTER TABLE public.nino_duplicate_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own duplicate decisions" ON public.nino_duplicate_decisions;
CREATE POLICY "own duplicate decisions" ON public.nino_duplicate_decisions
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_nino_dup_decisions_touch ON public.nino_duplicate_decisions;
CREATE TRIGGER trg_nino_dup_decisions_touch
  BEFORE UPDATE ON public.nino_duplicate_decisions
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- ------------------------------------------------------------
-- Normalização de texto
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_norm_text(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(
           lower(translate(coalesce(_t,''),
             'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
           '[^a-z0-9]+', '', 'g');
$$;

-- ------------------------------------------------------------
-- Gate semântico
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_semantic_gate(_kind text, _text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _kind NOT IN ('recommendation','opportunity','risk') THEN NULL
    WHEN lower(coalesce(_text,'')) ~ '(estorno|reembolso|transfer[eê]ncia|aplica[cç][aã]o|resgate|pagamento de fatura|pagamento da fatura|pagamento de d[ií]vida|amortiza|ajuste de concilia)'
      THEN 'movimento_nao_comparavel'
    ELSE NULL
  END;
$$;

-- ------------------------------------------------------------
-- Tópico lógico
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_topic_key(
  _kind text, _title text, _source text, _period_start date, _evidence jsonb, _action jsonb
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN coalesce(_action->>'type','') = 'review_duplicate'
      OR _title ~* '^confira \d+ lan' THEN 'duplicate_review'
    WHEN _title ~* '(categorizar|sem categoria)' OR _kind = 'data_quality' THEN 'uncategorized_cleanup'
    WHEN _title ~* '^entender os' OR _title ~* '^revisar os maiores gastos'
      THEN 'category_driver:' || public.nino_norm_text(regexp_replace(_title, '^.* em ', ''))
    WHEN _title ~* 'recalibrar' THEN 'goal_recalibration:' || public.nino_norm_text(_title)
    WHEN _title ~* '(revis[aã]o|fechamento) (da |de |semanal|mensal)'
      THEN 'period_review:' || coalesce(_period_start::text, 'atual')
    WHEN _kind = 'closed_period_summary' THEN 'closing:' || coalesce(_period_start::text,'') 
    ELSE _kind || ':' || public.nino_norm_text(_title)
  END;
$$;

-- ------------------------------------------------------------
-- Categoria editorial
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_item_category(_kind text, _topic text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _kind = 'closed_period_summary' THEN 'closing'
    WHEN _kind IN ('data_quality','pending_confirmation') THEN 'operational'
    WHEN _topic IN ('duplicate_review','uncategorized_cleanup') THEN 'operational'
    ELSE 'intelligence'
  END;
$$;

-- ------------------------------------------------------------
-- Score determinístico
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_score_item(
  _kind text, _severity text, _category text, _impact numeric, _impact_pct numeric,
  _confidence numeric, _valid_from timestamptz, _exposures integer, _group_size integer
) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT GREATEST(1, LEAST(99, (
      CASE _severity WHEN 'critical' THEN 82 WHEN 'attention' THEN 64 ELSE 46 END
    + LEAST(14, coalesce(_impact,0) / 150.0)::int
    + LEAST(8, coalesce(_impact_pct,0) / 6.0)::int
    + (coalesce(_confidence,0.5) * 8)::int
    + LEAST(4, GREATEST(0, coalesce(_group_size,1) - 1))
    + CASE WHEN _kind IN ('pending_confirmation','risk') THEN 6 ELSE 0 END
    - LEAST(18, GREATEST(0, (EXTRACT(EPOCH FROM (now() - coalesce(_valid_from, now())))/86400)::int / 3))
    - LEAST(10, coalesce(_exposures,0) * 2)
    - CASE _category WHEN 'operational' THEN 22 WHEN 'closing' THEN 30 ELSE 0 END
  )::int));
$$;

-- ------------------------------------------------------------
-- Agrupamento de duplicidades
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_group_duplicates(_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pairs jsonb := '[]'::jsonb;
  v_count int := 0;
  v_impact numeric := 0;
  r record;
  v_key text;
BEGIN
  FOR r IN
    SELECT i.* FROM public.nino_intelligence_items i
     WHERE i.user_id = _user_id AND i.status = 'active'
       AND i.logical_topic_key = 'duplicate_review'
       AND coalesce(i.group_key,'') <> 'duplicate_review_summary'
     ORDER BY (i.evidence->>'occurred_at') DESC NULLS LAST
  LOOP
    v_key := public.nino_norm_text(coalesce(r.evidence->>'description', r.title))
             || '::' || coalesce(r.evidence->>'amount','0')
             || '::' || coalesce(r.evidence->>'occurred_at','');

    IF EXISTS (SELECT 1 FROM public.nino_duplicate_decisions d
                WHERE d.user_id = _user_id AND d.pair_key = v_key) THEN
      UPDATE public.nino_intelligence_items
         SET status = 'archived', suppression_reason = 'decidido_pelo_usuario', updated_at = now()
       WHERE id = r.id;
      CONTINUE;
    END IF;

    v_count := v_count + 1;
    v_impact := v_impact + coalesce((r.evidence->>'amount')::numeric, 0)
                * GREATEST(coalesce((r.evidence->>'count')::int, 2) - 1, 1);
    v_pairs := v_pairs || jsonb_build_object(
      'pair_key', v_key,
      'merchant', coalesce(r.evidence->>'description', r.title),
      'amount', coalesce((r.evidence->>'amount')::numeric, 0),
      'occurred_at', r.evidence->>'occurred_at',
      'count', coalesce((r.evidence->>'count')::int, 2),
      'transactions', coalesce(r.evidence->'transactions', '[]'::jsonb));

    UPDATE public.nino_intelligence_items
       SET status = 'archived', group_key = 'duplicate_review_member',
           suppression_reason = 'agrupado_em_resumo', updated_at = now()
     WHERE id = r.id;
  END LOOP;

  IF v_count = 0 THEN
    UPDATE public.nino_intelligence_items
       SET status = 'expired', updated_at = now()
     WHERE user_id = _user_id AND status = 'active' AND group_key = 'duplicate_review_summary';
    RETURN 0;
  END IF;

  INSERT INTO public.nino_intelligence_items
    (user_id, kind, temporal_role, status, priority, severity, title, summary, explanation,
     evidence, primary_action, secondary_action, source, valid_until, confidence, data_quality,
     dedup_key, logical_topic_key, category, group_key, group_size, impact_amount,
     selection_reason, created_by)
  VALUES (_user_id, 'data_quality', 'now', 'active', 66, 'attention',
    CASE WHEN v_count = 1 THEN '1 possível duplicidade para revisar'
         ELSE v_count || ' possíveis duplicidades para revisar' END,
    'R$ ' || public.nino_num(v_impact) || ' podem estar contados duas vezes.',
    'O Nino encontrou lançamentos idênticos no mesmo dia. Revise cada par e marque se é duplicado ou se são compras diferentes.',
    jsonb_build_object('pairs', v_pairs, 'pair_count', v_count, 'amount_at_risk', v_impact),
    jsonb_build_object('label','Revisar duplicidades','route','/app/lancamentos?revisar=duplicidades'),
    NULL, 'nino_curation', now() + interval '21 days', 0.8, 'attention',
    'group:duplicate_review', 'duplicate_review', 'operational', 'duplicate_review_summary',
    v_count, v_impact,
    jsonb_build_object('reason','duplicidades_agrupadas','members',v_count), 'curation')
  ON CONFLICT (user_id, dedup_key) DO UPDATE
    SET title = EXCLUDED.title, summary = EXCLUDED.summary, explanation = EXCLUDED.explanation,
        evidence = EXCLUDED.evidence, primary_action = EXCLUDED.primary_action,
        group_size = EXCLUDED.group_size, impact_amount = EXCLUDED.impact_amount,
        logical_topic_key = EXCLUDED.logical_topic_key, category = EXCLUDED.category,
        group_key = EXCLUDED.group_key, selection_reason = EXCLUDED.selection_reason,
        status = 'active', suppression_reason = NULL, superseded_at = NULL,
        valid_until = EXCLUDED.valid_until, updated_at = now();

  RETURN v_count;
END $$;

-- ------------------------------------------------------------
-- Consolidação por tópico
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_consolidate_topics(_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY logical_topic_key
             ORDER BY (CASE WHEN source IN ('facts','nino_curation') THEN 1 ELSE 0 END) DESC,
                      priority DESC, updated_at DESC, created_at DESC) rn
      FROM public.nino_intelligence_items
     WHERE user_id = _user_id AND status = 'active' AND logical_topic_key IS NOT NULL
  )
  UPDATE public.nino_intelligence_items i
     SET status = 'superseded', superseded_at = now(),
         suppression_reason = coalesce(i.suppression_reason, 'consolidado_no_topico'),
         updated_at = now()
    FROM ranked r
   WHERE i.id = r.id AND r.rn > 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ------------------------------------------------------------
-- Curadoria orquestrada
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_curate_items(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expired int; v_suppressed int; v_contradictory int; v_fixed int;
  v_grouped int; v_consolidated int; v_rerouted int;
BEGIN
  -- 1) vencidos
  UPDATE public.nino_intelligence_items
     SET status='expired', updated_at=now()
   WHERE user_id=_user_id AND status='active'
     AND valid_until IS NOT NULL AND valid_until < now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- 2) tópico lógico + categoria + impacto
  UPDATE public.nino_intelligence_items i
     SET logical_topic_key = public.nino_topic_key(i.kind::text, i.title, i.source,
                               i.source_period_start, i.evidence, i.primary_action),
         category = public.nino_item_category(i.kind::text,
                      public.nino_topic_key(i.kind::text, i.title, i.source,
                        i.source_period_start, i.evidence, i.primary_action)),
         impact_amount = COALESCE(i.impact_amount,
                           NULLIF(abs(COALESCE((i.evidence->>'absolute_delta')::numeric,
                                               (i.evidence->>'amount')::numeric,
                                               (i.evidence->'evidence_summary'->>'delta')::numeric, 0)), 0)),
         impact_pct = COALESCE(i.impact_pct,
                        NULLIF(abs(COALESCE((i.evidence->>'percentage_delta')::numeric,
                                            (i.evidence->'evidence_summary'->>'uplift_pct')::numeric, 0)), 0)),
         updated_at = i.updated_at
   WHERE i.user_id=_user_id AND i.status='active';

  -- 3) gate semântico
  UPDATE public.nino_intelligence_items i
     SET status='archived',
         suppression_reason = public.nino_semantic_gate(i.kind::text,
           coalesce(i.title,'') || ' ' || coalesce(i.summary,'') || ' ' || coalesce(i.explanation,'')),
         updated_at=now()
   WHERE i.user_id=_user_id AND i.status='active'
     AND public.nino_semantic_gate(i.kind::text,
           coalesce(i.title,'') || ' ' || coalesce(i.summary,'') || ' ' || coalesce(i.explanation,'')) IS NOT NULL;
  GET DIAGNOSTICS v_suppressed = ROW_COUNT;

  -- 4) padrões com título contraditório
  UPDATE public.nino_intelligence_items i
     SET status='archived', suppression_reason='direcao_contraditoria', updated_at=now()
   WHERE i.user_id=_user_id AND i.status='active' AND i.kind='pattern'
     AND lower(coalesce(i.title,'')) ~ '(maior|aumento|mais alto|sobe|cresce)'
     AND COALESCE((i.evidence->'evidence_summary'->>'delta')::numeric,
                  (i.evidence->'evidence_summary'->>'uplift_pct')::numeric, 0) < 0;
  GET DIAGNOSTICS v_contradictory = ROW_COUNT;

  -- 5) agrupar duplicidades
  v_grouped := public.nino_group_duplicates(_user_id);

  -- 6) rotas auto-referentes
  UPDATE public.nino_intelligence_items i
     SET primary_action = jsonb_build_object(
           'label', CASE
             WHEN i.logical_topic_key = 'uncategorized_cleanup' THEN 'Classificar lançamentos'
             WHEN i.logical_topic_key LIKE 'category_driver:%' THEN 'Ver a categoria'
             WHEN i.logical_topic_key LIKE 'goal_recalibration:%' THEN 'Ajustar a meta'
             WHEN i.logical_topic_key LIKE 'period_review:%' THEN 'Abrir a revisão'
             ELSE 'Resolver agora' END,
           'route', CASE
             WHEN i.logical_topic_key = 'uncategorized_cleanup' THEN '/app/lancamentos?filtro=sem-categoria'
             WHEN i.logical_topic_key LIKE 'category_driver:%' THEN '/app/relatorios'
             WHEN i.logical_topic_key LIKE 'goal_recalibration:%' THEN '/app/metas'
             WHEN i.logical_topic_key LIKE 'period_review:%' THEN '/app/relatorios'
             ELSE '/app/lancamentos' END),
         updated_at = now()
   WHERE i.user_id=_user_id AND i.status='active'
     AND coalesce(i.primary_action->>'route','') IN ('/app/nino','/app/nino-hub','');
  GET DIAGNOSTICS v_rerouted = ROW_COUNT;

  -- 7) papel temporal coerente
  UPDATE public.nino_intelligence_items i
     SET temporal_role = 'historical', updated_at = now()
   WHERE i.user_id=_user_id AND i.status='active'
     AND i.temporal_role = 'now' AND i.kind <> 'closed_period_summary'
     AND i.source_period_end IS NOT NULL
     AND i.source_period_end < date_trunc('month', current_date)::date;

  -- 8) score
  UPDATE public.nino_intelligence_items i
     SET priority = public.nino_score_item(i.kind::text, i.severity, i.category,
           i.impact_amount, i.impact_pct, i.confidence, i.valid_from,
           (SELECT count(*)::int FROM public.nino_item_exposures e WHERE e.item_id = i.id),
           i.group_size),
         selection_reason = i.selection_reason || jsonb_build_object(
           'scored_at', now(), 'category', i.category, 'topic', i.logical_topic_key,
           'impact_amount', i.impact_amount, 'impact_pct', i.impact_pct,
           'severity', i.severity, 'confidence', i.confidence),
         updated_at = i.updated_at
   WHERE i.user_id=_user_id AND i.status='active';

  -- 9) consolidar tópicos
  v_consolidated := public.nino_consolidate_topics(_user_id);

  -- 10) formatação monetária pt-BR
  UPDATE public.nino_intelligence_items
     SET title = public.nino_fix_money_text(title),
         summary = public.nino_fix_money_text(summary),
         explanation = public.nino_fix_money_text(explanation)
   WHERE user_id=_user_id
     AND (title ~ '\d\.\d{2}(\D|$)' OR summary ~ '\d\.\d{2}(\D|$)' OR explanation ~ '\d\.\d{2}(\D|$)'
          OR title ~ '\d,\d{3}' OR summary ~ '\d,\d{3}' OR explanation ~ '\d,\d{3}');
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true, 'expired', v_expired,
    'suppressed', v_suppressed + v_contradictory,
    'grouped', v_grouped, 'consolidated', v_consolidated,
    'rerouted', v_rerouted, 'reformatted', v_fixed,
    'superseded', v_consolidated, 'archived', v_suppressed + v_contradictory);
END $$;

-- ------------------------------------------------------------
-- Item JSON estendido
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nino_item_json(_row nino_intelligence_items)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', _row.id, 'kind', _row.kind, 'temporal_role', _row.temporal_role,
    'status', _row.status, 'priority', _row.priority, 'severity', _row.severity,
    'title', _row.title, 'summary', _row.summary, 'explanation', _row.explanation,
    'evidence', _row.evidence, 'primary_action', _row.primary_action,
    'secondary_action', _row.secondary_action, 'source', _row.source,
    'period', jsonb_build_object('start', _row.source_period_start, 'end', _row.source_period_end),
    'valid_from', _row.valid_from, 'valid_until', _row.valid_until,
    'confidence', _row.confidence, 'data_quality', _row.data_quality,
    'report_id', _row.report_id, 'dedup_key', _row.dedup_key,
    'category', _row.category, 'logical_topic_key', _row.logical_topic_key,
    'group_key', _row.group_key, 'group_size', _row.group_size,
    'impact_amount', _row.impact_amount, 'impact_pct', _row.impact_pct,
    'selection_reason', _row.selection_reason,
    'created_at', _row.created_at, 'updated_at', _row.updated_at,
    'acted_at', _row.acted_at, 'dismissed_at', _row.dismissed_at);
$$;

-- ------------------------------------------------------------
-- Contexto da tela do Nino (v2)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_nino_intelligence_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_last_seen timestamptz;
  v_continuity text;
  v_primary jsonb;
  v_primary_id uuid;
  v_patterns int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;

  SELECT last_seen_at, continuity_topic INTO v_last_seen, v_continuity
    FROM public.nino_surface_state WHERE user_id=v_uid AND surface='nino' AND section='all';

  SELECT i.id, public.nino_item_json(i) INTO v_primary_id, v_primary
    FROM public.nino_intelligence_items i
   WHERE i.user_id=v_uid AND i.status='active' AND i.category='intelligence'
     AND i.temporal_role IN ('now','future')
   ORDER BY i.priority DESC, i.updated_at DESC LIMIT 1;

  IF v_continuity IS NULL THEN v_continuity := v_primary->>'title'; END IF;

  SELECT count(*)::int INTO v_patterns FROM public.behavioral_patterns
   WHERE user_id=v_uid AND status IN ('candidate','validated','active','weakened');

  RETURN jsonb_build_object(
    'ok', true,
    'contract', 'nino_contract.v2',
    'as_of', now(),
    'continuity_topic', v_continuity,
    'last_seen_at', v_last_seen,
    'new_since_last_visit', (SELECT COUNT(*) FROM public.nino_intelligence_items i
      WHERE i.user_id=v_uid AND i.status='active' AND (v_last_seen IS NULL OR i.created_at > v_last_seen)),
    'primary_item', v_primary,
    'secondary_changes', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT public.nino_item_json(i) x FROM public.nino_intelligence_items i
        WHERE i.user_id=v_uid AND i.status='active' AND i.category='intelligence'
          AND i.temporal_role='now' AND (v_primary_id IS NULL OR i.id <> v_primary_id)
        ORDER BY i.priority DESC, i.updated_at DESC LIMIT 5) s), '[]'::jsonb),
    'now', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT public.nino_item_json(i) x FROM public.nino_intelligence_items i
        WHERE i.user_id=v_uid AND i.status='active' AND i.category='intelligence'
          AND i.temporal_role='now'
        ORDER BY i.priority DESC, i.updated_at DESC LIMIT 6) s), '[]'::jsonb),
    'operational_tasks', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT public.nino_item_json(i) x FROM public.nino_intelligence_items i
        WHERE i.user_id=v_uid AND i.status='active' AND i.category='operational'
        ORDER BY i.priority DESC, i.updated_at DESC LIMIT 6) s), '[]'::jsonb),
    'changes', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT public.nino_item_json(i) x FROM public.nino_intelligence_items i
        WHERE i.user_id=v_uid AND i.status='active' AND i.kind='change'
        ORDER BY i.priority DESC, i.updated_at DESC LIMIT 5) s), '[]'::jsonb),
    'learnings', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT public.nino_item_json(i) x FROM public.nino_intelligence_items i
        WHERE i.user_id=v_uid AND i.status='active' AND i.kind='pattern'
        ORDER BY i.priority DESC, i.confidence DESC LIMIT 3) s), '[]'::jsonb),
    'prepare', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT public.nino_item_json(i) x FROM public.nino_intelligence_items i
        WHERE i.user_id=v_uid AND i.status='active' AND i.temporal_role='future'
        ORDER BY i.priority DESC, i.valid_from LIMIT 3) s), '[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'updated_at') DESC) FROM (
        SELECT public.nino_item_json(i) x FROM public.nino_intelligence_items i
        WHERE i.user_id=v_uid
          AND (i.temporal_role IN ('historical','closed_period') OR i.status IN ('acted','expired','superseded'))
          AND coalesce(i.suppression_reason,'') NOT IN ('agrupado_em_resumo','consolidado_no_topico')
        ORDER BY i.updated_at DESC LIMIT 30) s), '[]'::jsonb),
    'achievements', COALESCE((SELECT jsonb_agg(public.nino_item_json(i) ORDER BY i.updated_at DESC)
      FROM public.nino_intelligence_items i
      WHERE i.user_id=v_uid AND i.status='active' AND i.kind='achievement'), '[]'::jsonb),
    'engine_state', jsonb_build_object(
      'patterns_tracked', v_patterns,
      'anticipations_open', (SELECT count(*)::int FROM public.anticipation_opportunities
        WHERE user_id=v_uid AND status IN ('scheduled','ready','revalidating','dispatched')),
      'suppressed_total', (SELECT count(*)::int FROM public.nino_intelligence_items
        WHERE user_id=v_uid AND suppression_reason IS NOT NULL)),
    'data_quality', jsonb_build_object(
      'status', CASE
        WHEN (SELECT COUNT(*) FROM public.transactions t WHERE t.user_id=v_uid AND t.status='confirmed') = 0 THEN 'insufficient'
        WHEN EXISTS (SELECT 1 FROM public.nino_intelligence_items i
                      WHERE i.user_id=v_uid AND i.status='active' AND i.kind='data_quality') THEN 'attention'
        ELSE 'ok' END,
      'uncategorized_count', (SELECT COUNT(*) FROM public.transactions t
        WHERE t.user_id=v_uid AND t.category_id IS NULL AND t.status='confirmed'
          AND COALESCE(t.movement_kind,'transaction')='transaction'
          AND t.occurred_at >= date_trunc('month', current_date)::date))
  );
END $$;

-- ------------------------------------------------------------
-- Refresh com resumo real
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_nino_refresh()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_started timestamptz := now();
  v_items int;
  v_curation jsonb;
  v_created int; v_updated int; v_superseded int; v_expired int; v_active int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;

  v_items := public.nino_rebuild_items(v_uid, 'manual');
  v_curation := public.nino_curate_items(v_uid);

  SELECT
    count(*) FILTER (WHERE created_at >= v_started),
    count(*) FILTER (WHERE created_at < v_started AND updated_at >= v_started AND status='active'),
    count(*) FILTER (WHERE updated_at >= v_started AND status='superseded'),
    count(*) FILTER (WHERE updated_at >= v_started AND status IN ('expired','archived')),
    count(*) FILTER (WHERE status='active')
    INTO v_created, v_updated, v_superseded, v_expired, v_active
    FROM public.nino_intelligence_items WHERE user_id=v_uid;

  RETURN jsonb_build_object(
    'ok', true, 'at', now(), 'items', v_items,
    'facts_processed', v_items,
    'counts', jsonb_build_object(
      'created', COALESCE(v_created,0),
      'updated', COALESCE(v_updated,0),
      'superseded', COALESCE(v_superseded,0),
      'expired', COALESCE(v_expired,0),
      'grouped', COALESCE((v_curation->>'grouped')::int,0),
      'suppressed', COALESCE((v_curation->>'suppressed')::int,0),
      'active_total', COALESCE(v_active,0)),
    'curation', v_curation);
END $$;

-- ------------------------------------------------------------
-- Decisão de duplicidade
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_nino_duplicate_decision(_pair_key text, _decision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  IF coalesce(_pair_key,'') = '' OR _decision NOT IN ('distinct','duplicate','ignored') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  INSERT INTO public.nino_duplicate_decisions (user_id, pair_key, decision)
  VALUES (v_uid, _pair_key, _decision)
  ON CONFLICT (user_id, pair_key) DO UPDATE SET decision = EXCLUDED.decision, updated_at = now();

  PERFORM public.nino_group_duplicates(v_uid);
  RETURN jsonb_build_object('ok', true, 'pair_key', _pair_key, 'decision', _decision);
END $$;

REVOKE ALL ON FUNCTION public.my_nino_duplicate_decision(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_nino_duplicate_decision(text, text) TO authenticated;
