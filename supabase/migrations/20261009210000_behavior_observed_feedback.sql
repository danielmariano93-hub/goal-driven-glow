-- "Isso não representa minha realidade" (behavior_observed_feedback.v1).
-- A pessoa contesta a nota que o Nino observa numa dimensão. A nota NÃO muda (senão
-- vira gaming); o contestamento é registrado, vale 30 dias, tira essa dimensão das
-- descobertas e do veredito, e entra no contexto do Nino como incerteza declarada.
CREATE TABLE IF NOT EXISTS public.behavior_observed_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dimension text NOT NULL CHECK (dimension IN ('awareness', 'planning', 'control', 'consistency', 'security', 'wealth', 'calm', 'debt')),
  -- Semana da leitura contestada e a nota/confiança que a pessoa viu.
  week_start date NOT NULL,
  observed_score numeric(4, 1) CHECK (observed_score IS NULL OR (observed_score >= 0 AND observed_score <= 10)),
  observed_confidence text CHECK (observed_confidence IS NULL OR observed_confidence IN ('low', 'medium', 'high')),
  reason text NOT NULL CHECK (reason IN ('missing_data', 'temporary_phase', 'different_routine', 'other')),
  note text CHECK (note IS NULL OR char_length(note) <= 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Um contestamento vivo por dimensão: contestar de novo substitui o anterior.
  UNIQUE (user_id, dimension)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.behavior_observed_feedback TO authenticated;
GRANT ALL ON public.behavior_observed_feedback TO service_role;
ALTER TABLE public.behavior_observed_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "behavior_observed_feedback_own_select" ON public.behavior_observed_feedback
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "behavior_observed_feedback_own_insert" ON public.behavior_observed_feedback
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "behavior_observed_feedback_own_update" ON public.behavior_observed_feedback
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "behavior_observed_feedback_own_delete" ON public.behavior_observed_feedback
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER behavior_observed_feedback_touch BEFORE UPDATE ON public.behavior_observed_feedback
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- Contexto do Nino: só texto de modelo (nunca a nota livre da pessoa), com validade de 30 dias.
CREATE OR REPLACE FUNCTION public.behavior_feedback_to_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _label text;
  _reason text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.agent_memory
     WHERE user_id = OLD.user_id AND kind = 'narrative_context' AND key = 'habit:' || OLD.dimension;
    RETURN OLD;
  END IF;

  _label := CASE NEW.dimension
    WHEN 'awareness' THEN 'Consciência'
    WHEN 'planning' THEN 'Planejamento'
    WHEN 'control' THEN 'Controle de impulso'
    WHEN 'consistency' THEN 'Consistência'
    WHEN 'security' THEN 'Segurança'
    WHEN 'wealth' THEN 'Construção de patrimônio'
    WHEN 'calm' THEN 'Tranquilidade com dinheiro'
    ELSE 'Relação com dívidas'
  END;
  _reason := CASE NEW.reason
    WHEN 'missing_data' THEN 'faltam lançamentos ou dados que o Nino não enxerga'
    WHEN 'temporary_phase' THEN 'é uma fase atípica e temporária'
    WHEN 'different_routine' THEN 'a rotina da pessoa é diferente do que a nota assume'
    ELSE 'outro motivo'
  END;

  INSERT INTO public.agent_memory (user_id, kind, key, value, confidence, source, expires_at, last_used_at)
  VALUES (
    NEW.user_id, 'narrative_context', 'habit:' || NEW.dimension,
    jsonb_build_object('statement', 'A pessoa contestou a nota observada de ' || _label || ': ' || _reason || '. Trate essa leitura como incerta e não afirme conclusões sobre essa dimensão.'),
    0.9, 'correction', now() + interval '30 days', now()
  )
  ON CONFLICT (user_id, kind, key) DO UPDATE
    SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, source = EXCLUDED.source,
        expires_at = EXCLUDED.expires_at, last_used_at = EXCLUDED.last_used_at;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.behavior_feedback_to_context() FROM PUBLIC;

CREATE TRIGGER behavior_observed_feedback_context
  AFTER INSERT OR UPDATE OR DELETE ON public.behavior_observed_feedback
  FOR EACH ROW EXECUTE FUNCTION public.behavior_feedback_to_context();
