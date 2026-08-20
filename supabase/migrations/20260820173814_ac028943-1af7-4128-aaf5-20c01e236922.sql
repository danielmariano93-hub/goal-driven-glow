-- 1. Histórico auditável de interações do consultor
CREATE TABLE IF NOT EXISTS public.advisor_interaction_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  topic_key TEXT NOT NULL,
  signal TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'app',
  delta NUMERIC NOT NULL DEFAULT 0,
  score_before NUMERIC,
  score_after NUMERIC,
  refs JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advisor_interaction_events_user_created_idx
  ON public.advisor_interaction_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS advisor_interaction_events_user_topic_idx
  ON public.advisor_interaction_events (user_id, topic_key, created_at DESC);

GRANT SELECT ON public.advisor_interaction_events TO authenticated;
GRANT ALL ON public.advisor_interaction_events TO service_role;
ALTER TABLE public.advisor_interaction_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "advisor_events_own_read" ON public.advisor_interaction_events;
CREATE POLICY "advisor_events_own_read" ON public.advisor_interaction_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 2. Ranking do advisor pode ficar obsoleto sem invalidar o cálculo financeiro
ALTER TABLE public.financial_performance_snapshots
  ADD COLUMN IF NOT EXISTS advisor_stale_at TIMESTAMPTZ;

-- 3. RPC v2: escreve evento + score atomicamente, com cap diário por tópico
CREATE OR REPLACE FUNCTION public.advisor_register_topic_signal_v2(
  _topic_key TEXT,
  _signal TEXT,
  _user_id UUID DEFAULT NULL,
  _source TEXT DEFAULT 'app',
  _refs JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID;
  _delta NUMERIC;
  _before NUMERIC := 0;
  _after NUMERIC := 0;
  _moved_today NUMERIC := 0;
  _room NUMERIC;
  _cap CONSTANT NUMERIC := 0.35;
BEGIN
  _uid := COALESCE(auth.uid(), _user_id);
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF auth.uid() IS NOT NULL AND _user_id IS NOT NULL AND _user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _topic_key IS NULL OR btrim(_topic_key) = '' THEN RAISE EXCEPTION 'topic_key_required'; END IF;

  _delta := CASE _signal
    WHEN 'acted' THEN 0.30
    WHEN 'explicit_positive' THEN 0.35
    WHEN 'asked_more' THEN 0.20
    WHEN 'followed_up' THEN 0.20
    WHEN 'opened' THEN 0.08
    WHEN 'ignored' THEN -0.03
    WHEN 'dismissed' THEN -0.20
    WHEN 'marked_not_useful' THEN -0.35
    WHEN 'exposed' THEN 0
    ELSE 0 END;

  SELECT COALESCE(score, 0) INTO _before
  FROM public.user_advisor_topic_affinity
  WHERE user_id = _uid AND topic_key = _topic_key;
  _before := COALESCE(_before, 0);

  -- Cap de movimento por dia/tópico: poucos eventos não levam ao extremo.
  SELECT COALESCE(SUM(ABS(delta)), 0) INTO _moved_today
  FROM public.advisor_interaction_events
  WHERE user_id = _uid AND topic_key = _topic_key AND created_at >= date_trunc('day', now());

  IF _delta <> 0 THEN
    _room := GREATEST(0, _cap - _moved_today);
    IF ABS(_delta) > _room THEN
      _delta := sign(_delta) * _room;
    END IF;
  END IF;

  IF _delta <> 0 THEN
    INSERT INTO public.user_advisor_topic_affinity (user_id, topic_key, score, signals, last_signal, last_seen_at)
    VALUES (_uid, _topic_key, GREATEST(-1, LEAST(1, _delta)), 1, _signal, CURRENT_DATE)
    ON CONFLICT (user_id, topic_key) DO UPDATE
      SET score = GREATEST(-1, LEAST(1, public.user_advisor_topic_affinity.score + _delta)),
          signals = public.user_advisor_topic_affinity.signals + 1,
          last_signal = _signal,
          last_seen_at = CURRENT_DATE,
          updated_at = now()
    RETURNING score INTO _after;

    -- Afinidade mudou: só o RANKING do advisor fica obsoleto.
    UPDATE public.financial_performance_snapshots
      SET advisor_stale_at = now()
    WHERE user_id = _uid AND invalidated_at IS NULL AND advisor_stale_at IS NULL;
  ELSE
    _after := _before;
  END IF;

  INSERT INTO public.advisor_interaction_events
    (user_id, topic_key, signal, source, delta, score_before, score_after, refs)
  VALUES (_uid, _topic_key, _signal, COALESCE(_source, 'app'), _delta, _before, _after, COALESCE(_refs, '{}'::jsonb));

  RETURN jsonb_build_object(
    'topic_key', _topic_key, 'signal', _signal, 'delta', _delta,
    'score_before', _before, 'score_after', _after
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.advisor_register_topic_signal_v2(TEXT, TEXT, UUID, TEXT, JSONB) TO authenticated, service_role;

-- RPC antiga passa a delegar (uma verdade só)
CREATE OR REPLACE FUNCTION public.advisor_register_topic_signal(_topic_key TEXT, _signal TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.advisor_register_topic_signal_v2(_topic_key, _signal, NULL, 'app', '{}'::jsonb);
END;
$function$;

-- 4. Invalidação canônica da verdade financeira (server-side, uma porta só)
CREATE OR REPLACE FUNCTION public.financial_truth_changed(
  _user_id UUID,
  _reason TEXT DEFAULT 'unknown',
  _domains TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;

  UPDATE public.financial_performance_snapshots
    SET invalidated_at = now(),
        payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
          'invalidation_reason', _reason,
          'invalidation_domains', to_jsonb(COALESCE(_domains, ARRAY[]::TEXT[]))
        )
  WHERE user_id = _user_id AND invalidated_at IS NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.financial_truth_changed(UUID, TEXT, TEXT[]) TO authenticated, service_role;

-- 5. Trigger genérico: qualquer escrita financeira invalida a mesma verdade
CREATE OR REPLACE FUNCTION public.tg_financial_truth_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _uid := (to_jsonb(OLD) ->> 'user_id')::UUID;
  ELSE
    _uid := (to_jsonb(NEW) ->> 'user_id')::UUID;
  END IF;
  PERFORM public.financial_truth_changed(_uid, TG_TABLE_NAME || ':' || lower(TG_OP), ARRAY[TG_TABLE_NAME]);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'transactions','credit_card_payments','credit_card_statements','credit_card_purchases',
    'credit_card_installments','debts','debt_payments','goals','goal_contributions',
    'recurring_entries','recurring_occurrences','investments','investment_movements','document_imports'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_financial_truth_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_financial_truth_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.tg_financial_truth_changed()',
      t
    );
  END LOOP;
END $$;

-- 6. Observabilidade: eventos e preferências aprendidas no admin
CREATE OR REPLACE FUNCTION public.admin_v2_advisor_observability(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _snapshot JSONB;
  _affinity JSONB;
  _events JSONB;
  _preference JSONB;
BEGIN
  PERFORM public._require_perm('clients.read');

  SELECT to_jsonb(s) INTO _snapshot
  FROM public.financial_performance_snapshots s
  WHERE s.user_id = _user_id AND s.invalidated_at IS NULL
  ORDER BY s.as_of DESC, s.created_at DESC
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.score DESC), '[]'::jsonb) INTO _affinity
  FROM public.user_advisor_topic_affinity a
  WHERE a.user_id = _user_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC), '[]'::jsonb) INTO _events
  FROM (
    SELECT topic_key, signal, source, delta, score_before, score_after, refs, created_at
    FROM public.advisor_interaction_events
    WHERE user_id = _user_id
    ORDER BY created_at DESC
    LIMIT 40
  ) e;

  SELECT to_jsonb(m) INTO _preference
  FROM (
    SELECT key AS mode, value, confidence, use_count, updated_at
    FROM public.agent_memory
    WHERE user_id = _user_id AND kind = 'advisor_preference'
    ORDER BY updated_at DESC
    LIMIT 1
  ) m;

  RETURN jsonb_build_object(
    'user_id', _user_id,
    'snapshot', _snapshot,
    'affinity', _affinity,
    'events', _events,
    'preferred_comparison', _preference,
    'generated_at', now()
  );
END;
$function$;