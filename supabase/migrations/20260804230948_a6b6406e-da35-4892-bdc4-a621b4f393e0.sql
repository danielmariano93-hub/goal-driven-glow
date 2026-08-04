-- =========================================================
-- NINO INTELLIGENCE — construtores, orquestrador e contratos
-- =========================================================

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION public.nino_expense_sum(_user_id uuid, _from date, _to date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(t.amount), 0)::numeric
  FROM public.transactions t
  WHERE t.user_id = _user_id
    AND t.type = 'expense'
    AND t.status = 'confirmed'
    AND COALESCE(t.movement_kind, 'transaction') = 'transaction'
    AND t.transfer_group_id IS NULL
    AND t.occurred_at BETWEEN _from AND _to;
$$;

-- ---------- 1) FATOS DERIVADOS ----------
CREATE OR REPLACE FUNCTION public.nino_build_facts(_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_end date := current_date;
  v_start date := date_trunc('month', current_date)::date;
  v_prev_start date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_prev_end date := v_prev_start + (v_end - v_start);
  v_cur numeric;
  v_prev numeric;
  v_count integer := 0;
  r record;
BEGIN
  v_cur := public.nino_expense_sum(_user_id, v_start, v_end);
  v_prev := public.nino_expense_sum(_user_id, v_prev_start, v_prev_end);

  INSERT INTO public.financial_insight_facts
    (user_id, period_start, period_end, as_of, fact_type, metric_key,
     current_value, comparison_value, absolute_delta, percentage_delta,
     evidence, coverage, confidence, valid_until)
  VALUES (_user_id, v_start, v_end, now(), 'spend_change', 'expense_total',
     v_cur, v_prev, round(v_cur - v_prev, 2),
     CASE WHEN v_prev > 0 THEN round(((v_cur - v_prev) / v_prev) * 100, 1) ELSE NULL END,
     jsonb_build_object('previous_period', jsonb_build_object('start', v_prev_start, 'end', v_prev_end)),
     1, 0.9, now() + interval '2 days')
  ON CONFLICT (user_id, fact_type, metric_key, period_start, period_end,
               COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
               COALESCE(merchant_normalized, ''))
  DO UPDATE SET current_value = EXCLUDED.current_value,
                comparison_value = EXCLUDED.comparison_value,
                absolute_delta = EXCLUDED.absolute_delta,
                percentage_delta = EXCLUDED.percentage_delta,
                as_of = now(), valid_until = EXCLUDED.valid_until, updated_at = now();
  v_count := v_count + 1;

  -- contribuição por categoria (top 3 por variação absoluta)
  FOR r IN
    WITH cur AS (
      SELECT t.category_id, SUM(t.amount) total, COUNT(*) cnt,
             array_agg(t.id) ids
      FROM public.transactions t
      WHERE t.user_id = _user_id AND t.type='expense' AND t.status='confirmed'
        AND COALESCE(t.movement_kind,'transaction')='transaction' AND t.transfer_group_id IS NULL
        AND t.occurred_at BETWEEN v_start AND v_end
      GROUP BY t.category_id
    ), prev AS (
      SELECT t.category_id, SUM(t.amount) total
      FROM public.transactions t
      WHERE t.user_id = _user_id AND t.type='expense' AND t.status='confirmed'
        AND COALESCE(t.movement_kind,'transaction')='transaction' AND t.transfer_group_id IS NULL
        AND t.occurred_at BETWEEN v_prev_start AND v_prev_end
      GROUP BY t.category_id
    )
    SELECT c.category_id, c.total, c.cnt, c.ids, COALESCE(p.total,0) prev_total,
           COALESCE(cat.name, 'Sem categoria') cat_name
    FROM cur c
    LEFT JOIN prev p ON p.category_id IS NOT DISTINCT FROM c.category_id
    LEFT JOIN public.categories cat ON cat.id = c.category_id
    ORDER BY abs(c.total - COALESCE(p.total,0)) DESC
    LIMIT 3
  LOOP
    INSERT INTO public.financial_insight_facts
      (user_id, period_start, period_end, as_of, fact_type, metric_key, category_id,
       current_value, comparison_value, absolute_delta, percentage_delta,
       transaction_ids, evidence, coverage, confidence, valid_until)
    VALUES (_user_id, v_start, v_end, now(), 'category_driver', 'expense_by_category', r.category_id,
       r.total, r.prev_total, round(r.total - r.prev_total, 2),
       CASE WHEN r.prev_total > 0 THEN round(((r.total - r.prev_total)/r.prev_total)*100, 1) ELSE NULL END,
       COALESCE(r.ids, '{}'),
       jsonb_build_object('category_name', r.cat_name, 'transaction_count', r.cnt,
                          'share_of_expense', CASE WHEN v_cur > 0 THEN round((r.total/v_cur)*100,1) ELSE NULL END),
       1, 0.85, now() + interval '2 days')
    ON CONFLICT (user_id, fact_type, metric_key, period_start, period_end,
                 COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 COALESCE(merchant_normalized, ''))
    DO UPDATE SET current_value = EXCLUDED.current_value, comparison_value = EXCLUDED.comparison_value,
                  absolute_delta = EXCLUDED.absolute_delta, percentage_delta = EXCLUDED.percentage_delta,
                  transaction_ids = EXCLUDED.transaction_ids, evidence = EXCLUDED.evidence,
                  as_of = now(), valid_until = EXCLUDED.valid_until, updated_at = now();
    v_count := v_count + 1;
  END LOOP;

  -- qualidade de dados: lançamentos sem categoria
  SELECT COUNT(*), COALESCE(SUM(amount),0) INTO r FROM (SELECT 1) s LIMIT 0;
  INSERT INTO public.financial_insight_facts
    (user_id, period_start, period_end, as_of, fact_type, metric_key,
     current_value, evidence, coverage, confidence, valid_until)
  SELECT _user_id, v_start, v_end, now(), 'data_quality', 'uncategorized_expenses',
         COUNT(*)::numeric,
         jsonb_build_object('total_amount', COALESCE(SUM(t.amount),0)),
         1, 1, now() + interval '2 days'
  FROM public.transactions t
  WHERE t.user_id = _user_id AND t.type='expense' AND t.status='confirmed'
    AND COALESCE(t.movement_kind,'transaction')='transaction'
    AND t.category_id IS NULL AND t.occurred_at BETWEEN v_start AND v_end
  ON CONFLICT (user_id, fact_type, metric_key, period_start, period_end,
               COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
               COALESCE(merchant_normalized, ''))
  DO UPDATE SET current_value = EXCLUDED.current_value, evidence = EXCLUDED.evidence,
                as_of = now(), valid_until = EXCLUDED.valid_until, updated_at = now();
  v_count := v_count + 1;

  RETURN v_count;
END $$;

-- ---------- 2) CONSTRUTOR DE ITENS (adaptadores + fatos) ----------
CREATE OR REPLACE FUNCTION public.nino_rebuild_items(_user_id uuid, _created_by text DEFAULT 'engine')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n integer := 0;
  v_brl text;
  f record;
  r record;
BEGIN
  PERFORM public.nino_build_facts(_user_id);

  -- 2.1 mudança de gastos
  SELECT * INTO f FROM public.financial_insight_facts
   WHERE user_id=_user_id AND fact_type='spend_change' AND metric_key='expense_total'
   ORDER BY as_of DESC LIMIT 1;
  IF f.id IS NOT NULL AND (COALESCE(f.current_value,0) > 0 OR COALESCE(f.comparison_value,0) > 0) THEN
    INSERT INTO public.nino_intelligence_items
      (user_id, kind, temporal_role, status, priority, severity, title, summary, explanation,
       facts, evidence, primary_action, source, source_period_start, source_period_end,
       valid_until, confidence, dedup_key, created_by)
    VALUES (_user_id, 'change', 'now', 'active',
      CASE WHEN COALESCE(f.percentage_delta,0) >= 15 THEN 78 ELSE 60 END,
      CASE WHEN COALESCE(f.percentage_delta,0) >= 25 THEN 'attention' ELSE 'info' END,
      CASE
        WHEN COALESCE(f.absolute_delta,0) > 0 THEN 'Seus gastos aumentaram ' || to_char(abs(COALESCE(f.absolute_delta,0)), 'FM999G999G990D00')
        WHEN COALESCE(f.absolute_delta,0) < 0 THEN 'Seus gastos caíram ' || to_char(abs(COALESCE(f.absolute_delta,0)), 'FM999G999G990D00')
        ELSE 'Seu ritmo de gastos está estável'
      END,
      'Comparado ao mesmo intervalo do mês anterior.',
      'No período atual você registrou R$ ' || to_char(COALESCE(f.current_value,0), 'FM999G999G990D00')
        || ' contra R$ ' || to_char(COALESCE(f.comparison_value,0), 'FM999G999G990D00')
        || ' do período anterior.',
      jsonb_build_array(f.id), f.evidence,
      jsonb_build_object('label','Ver relatório','route','/app/relatorios'),
      'facts', f.period_start, f.period_end, f.valid_until, f.confidence,
      'fact:spend_change:' || f.period_start || ':' || f.period_end, _created_by)
    ON CONFLICT (user_id, dedup_key) DO UPDATE
      SET title=EXCLUDED.title, explanation=EXCLUDED.explanation, summary=EXCLUDED.summary,
          facts=EXCLUDED.facts, evidence=EXCLUDED.evidence, priority=EXCLUDED.priority,
          severity=EXCLUDED.severity, valid_until=EXCLUDED.valid_until, status='active',
          superseded_at=NULL, updated_at=now();
    v_n := v_n + 1;
  END IF;

  -- 2.2 categoria que explicou a diferença
  FOR f IN
    SELECT * FROM public.financial_insight_facts
     WHERE user_id=_user_id AND fact_type='category_driver'
       AND abs(COALESCE(absolute_delta,0)) >= 50
     ORDER BY abs(COALESCE(absolute_delta,0)) DESC LIMIT 2
  LOOP
    INSERT INTO public.nino_intelligence_items
      (user_id, kind, temporal_role, status, priority, severity, title, summary, explanation,
       facts, evidence, primary_action, source, source_period_start, source_period_end,
       valid_until, confidence, dedup_key, created_by)
    VALUES (_user_id, 'change', 'now', 'active', 55, 'info',
      COALESCE(f.evidence->>'category_name','Sem categoria') || ' variou R$ '
        || to_char(abs(COALESCE(f.absolute_delta,0)), 'FM999G999G990D00'),
      'Categoria com maior peso na diferença do período.',
      COALESCE(f.evidence->>'category_name','Sem categoria') || ' somou R$ '
        || to_char(COALESCE(f.current_value,0), 'FM999G999G990D00') || ' no período, contra R$ '
        || to_char(COALESCE(f.comparison_value,0), 'FM999G999G990D00') || ' antes.',
      jsonb_build_array(f.id), f.evidence,
      jsonb_build_object('label','Ver categorias','route','/app/relatorios'),
      'facts', f.period_start, f.period_end, f.valid_until, f.confidence,
      'fact:category_driver:' || COALESCE(f.category_id::text,'none') || ':' || f.period_start, _created_by)
    ON CONFLICT (user_id, dedup_key) DO UPDATE
      SET title=EXCLUDED.title, explanation=EXCLUDED.explanation, facts=EXCLUDED.facts,
          evidence=EXCLUDED.evidence, valid_until=EXCLUDED.valid_until, status='active',
          superseded_at=NULL, updated_at=now();
    v_n := v_n + 1;
  END LOOP;

  -- 2.3 qualidade de dados
  SELECT * INTO f FROM public.financial_insight_facts
   WHERE user_id=_user_id AND fact_type='data_quality' AND metric_key='uncategorized_expenses'
   ORDER BY as_of DESC LIMIT 1;
  IF f.id IS NOT NULL AND COALESCE(f.current_value,0) >= 1 THEN
    INSERT INTO public.nino_intelligence_items
      (user_id, kind, temporal_role, status, priority, severity, title, summary, explanation,
       facts, evidence, primary_action, source, source_period_start, source_period_end,
       valid_until, confidence, data_quality, dedup_key, created_by)
    VALUES (_user_id, 'data_quality', 'now', 'active', 40, 'info',
      f.current_value::int || CASE WHEN f.current_value::int = 1 THEN ' lançamento sem categoria' ELSE ' lançamentos sem categoria' END,
      'Classificar melhora todas as leituras seguintes.',
      'Somam R$ ' || to_char(COALESCE((f.evidence->>'total_amount')::numeric,0), 'FM999G999G990D00')
        || ' no período. Comece pelos maiores.',
      jsonb_build_array(f.id), f.evidence,
      jsonb_build_object('label','Organizar agora','route','/app/lancamentos'),
      'facts', f.period_start, f.period_end, f.valid_until, 1, 'attention',
      'fact:data_quality:uncategorized:' || f.period_start, _created_by)
    ON CONFLICT (user_id, dedup_key) DO UPDATE
      SET title=EXCLUDED.title, explanation=EXCLUDED.explanation, facts=EXCLUDED.facts,
          evidence=EXCLUDED.evidence, valid_until=EXCLUDED.valid_until, status='active',
          superseded_at=NULL, updated_at=now();
    v_n := v_n + 1;
  END IF;

  -- 2.4 adaptador: padrões comportamentais
  FOR r IN
    SELECT * FROM public.behavioral_patterns
     WHERE user_id=_user_id AND status IN ('candidate','validated','active','weakened')
     ORDER BY confidence DESC LIMIT 8
  LOOP
    INSERT INTO public.nino_intelligence_items
      (user_id, kind, temporal_role, status, priority, severity, title, summary, explanation,
       evidence, primary_action, source, pattern_id, valid_until, confidence, dedup_key, created_by)
    VALUES (_user_id, 'pattern', 'historical', 'active',
      CASE r.status WHEN 'validated' THEN 52 WHEN 'active' THEN 50 ELSE 35 END,
      'info', r.label,
      CASE r.status
        WHEN 'candidate' THEN 'Aprendendo'
        WHEN 'validated' THEN 'Confirmado'
        WHEN 'active' THEN 'Confirmado'
        WHEN 'weakened' THEN 'Em observação'
        ELSE 'Em observação' END,
      CASE r.status
        WHEN 'candidate' THEN 'Esse comportamento já apareceu algumas vezes, mas o Nino ainda está confirmando.'
        WHEN 'weakened' THEN 'Esse comportamento está perdendo força nos dados mais recentes.'
        ELSE 'Esse comportamento já se repetiu o suficiente para o Nino considerar confirmado.' END,
      jsonb_build_object(
        'maturity', CASE r.status WHEN 'candidate' THEN 'learning' WHEN 'weakened' THEN 'observing' ELSE 'confirmed' END,
        'plain_language_reason', r.label,
        'next_validation_condition', CASE WHEN r.status='candidate'
          THEN 'O Nino confirma quando o padrão se repetir com mais dados no mesmo sentido.'
          ELSE 'O Nino revalida a cada nova semana de dados.' END,
        'evidence_summary', jsonb_build_object(
          'baseline', r.baseline_value, 'observed', r.pattern_value,
          'delta', r.absolute_delta, 'uplift_pct', r.uplift_pct),
        'how_we_calculate', jsonb_build_object(
          'detector', r.detector, 'confidence', r.confidence, 'sample_size', r.sample_size,
          'coverage', r.data_coverage, 'formula_version', r.formula_version,
          'window', jsonb_build_object('start', r.window_start, 'end', r.window_end))),
      jsonb_build_object('label','Como calculamos','route','/app/nino'),
      'behavioral_patterns', r.id, r.expires_at, COALESCE(r.confidence,0.5),
      'pattern:' || r.id::text, _created_by)
    ON CONFLICT (user_id, dedup_key) DO UPDATE
      SET title=EXCLUDED.title, summary=EXCLUDED.summary, explanation=EXCLUDED.explanation,
          evidence=EXCLUDED.evidence, priority=EXCLUDED.priority, confidence=EXCLUDED.confidence,
          valid_until=EXCLUDED.valid_until, status='active', superseded_at=NULL, updated_at=now();
    v_n := v_n + 1;
  END LOOP;

  -- 2.5 adaptador: antecipações
  FOR r IN
    SELECT * FROM public.anticipation_opportunities
     WHERE user_id=_user_id AND status IN ('scheduled','ready','revalidating','dispatched')
     ORDER BY opportunity_date DESC LIMIT 10
  LOOP
    INSERT INTO public.nino_intelligence_items
      (user_id, kind, temporal_role, status, priority, severity, title, summary, explanation,
       evidence, primary_action, source, opportunity_id, pattern_id,
       valid_from, valid_until, confidence, dedup_key, created_by)
    VALUES (_user_id,
      CASE WHEN r.severity IN ('critical','attention') THEN 'risk'::public.nino_item_kind ELSE 'opportunity'::public.nino_item_kind END,
      CASE WHEN r.opportunity_date >= current_date THEN 'future'::public.nino_temporal_role ELSE 'historical'::public.nino_temporal_role END,
      'active',
      CASE r.severity WHEN 'critical' THEN 92 WHEN 'attention' THEN 80 ELSE 65 END,
      COALESCE(r.severity,'info'), r.title,
      'Preparação sugerida para ' || to_char(r.opportunity_date, 'DD/MM'),
      COALESCE(r.body,''),
      COALESCE(r.evidence,'{}'::jsonb) || jsonb_build_object(
        'utility_score', r.utility_score, 'detector', r.detector,
        'opportunity_date', r.opportunity_date, 'channel_target', r.channel_target,
        'dispatched_at', r.dispatched_at),
      COALESCE(r.action, jsonb_build_object('label','Ver preparação','route','/app/nino?section=prepare-se')),
      'anticipation', r.id, r.pattern_id,
      COALESCE(r.eligible_from, r.created_at), COALESCE(r.window_end, (r.opportunity_date + interval '1 day')),
      COALESCE(r.confidence,0.5), 'anticipation:' || r.id::text, _created_by)
    ON CONFLICT (user_id, dedup_key) DO UPDATE
      SET title=EXCLUDED.title, summary=EXCLUDED.summary, explanation=EXCLUDED.explanation,
          evidence=EXCLUDED.evidence, temporal_role=EXCLUDED.temporal_role,
          priority=EXCLUDED.priority, severity=EXCLUDED.severity,
          valid_until=EXCLUDED.valid_until, status='active', superseded_at=NULL, updated_at=now();
    v_n := v_n + 1;
  END LOOP;

  -- 2.6 adaptador: relatórios (fechamentos + highlights)
  FOR r IN
    SELECT fr.*, (SELECT h.title FROM public.financial_report_highlights h
                   WHERE h.report_id=fr.id ORDER BY h.priority DESC, h.sort_order LIMIT 1) top_highlight
    FROM public.financial_reports fr
    WHERE fr.user_id=_user_id AND fr.status <> 'deleted'
    ORDER BY fr.period_end DESC LIMIT 8
  LOOP
    INSERT INTO public.nino_intelligence_items
      (user_id, kind, temporal_role, status, priority, severity, title, summary, explanation,
       evidence, primary_action, source, report_id, source_period_start, source_period_end,
       valid_until, confidence, data_quality, dedup_key, created_by)
    VALUES (_user_id, 'closed_period_summary', 'closed_period', 'active', 45, 'info',
      CASE r.report_type WHEN 'weekly' THEN 'Fechamento da semana de ' ELSE 'Fechamento de ' END
        || to_char(r.period_start,'DD/MM') || ' a ' || to_char(r.period_end,'DD/MM'),
      COALESCE(r.top_highlight, 'Resumo do período fechado.'),
      COALESCE(r.executive_summary, ''),
      jsonb_build_object('health_score', r.health_score, 'report_type', r.report_type,
                         'viewed_at', r.viewed_at, 'template_version', r.template_version),
      jsonb_build_object('label','Abrir fechamento','route','/app/relatorios/' || r.id::text),
      'financial_reports', r.id, r.period_start, r.period_end,
      (r.period_end + interval '90 days'), 0.9, COALESCE(r.data_quality_status,'ok'),
      'report:' || r.id::text, _created_by)
    ON CONFLICT (user_id, dedup_key) DO UPDATE
      SET title=EXCLUDED.title, summary=EXCLUDED.summary, explanation=EXCLUDED.explanation,
          evidence=EXCLUDED.evidence, primary_action=EXCLUDED.primary_action,
          valid_until=EXCLUDED.valid_until, updated_at=now();
    v_n := v_n + 1;
  END LOOP;

  -- 2.7 adaptador: revisões do assessor -> recomendações
  FOR r IN
    SELECT ar.*, a.value action_item, a.ordinality ord
    FROM public.advisor_reviews ar
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ar.actions,'[]'::jsonb)) WITH ORDINALITY a(value, ordinality)
    WHERE ar.user_id=_user_id
    ORDER BY ar.period_start DESC LIMIT 12
  LOOP
    IF COALESCE(r.action_item->>'title', r.action_item->>'label', '') <> ''
       AND COALESCE(r.action_item->>'status','pending') NOT IN ('done','dismissed') THEN
      INSERT INTO public.nino_intelligence_items
        (user_id, kind, temporal_role, status, priority, severity, title, summary, explanation,
         evidence, primary_action, source, review_id, source_period_start, source_period_end,
         valid_until, confidence, dedup_key, created_by)
      VALUES (_user_id, 'recommendation', 'now', 'active', 58, 'info',
        COALESCE(r.action_item->>'title', r.action_item->>'label'),
        'Próximo passo do seu plano.',
        COALESCE(r.action_item->>'body', r.action_item->>'detail', ''),
        jsonb_build_object('review_period', r.period_kind, 'action', r.action_item),
        jsonb_build_object('label', COALESCE(r.action_item->>'cta_label','Ver plano'),
                           'route', COALESCE(r.action_item->>'cta_route','/app/nino')),
        'advisor_reviews', r.id, r.period_start, r.period_end,
        (r.period_end + interval '45 days'), 0.7,
        'advisor:' || r.id::text || ':' || COALESCE(r.action_item->>'key', r.ord::text), _created_by)
      ON CONFLICT (user_id, dedup_key) DO UPDATE
        SET title=EXCLUDED.title, explanation=EXCLUDED.explanation, evidence=EXCLUDED.evidence,
            valid_until=EXCLUDED.valid_until, updated_at=now();
      v_n := v_n + 1;
    END IF;
  END LOOP;

  -- 2.8 adaptador: insights ativos
  FOR r IN
    SELECT * FROM public.user_insights
     WHERE user_id=_user_id AND status='active' AND (expires_at IS NULL OR expires_at > now())
     ORDER BY COALESCE(score,0) DESC LIMIT 10
  LOOP
    INSERT INTO public.nino_intelligence_items
      (user_id, kind, temporal_role, status, priority, severity, title, summary, explanation,
       evidence, primary_action, source, insight_id, valid_from, valid_until, confidence,
       dedup_key, created_by)
    VALUES (_user_id,
      CASE WHEN r.severity IN ('critical','high') THEN 'risk'::public.nino_item_kind
           WHEN r.type ILIKE '%categor%' THEN 'data_quality'::public.nino_item_kind
           ELSE 'recommendation'::public.nino_item_kind END,
      'now', 'active', LEAST(90, 45 + COALESCE(r.score,0)::int), COALESCE(r.severity,'info'),
      r.title, 'Leitura do Nino sobre agora.', COALESCE(r.body,''),
      COALESCE(r.evidence,'{}'::jsonb),
      jsonb_build_object('label', COALESCE(r.cta_label,'Ver detalhes'), 'route', COALESCE(r.cta_route,'/app/nino')),
      'user_insights', r.id, COALESCE(r.generated_at, r.created_at), r.expires_at,
      0.7, 'insight:' || r.id::text, _created_by)
    ON CONFLICT (user_id, dedup_key) DO UPDATE
      SET title=EXCLUDED.title, explanation=EXCLUDED.explanation, evidence=EXCLUDED.evidence,
          valid_until=EXCLUDED.valid_until, updated_at=now();
    v_n := v_n + 1;
  END LOOP;

  -- 2.9 adaptador: sugestões proativas pendentes
  FOR r IN
    SELECT * FROM public.pending_proactive_suggestions
     WHERE user_id=_user_id AND status IN ('pending','ready','deferred','dispatched')
       AND (expires_at IS NULL OR expires_at > now() - interval '30 days')
     ORDER BY created_at DESC LIMIT 10
  LOOP
    INSERT INTO public.nino_intelligence_items
      (user_id, kind, temporal_role, status, priority, severity, title, summary, explanation,
       evidence, primary_action, source, suggestion_id, valid_until, confidence, dedup_key, created_by)
    VALUES (_user_id,
      CASE WHEN r.severity IN ('critical','attention') THEN 'risk'::public.nino_item_kind ELSE 'recommendation'::public.nino_item_kind END,
      CASE WHEN r.status='dispatched' THEN 'historical'::public.nino_temporal_role ELSE 'now'::public.nino_temporal_role END,
      'active', CASE r.severity WHEN 'critical' THEN 88 WHEN 'attention' THEN 72 ELSE 50 END,
      COALESCE(r.severity,'info'), r.title, 'Alerta acompanhado pelo Nino.', COALESCE(r.body,''),
      COALESCE(r.evidence,'{}'::jsonb),
      COALESCE(r.action, jsonb_build_object('label','Ver alerta','route','/app/alertas/' || r.dedup_key)),
      'pending_proactive_suggestions', r.id, r.expires_at, 0.6,
      'suggestion:' || r.id::text, _created_by)
    ON CONFLICT (user_id, dedup_key) DO UPDATE
      SET title=EXCLUDED.title, explanation=EXCLUDED.explanation, evidence=EXCLUDED.evidence,
          temporal_role=EXCLUDED.temporal_role, valid_until=EXCLUDED.valid_until, updated_at=now();
    v_n := v_n + 1;
  END LOOP;

  -- 2.10 pendências reais de divisão do rolê
  FOR r IN
    SELECT p.id, p.name, p.amount_due, p.amount_paid, p.status, se.id se_id, se.title se_title
    FROM public.shared_expense_participants p
    JOIN public.shared_expenses se ON se.id = p.shared_expense_id
    WHERE se.owner_user_id = _user_id AND se.deleted_at IS NULL
      AND p.status IN ('payment_reported','awaiting_owner_confirmation')
    LIMIT 10
  LOOP
    INSERT INTO public.nino_intelligence_items
      (user_id, kind, temporal_role, status, priority, severity, title, summary, explanation,
       evidence, primary_action, source, valid_until, confidence, dedup_key, created_by)
    VALUES (_user_id, 'pending_confirmation', 'now', 'active', 85, 'attention',
      '1 pagamento aguardando sua confirmação',
      r.name || ' informou pagamento em ' || r.se_title,
      'Confirme para atualizar o valor a receber de R$ '
        || to_char(GREATEST(COALESCE(r.amount_due,0) - COALESCE(r.amount_paid,0), 0), 'FM999G999G990D00') || '.',
      jsonb_build_object('participant_id', r.id, 'shared_expense_id', r.se_id, 'status', r.status),
      jsonb_build_object('label','Ver divisão','route','/app/divisao-do-role/' || r.se_id::text),
      'split', now() + interval '30 days', 1,
      'split_confirm:' || r.id::text, _created_by)
    ON CONFLICT (user_id, dedup_key) DO UPDATE
      SET summary=EXCLUDED.summary, explanation=EXCLUDED.explanation, evidence=EXCLUDED.evidence,
          status='active', valid_until=EXCLUDED.valid_until, updated_at=now();
    v_n := v_n + 1;
  END LOOP;

  -- 2.11 expiração determinística
  UPDATE public.nino_intelligence_items
     SET status='expired', updated_at=now()
   WHERE user_id=_user_id AND status='active'
     AND valid_until IS NOT NULL AND valid_until < now();

  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.nino_rebuild_items(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nino_build_facts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nino_rebuild_items(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nino_build_facts(uuid) TO service_role;

-- ---------- 3) TICK GLOBAL ----------
CREATE OR REPLACE FUNCTION public.nino_intelligence_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u record; v_users int := 0; v_items int := 0;
BEGIN
  FOR u IN SELECT p.id FROM public.profiles p LOOP
    BEGIN
      v_items := v_items + public.nino_rebuild_items(u.id, 'engine');
      v_users := v_users + 1;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'users', v_users, 'items', v_items, 'at', now());
END $$;
GRANT EXECUTE ON FUNCTION public.nino_intelligence_tick() TO service_role;

-- ---------- 4) BACKFILL + ROLLBACK ----------
CREATE OR REPLACE FUNCTION public.nino_backfill_items(_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u record; v_users int := 0; v_items int := 0; v_before int;
BEGIN
  SELECT COUNT(*) INTO v_before FROM public.nino_intelligence_items;
  IF _dry_run THEN
    RETURN jsonb_build_object('ok', true, 'dry_run', true,
      'items_before', v_before,
      'sources', jsonb_build_object(
        'user_insights', (SELECT COUNT(*) FROM public.user_insights WHERE status='active'),
        'advisor_reviews', (SELECT COUNT(*) FROM public.advisor_reviews),
        'financial_reports', (SELECT COUNT(*) FROM public.financial_reports WHERE status <> 'deleted'),
        'behavioral_patterns', (SELECT COUNT(*) FROM public.behavioral_patterns),
        'anticipation_opportunities', (SELECT COUNT(*) FROM public.anticipation_opportunities),
        'pending_proactive_suggestions', (SELECT COUNT(*) FROM public.pending_proactive_suggestions)),
      'dispatch', false);
  END IF;
  FOR u IN SELECT p.id FROM public.profiles p LOOP
    v_items := v_items + public.nino_rebuild_items(u.id, 'backfill');
    v_users := v_users + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'dry_run', false, 'users', v_users,
    'items_written', v_items, 'items_before', v_before,
    'items_after', (SELECT COUNT(*) FROM public.nino_intelligence_items), 'dispatch', false);
END $$;
GRANT EXECUTE ON FUNCTION public.nino_backfill_items(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.nino_backfill_rollback()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  DELETE FROM public.nino_intelligence_items WHERE created_by='backfill';
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', v);
END $$;
GRANT EXECUTE ON FUNCTION public.nino_backfill_rollback() TO service_role;