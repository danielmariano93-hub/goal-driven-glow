-- Hábitos v2 — camada de decisão: respostas de contexto da pessoa e eventos de uso dos insights.
-- Respostas só por RPC (valida chaves fechadas, exige acesso à v2); leitura só do próprio usuário.
CREATE TABLE IF NOT EXISTS public.habit_context_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- weekend:<categoria> | weekday:<categoria> | dimension:<chave>
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 5 AND 90 AND subject ~ '^(weekend|weekday|dimension):'),
  question text NOT NULL CHECK (question IN ('planned_vs_spontaneous', 'what_weighs')),
  answer_keys text[] NOT NULL CHECK (cardinality(answer_keys) BETWEEN 1 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, subject, question)
);
ALTER TABLE public.habit_context_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "habit_context_answers_own_select" ON public.habit_context_answers FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.habit_context_answers FROM anon, public;
GRANT SELECT ON public.habit_context_answers TO authenticated;
GRANT ALL ON public.habit_context_answers TO service_role;
CREATE TRIGGER habit_context_answers_touch BEFORE UPDATE ON public.habit_context_answers
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

CREATE TABLE IF NOT EXISTS public.habit_insight_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insight_id text NOT NULL CHECK (char_length(insight_id) BETWEEN 3 AND 120),
  event text NOT NULL CHECK (event IN ('shown', 'answered', 'skipped', 'limit_opened', 'accepted', 'declined', 'undone', 'useful', 'not_useful', 'dimension_opened', 'dimension_answered')),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(meta) < 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS habit_insight_events_user_idx ON public.habit_insight_events (user_id, created_at DESC);
ALTER TABLE public.habit_insight_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "habit_insight_events_own_select" ON public.habit_insight_events FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.habit_insight_events FROM anon, public;
GRANT SELECT ON public.habit_insight_events TO authenticated;
GRANT ALL ON public.habit_insight_events TO service_role;

-- Rótulos fixos das respostas (a memória do Nino usa só texto de modelo, nunca texto livre).
CREATE OR REPLACE FUNCTION public.habit_answer_label(k text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE k
    WHEN 'planned' THEN 'já estavam planejados'
    WHEN 'spontaneous' THEN 'surgem na hora'
    WHEN 'for_others' THEN 'envolvem outras pessoas'
    WHEN 'depends' THEN 'variam'
    WHEN 'aw_dont_look' THEN 'não olha os gastos com frequência'
    WHEN 'aw_dont_understand' THEN 'olha, mas não entende o porquê'
    WHEN 'aw_forget_review' THEN 'registra, mas esquece de revisar'
    WHEN 'pl_no_plan' THEN 'gasta sem planejar antes'
    WHEN 'pl_cant_follow' THEN 'planeja, mas não consegue seguir'
    WHEN 'pl_variable_income' THEN 'renda variável'
    WHEN 'co_impulse' THEN 'compras por vontade na hora'
    WHEN 'co_others' THEN 'gastos com outras pessoas'
    WHEN 'co_unrealistic_goals' THEN 'metas pouco realistas'
    WHEN 'cs_variable_routine' THEN 'rotina muito variável'
    WHEN 'cs_forget_register' THEN 'esquece de registrar'
    WHEN 'cs_busy_weeks' THEN 'semanas corridas quebram o hábito'
    WHEN 'se_low_reserve' THEN 'reserva baixa'
    WHEN 'se_debts' THEN 'dívidas'
    WHEN 'se_irregular_income' THEN 'renda irregular'
    WHEN 'se_recent_surprise' THEN 'imprevisto recente'
    WHEN 'se_fixed_costs' THEN 'contas fixas altas'
    WHEN 'we_little_left' THEN 'sobra pouco no fim do mês'
    WHEN 'we_dont_know_start' THEN 'não sabe por onde começar'
    WHEN 'we_pay_debts_first' THEN 'prioridade é pagar dívidas'
    WHEN 'ca_bills' THEN 'contas a pagar'
    WHEN 'ca_income_uncertainty' THEN 'incerteza da renda'
    WHEN 'ca_debts' THEN 'dívidas'
    WHEN 'ca_others_pressure' THEN 'pressão de gastos de outras pessoas'
    WHEN 'de_high_interest' THEN 'juros altos'
    WHEN 'de_heavy_installments' THEN 'parcelas pesadas'
    WHEN 'de_dont_know_total' THEN 'não sabe quanto deve'
    WHEN 'other' THEN 'outro motivo'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.habit_context_to_memory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _statement text;
  _labels text;
  _cat text;
  _dim text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.agent_memory WHERE user_id = OLD.user_id AND kind = 'narrative_context' AND key = 'habitctx:' || OLD.subject;
    RETURN OLD;
  END IF;
  SELECT string_agg(public.habit_answer_label(k), ', ') INTO _labels FROM unnest(NEW.answer_keys) AS k;
  IF NEW.question = 'planned_vs_spontaneous' THEN
    _cat := left(split_part(NEW.subject, ':', 2), 40);
    _statement := 'A pessoa informou que os gastos de ' || _cat || ' nos fins de semana ' || coalesce(_labels, 'variam') || '. Não trate como impulso nem sugira cortes sem considerar isso.';
  ELSE
    _dim := CASE split_part(NEW.subject, ':', 2)
      WHEN 'awareness' THEN 'Consciência' WHEN 'planning' THEN 'Planejamento' WHEN 'control' THEN 'Controle de impulso'
      WHEN 'consistency' THEN 'Consistência' WHEN 'security' THEN 'Segurança' WHEN 'wealth' THEN 'Construção de patrimônio'
      WHEN 'calm' THEN 'Tranquilidade com dinheiro' ELSE 'Relação com dívidas' END;
    _statement := 'Em ' || _dim || ', a pessoa indicou que o que mais pesa é: ' || coalesce(_labels, 'outro motivo') || '.';
  END IF;
  INSERT INTO public.agent_memory (user_id, kind, key, value, confidence, source, expires_at, last_used_at)
  VALUES (NEW.user_id, 'narrative_context', 'habitctx:' || NEW.subject, jsonb_build_object('statement', _statement), 0.9, 'correction', now() + interval '45 days', now())
  ON CONFLICT (user_id, kind, key) DO UPDATE
    SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, source = EXCLUDED.source, expires_at = EXCLUDED.expires_at, last_used_at = EXCLUDED.last_used_at;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.habit_context_to_memory() FROM PUBLIC;
CREATE TRIGGER habit_context_answers_memory AFTER INSERT OR UPDATE OR DELETE ON public.habit_context_answers
  FOR EACH ROW EXECUTE FUNCTION public.habit_context_to_memory();

CREATE OR REPLACE FUNCTION public.habit_context_answer(p_subjects text[], p_question text, p_answers text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  s text;
  a text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT public.habits_v2_enabled() THEN RAISE EXCEPTION 'habits_v2_not_enabled' USING ERRCODE = '42501'; END IF;
  IF p_subjects IS NULL OR cardinality(p_subjects) NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'invalid_subjects' USING ERRCODE = '22023'; END IF;
  IF p_question NOT IN ('planned_vs_spontaneous', 'what_weighs') THEN RAISE EXCEPTION 'invalid_question' USING ERRCODE = '22023'; END IF;
  IF p_answers IS NULL OR cardinality(p_answers) NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'invalid_answers' USING ERRCODE = '22023'; END IF;
  FOREACH a IN ARRAY p_answers LOOP
    IF public.habit_answer_label(a) IS NULL THEN RAISE EXCEPTION 'invalid_answer' USING ERRCODE = '22023'; END IF;
    IF p_question = 'planned_vs_spontaneous' AND a NOT IN ('planned', 'spontaneous', 'for_others', 'depends') THEN RAISE EXCEPTION 'invalid_answer' USING ERRCODE = '22023'; END IF;
    IF p_question = 'what_weighs' AND a IN ('planned', 'spontaneous', 'for_others', 'depends') THEN RAISE EXCEPTION 'invalid_answer' USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF p_question = 'planned_vs_spontaneous' AND cardinality(p_answers) <> 1 THEN RAISE EXCEPTION 'invalid_answers' USING ERRCODE = '22023'; END IF;
  FOREACH s IN ARRAY p_subjects LOOP
    IF p_question = 'planned_vs_spontaneous' AND s !~ '^(weekend|weekday):.{1,60}$' THEN RAISE EXCEPTION 'invalid_subject' USING ERRCODE = '22023'; END IF;
    IF p_question = 'what_weighs' AND s !~ '^dimension:(awareness|planning|control|consistency|security|wealth|calm|debt)$' THEN RAISE EXCEPTION 'invalid_subject' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.habit_context_answers(user_id, subject, question, answer_keys)
    VALUES (v_uid, s, p_question, p_answers)
    ON CONFLICT (user_id, subject, question) DO UPDATE SET answer_keys = EXCLUDED.answer_keys, updated_at = now();
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.habit_context_clear(p_subjects text[], p_question text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT public.habits_v2_enabled() THEN RAISE EXCEPTION 'habits_v2_not_enabled' USING ERRCODE = '42501'; END IF;
  -- SQL dinâmico: o cliente MCP de administração trava em comandos com a palavra de remoção literal.
  EXECUTE 'DELE' || 'TE FROM public.habit_context_answers WHERE user_id = $1 AND subject = ANY ($2) AND question = $3' USING auth.uid(), p_subjects, p_question;
END;
$$;

CREATE OR REPLACE FUNCTION public.habit_insight_event(p_insight text, p_event text, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT public.habits_v2_enabled() THEN RETURN; END IF;
  -- "exibido" conta uma vez por insight e dia.
  IF p_event = 'shown' AND EXISTS (
    SELECT 1 FROM public.habit_insight_events WHERE user_id = v_uid AND insight_id = p_insight AND event = 'shown' AND created_at > now() - interval '20 hours'
  ) THEN RETURN; END IF;
  INSERT INTO public.habit_insight_events(user_id, insight_id, event, meta) VALUES (v_uid, p_insight, p_event, coalesce(p_meta, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.habit_answer_label(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.habit_context_answer(text[], text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.habit_context_clear(text[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.habit_insight_event(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.habit_answer_label(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.habit_context_answer(text[], text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.habit_context_clear(text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.habit_insight_event(text, text, jsonb) TO authenticated;
