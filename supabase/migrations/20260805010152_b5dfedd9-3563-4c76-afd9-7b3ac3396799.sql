CREATE OR REPLACE FUNCTION public.my_nino_home_item()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_item public.nino_intelligence_items; v_as_of timestamptz; v_topic text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;

  -- Mesma régua editorial da tela do Nino: pendência real primeiro, depois
  -- inteligência por score, e só então pendências operacionais.
  SELECT * INTO v_item FROM public.nino_intelligence_items i
   WHERE i.user_id=v_uid AND i.status='active'
     AND (i.valid_until IS NULL OR i.valid_until > now())
     AND i.category IN ('intelligence','operational')
     AND i.temporal_role IN ('now','future')
   ORDER BY
     CASE WHEN i.kind = 'pending_confirmation' THEN 0
          WHEN i.category = 'intelligence' THEN 1
          ELSE 2 END,
     i.priority DESC, i.updated_at DESC
   LIMIT 1;

  IF v_item.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'kind', 'item', 'item', public.nino_item_json(v_item));
  END IF;

  SELECT MAX(as_of) INTO v_as_of FROM public.financial_insight_facts WHERE user_id=v_uid;
  SELECT continuity_topic INTO v_topic FROM public.nino_surface_state
   WHERE user_id=v_uid AND surface='nino' AND section='all';

  RETURN jsonb_build_object('ok', true, 'kind', 'stability',
    'item', jsonb_build_object(
      'id', NULL, 'kind', 'achievement', 'severity', 'info',
      'title', 'Nada urgente mudou',
      'summary', 'Sua situação segue estável.',
      'explanation', 'Seus dados foram analisados'
        || CASE WHEN v_as_of IS NULL THEN '.' ELSE ' até ' || to_char(v_as_of, 'DD/MM às HH24:MI') || '.' END
        || CASE WHEN v_topic IS NULL THEN '' ELSE ' Seu principal ponto de atenção continua sendo ' || v_topic || '.' END,
      'primary_action', jsonb_build_object('label','Abrir o Nino','route','/app/nino')));
END $$;
