
-- 1) Helper: is participant of a shared expense
CREATE OR REPLACE FUNCTION public.is_split_participant(_expense_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shared_expense_participants
    WHERE shared_expense_id = _expense_id AND linked_user_id = _user_id
  );
$$;

-- 2) Policy: participant can read parent shared_expenses
DROP POLICY IF EXISTS "participant reads shared expense" ON public.shared_expenses;
CREATE POLICY "participant reads shared expense"
ON public.shared_expenses FOR SELECT TO authenticated
USING (public.is_split_participant(id, auth.uid()));

-- 3) Auto-link participant on INSERT/UPDATE of phone_e164
CREATE OR REPLACE FUNCTION public.link_split_participant_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_expense record;
BEGIN
  IF NEW.linked_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.phone_e164 IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT wl.user_id INTO v_user
  FROM public.whatsapp_links wl
  WHERE wl.phone_e164 = NEW.phone_e164
    AND wl.status = 'active'
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  -- do not self-link owner
  IF v_user = NEW.owner_user_id THEN
    RETURN NEW;
  END IF;

  NEW.linked_user_id := v_user;
  IF NEW.invite_status = 'none' OR NEW.invite_status IS NULL THEN
    NEW.invite_status := 'claimed';
  END IF;

  -- Emit notification (best-effort, deduped)
  SELECT title, total_amount INTO v_expense
  FROM public.shared_expenses WHERE id = NEW.shared_expense_id;

  IF v_expense.title IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, action_url, dedup_key)
    VALUES (
      v_user,
      'split_participant_linked',
      'Você foi incluído em um rolê',
      v_expense.title || ' · sua parte: R$ ' || to_char(NEW.amount_due, 'FM999G999G990D00'),
      '/app/divisao-do-role/' || NEW.shared_expense_id,
      'split_linked:' || NEW.id::text
    )
    ON CONFLICT (user_id, dedup_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_split_participant_bi ON public.shared_expense_participants;
CREATE TRIGGER trg_link_split_participant_bi
BEFORE INSERT ON public.shared_expense_participants
FOR EACH ROW EXECUTE FUNCTION public.link_split_participant_on_insert();

DROP TRIGGER IF EXISTS trg_link_split_participant_bu ON public.shared_expense_participants;
CREATE TRIGGER trg_link_split_participant_bu
BEFORE UPDATE OF phone_e164 ON public.shared_expense_participants
FOR EACH ROW
WHEN (NEW.linked_user_id IS NULL AND NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164)
EXECUTE FUNCTION public.link_split_participant_on_insert();

-- 4) Backfill: existing participants that match an active whatsapp_link
WITH matched AS (
  SELECT sep.id, wl.user_id, se.title, sep.amount_due, sep.shared_expense_id
  FROM public.shared_expense_participants sep
  JOIN public.whatsapp_links wl
    ON wl.phone_e164 = sep.phone_e164 AND wl.status = 'active'
  JOIN public.shared_expenses se ON se.id = sep.shared_expense_id
  WHERE sep.linked_user_id IS NULL
    AND sep.phone_e164 IS NOT NULL
    AND wl.user_id <> sep.owner_user_id
),
updated AS (
  UPDATE public.shared_expense_participants sep
  SET linked_user_id = m.user_id,
      invite_status = CASE WHEN sep.invite_status IN ('none', '') THEN 'claimed' ELSE sep.invite_status END,
      updated_at = now()
  FROM matched m
  WHERE sep.id = m.id
  RETURNING sep.id, m.user_id, m.title, m.amount_due, m.shared_expense_id
)
INSERT INTO public.notifications (user_id, type, title, body, action_url, dedup_key)
SELECT
  u.user_id,
  'split_participant_linked',
  'Você foi incluído em um rolê',
  u.title || ' · sua parte: R$ ' || to_char(u.amount_due, 'FM999G999G990D00'),
  '/app/divisao-do-role/' || u.shared_expense_id,
  'split_linked:' || u.id::text
FROM updated u
ON CONFLICT (user_id, dedup_key) DO NOTHING;
