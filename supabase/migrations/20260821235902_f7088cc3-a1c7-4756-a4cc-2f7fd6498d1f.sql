ALTER TABLE public.emotional_checkins
  ADD COLUMN IF NOT EXISTS declared_text text,
  ADD COLUMN IF NOT EXISTS declared_emotion_key text;

COMMENT ON COLUMN public.emotional_checkins.declared_text IS 'Texto emocional declarado pela pessoa, preservado antes de qualquer normalizacao analitica.';
COMMENT ON COLUMN public.emotional_checkins.declared_emotion_key IS 'Chave da emocao declarada, que pode ser mais especifica que agrupamentos analiticos.';

CREATE TABLE public.ai_runtime_circuit (
  circuit_key text PRIMARY KEY,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paused')),
  blocked_status integer,
  requires text,
  user_message text,
  paused_at timestamptz,
  last_probe_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ai_runtime_circuit TO service_role;
ALTER TABLE public.ai_runtime_circuit ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ai_runtime_circuit (circuit_key, status)
VALUES ('lovable_ai', 'open')
ON CONFLICT (circuit_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_ai_runtime_circuit_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER touch_ai_runtime_circuit_updated_at
BEFORE UPDATE ON public.ai_runtime_circuit
FOR EACH ROW EXECUTE FUNCTION public.touch_ai_runtime_circuit_updated_at();