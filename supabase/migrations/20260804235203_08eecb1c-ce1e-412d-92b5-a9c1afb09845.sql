-- 1) Conversão de textos com formatação americana -> pt-BR
CREATE OR REPLACE FUNCTION public.nino_fix_money_text(_t text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v_out text := _t; v_prev text;
BEGIN
  IF v_out IS NULL THEN RETURN NULL; END IF;
  -- marca o separador decimal americano (ponto seguido de exatamente 2 dígitos)
  v_out := regexp_replace(v_out, '(\d)\.(\d{2})(\D|$)', '\1#D#\2\3', 'g');
  -- vírgulas de milhar -> ponto
  LOOP
    v_prev := v_out;
    v_out := regexp_replace(v_out, '(\d),(\d{3})', '\1.\2', 'g');
    EXIT WHEN v_out = v_prev;
  END LOOP;
  RETURN replace(v_out, '#D#', ',');
END $$;

REVOKE ALL ON FUNCTION public.nino_fix_money_text(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nino_fix_money_text(text) TO service_role;

-- 2) Curadoria determinística das leituras
CREATE OR REPLACE FUNCTION public.nino_curate_items(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_expired int; v_archived int; v_superseded int; v_contradictory int; v_fixed int;
BEGIN
  -- 2.1 vencidos
  UPDATE public.nino_intelligence_items
     SET status='expired', updated_at=now()
   WHERE user_id=_user_id AND status='active'
     AND valid_until IS NOT NULL AND valid_until < now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- 2.2 movimentos não comparáveis não geram recomendação/risco de corte
  UPDATE public.nino_intelligence_items
     SET status='archived', updated_at=now()
   WHERE user_id=_user_id AND status='active'
     AND kind IN ('recommendation','opportunity')
     AND lower(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(explanation,'')) ~
         '(estorno|reembolso|transfer[eê]ncia|pagamento de fatura|pagamento da fatura|pagamento de d[ií]vida|amortiza)';
  GET DIAGNOSTICS v_archived = ROW_COUNT;

  -- 2.3 padrões com título contraditório à direção real do efeito
  UPDATE public.nino_intelligence_items i
     SET status='archived', updated_at=now()
   WHERE i.user_id=_user_id AND i.status='active' AND i.kind='pattern'
     AND lower(coalesce(i.title,'')) ~ '(maior|aumento|mais alto|sobe|cresce)'
     AND COALESCE((i.evidence->'evidence_summary'->>'delta')::numeric,
                  (i.evidence->'evidence_summary'->>'uplift_pct')::numeric, 0) < 0;
  GET DIAGNOSTICS v_contradictory = ROW_COUNT;

  -- 2.4 deduplicação semântica: mesmo tipo + mesmo título normalizado -> mantém o mais recente
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY kind, lower(regexp_replace(coalesce(title,''), '[^a-zà-ú0-9]+', '', 'g'))
             ORDER BY priority DESC, updated_at DESC, created_at DESC) rn
      FROM public.nino_intelligence_items
     WHERE user_id=_user_id AND status='active'
  )
  UPDATE public.nino_intelligence_items i
     SET status='superseded', superseded_at=now(), updated_at=now()
    FROM ranked r
   WHERE i.id=r.id AND r.rn > 1;
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  -- 2.5 formatação monetária pt-BR em itens já gravados
  UPDATE public.nino_intelligence_items
     SET title = public.nino_fix_money_text(title),
         summary = public.nino_fix_money_text(summary),
         explanation = public.nino_fix_money_text(explanation)
   WHERE user_id=_user_id
     AND (title ~ '\d\.\d{2}(\D|$)' OR summary ~ '\d\.\d{2}(\D|$)' OR explanation ~ '\d\.\d{2}(\D|$)'
          OR title ~ '\d,\d{3}' OR summary ~ '\d,\d{3}' OR explanation ~ '\d,\d{3}');
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true, 'expired', v_expired, 'archived', v_archived + v_contradictory,
    'superseded', v_superseded, 'reformatted', v_fixed);
END $$;

REVOKE ALL ON FUNCTION public.nino_curate_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nino_curate_items(uuid) TO service_role;

-- 3) nino_rebuild_items passa a curar ao final
DO $do$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='nino_rebuild_items';
  IF v_def IS NOT NULL AND position('nino_curate_items' in v_def) = 0 THEN
    v_def := regexp_replace(v_def, E'\\n  RETURN v_n;', E'\n  PERFORM public.nino_curate_items(_user_id);\n  RETURN v_n;');
    EXECUTE v_def;
  END IF;
END $do$;

-- 4) my_nino_refresh com contrato rico (contagens + horário canônico)
CREATE OR REPLACE FUNCTION public.my_nino_refresh()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_started timestamptz := now();
  v_items int;
  v_created int; v_updated int; v_superseded int; v_expired int; v_active int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;

  v_items := public.nino_rebuild_items(v_uid, 'manual');

  SELECT
    count(*) FILTER (WHERE created_at >= v_started),
    count(*) FILTER (WHERE created_at < v_started AND updated_at >= v_started AND status='active'),
    count(*) FILTER (WHERE updated_at >= v_started AND status='superseded'),
    count(*) FILTER (WHERE updated_at >= v_started AND status IN ('expired','archived')),
    count(*) FILTER (WHERE status='active')
    INTO v_created, v_updated, v_superseded, v_expired, v_active
    FROM public.nino_intelligence_items WHERE user_id=v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'at', now(),
    'items', v_items,
    'counts', jsonb_build_object(
      'created', COALESCE(v_created,0),
      'updated', COALESCE(v_updated,0),
      'superseded', COALESCE(v_superseded,0),
      'expired', COALESCE(v_expired,0),
      'active_total', COALESCE(v_active,0)));
END $$;

REVOKE ALL ON FUNCTION public.my_nino_refresh() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_nino_refresh() TO authenticated;