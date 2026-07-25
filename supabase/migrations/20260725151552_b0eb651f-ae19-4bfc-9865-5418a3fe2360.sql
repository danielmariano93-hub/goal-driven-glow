-- ============================================================
-- Onda 2 fix + Ondas 4/6/7/8 (backend)
-- ============================================================

-- ---------- Fix commit_movement idempotency column name ----------
CREATE OR REPLACE FUNCTION public.commit_movement(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text;
  v_amount numeric;
  v_date date;
  v_desc text;
  v_account uuid;
  v_card uuid;
  v_settles uuid;
  v_category uuid;
  v_method text;
  v_idem text;
  v_txn_id uuid;
  v_row public.transactions%ROWTYPE;
  v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  v_kind := payload->>'movement_kind';
  IF v_kind IS NULL OR v_kind NOT IN ('income','expense','transfer','credit_card_bill_payment','investment_movement') THEN
    RAISE EXCEPTION 'invalid_movement_kind:%', coalesce(v_kind,'null');
  END IF;

  BEGIN v_amount := (payload->>'amount')::numeric;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid_amount';
  END;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'amount_must_be_positive'; END IF;

  BEGIN v_date := (payload->>'occurred_at')::date;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid_date';
  END;
  IF v_date IS NULL THEN RAISE EXCEPTION 'occurred_at_required'; END IF;

  v_desc := nullif(payload->>'description','');
  IF v_desc IS NULL THEN RAISE EXCEPTION 'description_required'; END IF;

  BEGIN
    v_account := nullif(payload->>'account_id','')::uuid;
    v_card := nullif(payload->>'credit_card_id','')::uuid;
    v_settles := nullif(payload->>'settles_card_id','')::uuid;
    v_category := nullif(payload->>'category_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid_uuid';
  END;

  IF payload ? 'from1_account' OR payload ? 'from_account' THEN
    RAISE EXCEPTION 'unknown_property_use_account_id';
  END IF;

  v_method := coalesce(nullif(payload->>'payment_method',''), 'account');
  v_idem := nullif(payload->>'idempotency_key','');

  IF v_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id = v_account AND user_id = v_uid AND coalesce(active,true) = true
  ) THEN RAISE EXCEPTION 'account_not_found_or_inactive'; END IF;

  IF v_card IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.credit_cards WHERE id = v_card AND user_id = v_uid
  ) THEN RAISE EXCEPTION 'card_not_found'; END IF;

  IF v_settles IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.credit_cards WHERE id = v_settles AND user_id = v_uid
  ) THEN RAISE EXCEPTION 'settles_card_not_found'; END IF;

  IF v_kind = 'credit_card_bill_payment' THEN
    IF v_settles IS NULL THEN RAISE EXCEPTION 'settles_card_id_required'; END IF;
    IF v_account IS NULL THEN RAISE EXCEPTION 'account_id_required'; END IF;
    v_card := NULL;
    v_method := 'account';
  ELSIF v_kind IN ('income','expense','transfer') THEN
    IF v_account IS NULL AND v_card IS NULL THEN
      RAISE EXCEPTION 'account_id_or_card_required';
    END IF;
  END IF;

  IF v_idem IS NOT NULL THEN
    SELECT result_ref INTO v_existing
      FROM public.idempotency_keys
      WHERE user_id = v_uid AND key = v_idem AND scope = 'commit_movement'
      LIMIT 1;
    IF v_existing IS NOT NULL THEN
      SELECT * INTO v_row FROM public.transactions WHERE id = v_existing;
      IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'transaction', row_to_json(v_row));
      END IF;
    END IF;
  END IF;

  INSERT INTO public.transactions (
    user_id, type, amount, occurred_at, description,
    account_id, credit_card_id, settles_card_id, category_id,
    movement_kind, payment_method, origin, status
  ) VALUES (
    v_uid,
    CASE v_kind WHEN 'income' THEN 'income'::transaction_type
                WHEN 'transfer' THEN 'transfer'::transaction_type
                ELSE 'expense'::transaction_type END,
    v_amount, v_date, v_desc,
    v_account, v_card, v_settles, v_category,
    v_kind, v_method, 'manual'::txn_origin, 'confirmed'::transaction_status
  ) RETURNING id INTO v_txn_id;

  IF v_idem IS NOT NULL THEN
    INSERT INTO public.idempotency_keys (user_id, key, scope, result_ref)
    VALUES (v_uid, v_idem, 'commit_movement', v_txn_id)
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT * INTO v_row FROM public.transactions WHERE id = v_txn_id;
  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false, 'transaction', row_to_json(v_row));
END $$;

REVOKE ALL ON FUNCTION public.commit_movement(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_movement(jsonb) TO authenticated, service_role;

-- ---------- Outbound DLQ / SLA columns ----------
ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS dead_letter_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_breach_at timestamptz;

CREATE INDEX IF NOT EXISTS om_dead_letter_idx
  ON public.outbound_messages(dead_letter_at) WHERE dead_letter_at IS NOT NULL;

CREATE OR REPLACE VIEW public.v_outbound_sla_breach AS
SELECT id, user_id, to_phone, status, attempts, retry_count,
       created_at, next_attempt_at, last_error,
       EXTRACT(EPOCH FROM (now() - created_at))::int AS age_seconds
  FROM public.outbound_messages
 WHERE status IN ('queued','processing')
   AND created_at < now() - interval '60 seconds'
   AND dead_letter_at IS NULL;

REVOKE ALL ON public.v_outbound_sla_breach FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_outbound_sla_breach TO service_role;

-- ---------- Shared Goals ----------
CREATE TABLE IF NOT EXISTS public.shared_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  target_amount numeric(14,2) NOT NULL CHECK (target_amount > 0),
  deadline date,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','cancelled')),
  referral_source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_goals TO authenticated;
GRANT ALL ON public.shared_goals TO service_role;
ALTER TABLE public.shared_goals ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.shared_goal_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.shared_goals(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  phone_e164 text,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  invite_status text NOT NULL DEFAULT 'pending' CHECK (invite_status IN ('pending','accepted','declined','revoked')),
  joined_at timestamptz,
  contribution_total numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sgm_user_or_phone CHECK (user_id IS NOT NULL OR phone_e164 IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS sgm_goal_user_uniq ON public.shared_goal_members(goal_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sgm_goal_phone_uniq ON public.shared_goal_members(goal_id, phone_e164) WHERE user_id IS NULL AND phone_e164 IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_goal_members TO authenticated;
GRANT ALL ON public.shared_goal_members TO service_role;
ALTER TABLE public.shared_goal_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.shared_goal_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.shared_goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  occurred_at date NOT NULL DEFAULT current_date,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sgc_goal_idx ON public.shared_goal_contributions(goal_id, occurred_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_goal_contributions TO authenticated;
GRANT ALL ON public.shared_goal_contributions TO service_role;
ALTER TABLE public.shared_goal_contributions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.shared_goal_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.shared_goals(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+55[1-9][0-9]{9,10}$'),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired','revoked')),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sgi_goal_idx ON public.shared_goal_invites(goal_id);
CREATE INDEX IF NOT EXISTS sgi_phone_status_idx ON public.shared_goal_invites(phone_e164, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_goal_invites TO authenticated;
GRANT ALL ON public.shared_goal_invites TO service_role;
ALTER TABLE public.shared_goal_invites ENABLE ROW LEVEL SECURITY;

-- Helper: user is member of goal
CREATE OR REPLACE FUNCTION public.is_shared_goal_member(_goal_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shared_goal_members
     WHERE goal_id = _goal_id AND user_id = _user_id AND invite_status = 'accepted'
  ) OR EXISTS (
    SELECT 1 FROM public.shared_goals WHERE id = _goal_id AND created_by = _user_id
  );
$$;
REVOKE ALL ON FUNCTION public.is_shared_goal_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_shared_goal_member(uuid, uuid) TO authenticated, service_role;

-- Policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goals' AND policyname='sg_owner_all') THEN
    CREATE POLICY sg_owner_all ON public.shared_goals FOR ALL TO authenticated
      USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goals' AND policyname='sg_member_read') THEN
    CREATE POLICY sg_member_read ON public.shared_goals FOR SELECT TO authenticated
      USING (public.is_shared_goal_member(id, auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goal_members' AND policyname='sgm_visible') THEN
    CREATE POLICY sgm_visible ON public.shared_goal_members FOR SELECT TO authenticated
      USING (public.is_shared_goal_member(goal_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goal_members' AND policyname='sgm_owner_manage') THEN
    CREATE POLICY sgm_owner_manage ON public.shared_goal_members FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.shared_goals g WHERE g.id = goal_id AND g.created_by = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.shared_goals g WHERE g.id = goal_id AND g.created_by = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goal_members' AND policyname='sgm_self_leave') THEN
    CREATE POLICY sgm_self_leave ON public.shared_goal_members FOR UPDATE TO authenticated
      USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goal_contributions' AND policyname='sgc_member_read') THEN
    CREATE POLICY sgc_member_read ON public.shared_goal_contributions FOR SELECT TO authenticated
      USING (public.is_shared_goal_member(goal_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goal_contributions' AND policyname='sgc_self_write') THEN
    CREATE POLICY sgc_self_write ON public.shared_goal_contributions FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid() AND public.is_shared_goal_member(goal_id, auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goal_contributions' AND policyname='sgc_self_delete') THEN
    CREATE POLICY sgc_self_delete ON public.shared_goal_contributions FOR DELETE TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goal_invites' AND policyname='sgi_owner_all') THEN
    CREATE POLICY sgi_owner_all ON public.shared_goal_invites FOR ALL TO authenticated
      USING (invited_by = auth.uid()) WITH CHECK (invited_by = auth.uid());
  END IF;
END $$;

-- Triggers updated_at
CREATE TRIGGER shared_goals_updated_at BEFORE UPDATE ON public.shared_goals FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();
CREATE TRIGGER shared_goal_members_updated_at BEFORE UPDATE ON public.shared_goal_members FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- ---------- Notification type expansion ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='goal_invite' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE public.notification_type ADD VALUE 'goal_invite';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='goal_contribution' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE public.notification_type ADD VALUE 'goal_contribution';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='goal_milestone' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE public.notification_type ADD VALUE 'goal_milestone';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='split_participant_linked' AND enumtypid = 'notification_type'::regtype) THEN
    ALTER TYPE public.notification_type ADD VALUE 'split_participant_linked';
  END IF;
END $$;

-- ---------- Link on profile create (split + goals) ----------
CREATE OR REPLACE FUNCTION public.link_participants_on_whatsapp_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text := NEW.phone_e164;
  v_uid uuid := NEW.user_id;
BEGIN
  IF v_phone IS NULL OR v_uid IS NULL OR NEW.status <> 'active' THEN RETURN NEW; END IF;

  UPDATE public.shared_expense_participants
     SET linked_user_id = v_uid, invite_status = 'claimed'
   WHERE phone_e164 = v_phone AND linked_user_id IS NULL;

  INSERT INTO public.notifications (user_id, type, title, body, metadata)
  SELECT sep.owner_user_id, 'split_participant_linked'::notification_type,
         'Um participante entrou no Meu Nino', sep.name || ' entrou no app e agora vê o rolê no perfil dele.',
         jsonb_build_object('participant_id', sep.id, 'shared_expense_id', sep.shared_expense_id)
    FROM public.shared_expense_participants sep
   WHERE sep.phone_e164 = v_phone AND sep.linked_user_id = v_uid;

  UPDATE public.shared_goal_invites
     SET status = 'accepted', accepted_by_user_id = v_uid, accepted_at = now()
   WHERE phone_e164 = v_phone AND status = 'pending' AND expires_at > now();

  INSERT INTO public.shared_goal_members (goal_id, user_id, phone_e164, role, invite_status, joined_at)
  SELECT DISTINCT sgi.goal_id, v_uid, v_phone, 'member', 'accepted', now()
    FROM public.shared_goal_invites sgi
   WHERE sgi.phone_e164 = v_phone AND sgi.accepted_by_user_id = v_uid
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS whatsapp_links_participant_link ON public.whatsapp_links;
CREATE TRIGGER whatsapp_links_participant_link
  AFTER INSERT OR UPDATE OF status, phone_e164 ON public.whatsapp_links
  FOR EACH ROW EXECUTE FUNCTION public.link_participants_on_whatsapp_link();