-- Phone E.164 hardening (idempotente, aditivo, sem perda de dados financeiros).

CREATE OR REPLACE FUNCTION public.normalize_br_phone(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  d text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(raw, '\D+', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  IF left(d, 2) = '00' THEN d := substr(d, 3); END IF;
  IF left(d, 2) = '55' AND length(d) >= 12 THEN d := substr(d, 3); END IF;
  d := regexp_replace(d, '^0+', '');
  IF length(d) < 10 OR length(d) > 11 THEN RETURN NULL; END IF;
  IF length(d) = 10 AND substr(d, 3, 1) ~ '^[6-9]$' THEN
    d := substr(d, 1, 2) || '9' || substr(d, 3);
  END IF;
  IF length(d) NOT IN (10, 11) THEN RETURN NULL; END IF;
  RETURN '+55' || d;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_br_phone(text) FROM public;
GRANT EXECUTE ON FUNCTION public.normalize_br_phone(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_normalize_phone_e164()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  norm text;
BEGIN
  IF NEW.phone_e164 IS NOT NULL AND NEW.phone_e164 <> '' THEN
    norm := public.normalize_br_phone(NEW.phone_e164);
    IF norm IS NOT NULL THEN
      NEW.phone_e164 := norm;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_phone_split_participants ON public.shared_expense_participants;
CREATE TRIGGER trg_normalize_phone_split_participants
BEFORE INSERT OR UPDATE OF phone_e164 ON public.shared_expense_participants
FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_e164();

DROP TRIGGER IF EXISTS trg_normalize_phone_conversations ON public.conversations;
CREATE TRIGGER trg_normalize_phone_conversations
BEFORE INSERT OR UPDATE OF phone_e164 ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.tg_normalize_phone_e164();

-- Corrige dados corrompidos: tenta reconstruir; se não recupera, nulifica phone (mantém tudo o mais).
DO $$
DECLARE
  r record;
  norm text;
BEGIN
  FOR r IN
    SELECT id, phone_e164
      FROM public.shared_expense_participants
     WHERE phone_e164 IS NOT NULL
       AND phone_e164 !~ '^\+55[1-9][0-9]{9,10}$'
  LOOP
    norm := public.normalize_br_phone(r.phone_e164);
    IF norm IS NOT NULL THEN
      UPDATE public.shared_expense_participants SET phone_e164 = norm WHERE id = r.id;
    ELSE
      UPDATE public.shared_expense_participants
         SET phone_e164 = NULL,
             phone_masked = NULL
       WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- CHECK regex — adiciona apenas se ainda não existir.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_split_participants_phone_e164'
       AND conrelid = 'public.shared_expense_participants'::regclass
  ) THEN
    ALTER TABLE public.shared_expense_participants
      ADD CONSTRAINT chk_split_participants_phone_e164
      CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+55[1-9][0-9]{9,10}$') NOT VALID;
  END IF;
END $$;

ALTER TABLE public.shared_expense_participants
  VALIDATE CONSTRAINT chk_split_participants_phone_e164;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_conversations_phone_e164'
       AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT chk_conversations_phone_e164
      CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+55[1-9][0-9]{9,10}$') NOT VALID;
  END IF;
END $$;
