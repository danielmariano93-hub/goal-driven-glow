
-- =========================================================
-- 1. USER_INSIGHTS — dicas geradas por IA para o usuário
-- =========================================================
CREATE TABLE IF NOT EXISTS public.user_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('habit','alert','celebration','onboarding','opportunity')),
  title text NOT NULL,
  body text NOT NULL,
  cta_label text,
  cta_route text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text,
  prompt_version text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','dismissed','expired')),
  feedback text CHECK (feedback IN ('useful','not_useful')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_insights_user_status_idx
  ON public.user_insights (user_id, status, expires_at DESC);

GRANT SELECT, UPDATE ON public.user_insights TO authenticated;
GRANT ALL ON public.user_insights TO service_role;

ALTER TABLE public.user_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_insights select own" ON public.user_insights;
CREATE POLICY "user_insights select own" ON public.user_insights
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_insights update own" ON public.user_insights;
CREATE POLICY "user_insights update own" ON public.user_insights
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND status IN ('active','dismissed'));

-- =========================================================
-- 2. SHARED_EXPENSE_PARTICIPANTS — cobranças que acompanham a pessoa
-- =========================================================
ALTER TABLE public.shared_expense_participants
  ADD COLUMN IF NOT EXISTS linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invite_token_hash text,
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_status text NOT NULL DEFAULT 'none'
    CHECK (invite_status IN ('none','pending','claimed','revoked')),
  ADD COLUMN IF NOT EXISTS dispute_status text NOT NULL DEFAULT 'none'
    CHECK (dispute_status IN ('none','reported_paid','disputed'));

CREATE INDEX IF NOT EXISTS sep_phone_e164_idx
  ON public.shared_expense_participants (phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE INDEX IF NOT EXISTS sep_linked_user_idx
  ON public.shared_expense_participants (linked_user_id)
  WHERE linked_user_id IS NOT NULL;

-- RLS: participante vinculado pode ler a própria linha
DROP POLICY IF EXISTS "sep participant reads own" ON public.shared_expense_participants;
CREATE POLICY "sep participant reads own" ON public.shared_expense_participants
  FOR SELECT TO authenticated
  USING (linked_user_id = auth.uid());

-- =========================================================
-- 3. VIEW pública para o destinatário — my_shared_charges
-- =========================================================
CREATE OR REPLACE VIEW public.my_shared_charges
WITH (security_invoker = true) AS
SELECT
  p.id AS participant_id,
  p.shared_expense_id,
  se.title,
  se.occurred_at,
  se.due_date,
  se.pix_key,
  se.reminder_enabled,
  p.amount_due,
  p.amount_paid,
  p.status,
  p.dispute_status,
  se.owner_user_id,
  coalesce(pr.display_name, 'Alguém') AS owner_display_name,
  p.created_at
FROM public.shared_expense_participants p
JOIN public.shared_expenses se ON se.id = p.shared_expense_id
LEFT JOIN public.profiles pr ON pr.id = se.owner_user_id
WHERE p.linked_user_id = auth.uid();

GRANT SELECT ON public.my_shared_charges TO authenticated;

-- =========================================================
-- 4. RPC: split_participant_report (destinatário reporta pago/contesta)
-- =========================================================
CREATE OR REPLACE FUNCTION public.split_participant_report(
  p_participant_id uuid,
  p_action text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  se_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_action NOT IN ('reported_paid','disputed','clear') THEN
    RAISE EXCEPTION 'invalid action';
  END IF;

  UPDATE public.shared_expense_participants
     SET dispute_status = CASE WHEN p_action = 'clear' THEN 'none' ELSE p_action END,
         updated_at = now()
   WHERE id = p_participant_id
     AND linked_user_id = uid
  RETURNING shared_expense_id INTO se_id;

  IF se_id IS NULL THEN RAISE EXCEPTION 'not authorized'; END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
    SELECT se_id, se.owner_user_id, 'participant_' || p_action,
           jsonb_build_object('participant_id', p_participant_id, 'by', uid)
      FROM public.shared_expenses se WHERE se.id = se_id;
END $$;

REVOKE ALL ON FUNCTION public.split_participant_report(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_participant_report(uuid, text) TO authenticated;

-- =========================================================
-- 5. RPC: split_claim_pending — reivindica participações pendentes
--    para o usuário atual usando telefone verificado
-- =========================================================
CREATE OR REPLACE FUNCTION public.split_claim_pending()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  v_phone text;
  n integer := 0;
BEGIN
  IF uid IS NULL THEN RETURN 0; END IF;

  SELECT phone_e164 INTO v_phone
    FROM public.whatsapp_links
   WHERE user_id = uid AND last_verified_at IS NOT NULL AND status = 'active'
   ORDER BY last_verified_at DESC LIMIT 1;

  IF v_phone IS NULL THEN RETURN 0; END IF;

  UPDATE public.shared_expense_participants
     SET linked_user_id = uid,
         invite_status = 'claimed',
         updated_at = now()
   WHERE phone_e164 = v_phone
     AND linked_user_id IS NULL
     AND invite_status IN ('none','pending');

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.split_claim_pending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_claim_pending() TO authenticated;

-- Internal function invoked by trigger (definer, runs as owner)
CREATE OR REPLACE FUNCTION public._split_claim_for_user(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text;
  n integer := 0;
BEGIN
  SELECT phone_e164 INTO v_phone
    FROM public.whatsapp_links
   WHERE user_id = p_user_id AND last_verified_at IS NOT NULL AND status = 'active'
   ORDER BY last_verified_at DESC LIMIT 1;

  IF v_phone IS NULL THEN RETURN 0; END IF;

  UPDATE public.shared_expense_participants
     SET linked_user_id = p_user_id,
         invite_status = 'claimed',
         updated_at = now()
   WHERE phone_e164 = v_phone
     AND linked_user_id IS NULL
     AND invite_status IN ('none','pending');

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public._split_claim_for_user(uuid) FROM PUBLIC, anon, authenticated;

-- =========================================================
-- 6. Trigger: quando telefone é verificado, reivindica pendências
-- =========================================================
CREATE OR REPLACE FUNCTION public.trg_whatsapp_verified_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.last_verified_at IS NOT NULL
     AND (OLD.last_verified_at IS DISTINCT FROM NEW.last_verified_at
          OR OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.status = 'active' THEN
    PERFORM public._split_claim_for_user(NEW.user_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_whatsapp_verified_claim ON public.whatsapp_links;
CREATE TRIGGER trg_whatsapp_verified_claim
  AFTER INSERT OR UPDATE OF last_verified_at, status ON public.whatsapp_links
  FOR EACH ROW EXECUTE FUNCTION public.trg_whatsapp_verified_claim();

-- =========================================================
-- 7. Updated_at trigger for user_insights
-- =========================================================
CREATE OR REPLACE FUNCTION public._touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS user_insights_touch ON public.user_insights;
CREATE TRIGGER user_insights_touch
  BEFORE UPDATE ON public.user_insights
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
