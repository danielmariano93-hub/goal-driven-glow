-- "Isso representa minha realidade?" ganha três respostas: sim, parcialmente, não.
-- 'no' e 'partially' tratam a leitura como incerta (30 dias); 'yes' só confirma e NÃO vira contexto de incerteza.
ALTER TABLE public.behavior_observed_feedback
  ADD COLUMN IF NOT EXISTS verdict text NOT NULL DEFAULT 'no' CHECK (verdict IN ('yes', 'partially', 'no'));

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

  IF NEW.verdict = 'yes' THEN
    DELETE FROM public.agent_memory
     WHERE user_id = NEW.user_id AND kind = 'narrative_context' AND key = 'habit:' || NEW.dimension;
    RETURN NEW;
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
    jsonb_build_object('statement', 'A pessoa ' || CASE WHEN NEW.verdict = 'partially' THEN 'disse que a leitura representa só em parte' ELSE 'contestou' END || ' a nota observada de ' || _label || ': ' || _reason || '. Trate essa leitura como incerta e não afirme conclusões sobre essa dimensão.'),
    0.9, 'correction', (NEW.week_start + 30)::timestamptz, now()
  )
  ON CONFLICT (user_id, kind, key) DO UPDATE
    SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, source = EXCLUDED.source,
        expires_at = EXCLUDED.expires_at, last_used_at = EXCLUDED.last_used_at;
  RETURN NEW;
END;
$$;
