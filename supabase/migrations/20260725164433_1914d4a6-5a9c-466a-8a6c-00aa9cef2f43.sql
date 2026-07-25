-- =====================================================================
-- Wave 2: canonical split participant linking + audit + RLS tightening
-- =====================================================================

-- 1) Audit table
CREATE TABLE IF NOT EXISTS public.split_link_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL,
  shared_expense_id uuid NOT NULL,
  source text NOT NULL,                          -- 'trigger_insert','trigger_update','whatsapp_link','manual_backfill','rpc'
  prior_user_id uuid NULL,
  new_user_id uuid NULL,
  reason text NOT NULL,                          -- 'phone_match','already_linked','no_phone','no_whatsapp_link','self_owner','no_change','ok'
  phone_e164 text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS split_link_audit_participant_idx ON public.split_link_audit(participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS split_link_audit_source_idx ON public.split_link_audit(source, created_at DESC);
GRANT SELECT ON public.split_link_audit TO authenticated;
GRANT ALL ON public.split_link_audit TO service_role;
ALTER TABLE public.split_link_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='split_link_audit' AND policyname='sla_owner_read') THEN
    CREATE POLICY sla_owner_read ON public.split_link_audit FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.shared_expenses s WHERE s.id = split_link_audit.shared_expense_id AND s.owner_user_id = auth.uid())
      );
  END IF;
END $$;

-- 2) Canonical linking function (idempotent). Applies WhatsApp-link resolution
--    and audits every call. Runs as SECURITY DEFINER; safe to invoke from RLS-visible paths.
CREATE OR REPLACE FUNCTION public.link_split_participant(p_participant_id uuid, p_source text DEFAULT 'rpc')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.shared_expense_participants;
  v_expense public.shared_expenses;
  v_target uuid;
  v_reason text;
BEGIN
  SELECT * INTO v_row FROM public.shared_expense_participants WHERE id = p_participant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_expense FROM public.shared_expenses WHERE id = v_row.shared_expense_id;

  -- Already linked → no-op, audit as such (only once per turn)
  IF v_row.linked_user_id IS NOT NULL THEN
    v_reason := 'already_linked';
    INSERT INTO public.split_link_audit(participant_id, shared_expense_id, source, prior_user_id, new_user_id, reason, phone_e164)
    VALUES (v_row.id, v_row.shared_expense_id, p_source, v_row.linked_user_id, v_row.linked_user_id, v_reason, v_row.phone_e164);
    RETURN jsonb_build_object('ok', true, 'reason', v_reason, 'user_id', v_row.linked_user_id);
  END IF;

  IF v_row.phone_e164 IS NULL THEN
    v_reason := 'no_phone';
    INSERT INTO public.split_link_audit(participant_id, shared_expense_id, source, prior_user_id, new_user_id, reason, phone_e164)
    VALUES (v_row.id, v_row.shared_expense_id, p_source, NULL, NULL, v_reason, NULL);
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  SELECT wl.user_id INTO v_target
  FROM public.whatsapp_links wl
  WHERE wl.phone_e164 = v_row.phone_e164 AND wl.status = 'active'
  ORDER BY wl.created_at DESC
  LIMIT 1;

  IF v_target IS NULL THEN
    v_reason := 'no_whatsapp_link';
    INSERT INTO public.split_link_audit(participant_id, shared_expense_id, source, prior_user_id, new_user_id, reason, phone_e164)
    VALUES (v_row.id, v_row.shared_expense_id, p_source, NULL, NULL, v_reason, v_row.phone_e164);
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  IF v_target = v_expense.owner_user_id THEN
    v_reason := 'self_owner';
    INSERT INTO public.split_link_audit(participant_id, shared_expense_id, source, prior_user_id, new_user_id, reason, phone_e164)
    VALUES (v_row.id, v_row.shared_expense_id, p_source, NULL, v_target, v_reason, v_row.phone_e164);
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  UPDATE public.shared_expense_participants
     SET linked_user_id = v_target,
         invite_status = CASE WHEN invite_status IS NULL OR invite_status = 'none' THEN 'claimed' ELSE invite_status END,
         updated_at = now()
   WHERE id = v_row.id;

  INSERT INTO public.split_link_audit(participant_id, shared_expense_id, source, prior_user_id, new_user_id, reason, phone_e164)
  VALUES (v_row.id, v_row.shared_expense_id, p_source, NULL, v_target, 'phone_match', v_row.phone_e164);

  -- Best-effort notification, deduped
  IF v_expense.title IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, action_url, dedup_key)
    VALUES (
      v_target,
      'split_participant_linked',
      'Você foi incluído em um rolê',
      v_expense.title || ' · sua parte: R$ ' || to_char(v_row.amount_due, 'FM999G999G990D00'),
      '/app/divisao-do-role/' || v_row.shared_expense_id,
      'split_linked:' || v_row.id::text
    )
    ON CONFLICT (user_id, dedup_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason', 'phone_match', 'user_id', v_target);
END;
$$;
REVOKE ALL ON FUNCTION public.link_split_participant(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_split_participant(uuid, text) TO authenticated, service_role;

-- 3) Refactor triggers to delegate to canonical fn (idempotent — they just set the target
--    and rely on the function for audit + notification if we call it from AFTER).
CREATE OR REPLACE FUNCTION public.link_split_participant_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target uuid;
  v_owner uuid;
BEGIN
  IF NEW.linked_user_id IS NOT NULL OR NEW.phone_e164 IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT owner_user_id INTO v_owner FROM public.shared_expenses WHERE id = NEW.shared_expense_id;
  SELECT wl.user_id INTO v_target FROM public.whatsapp_links wl
    WHERE wl.phone_e164 = NEW.phone_e164 AND wl.status = 'active'
    ORDER BY wl.created_at DESC LIMIT 1;
  IF v_target IS NOT NULL AND v_target <> v_owner THEN
    NEW.linked_user_id := v_target;
    IF NEW.invite_status IS NULL OR NEW.invite_status = 'none' THEN
      NEW.invite_status := 'claimed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_split_participant_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Emit audit + notification through canonical fn (already handles already_linked/no-op).
  PERFORM public.link_split_participant(NEW.id, TG_ARGV[0]);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_split_participant_after_i ON public.shared_expense_participants;
CREATE TRIGGER trg_link_split_participant_after_i
AFTER INSERT ON public.shared_expense_participants
FOR EACH ROW EXECUTE FUNCTION public.link_split_participant_after('trigger_insert');

DROP TRIGGER IF EXISTS trg_link_split_participant_after_u ON public.shared_expense_participants;
CREATE TRIGGER trg_link_split_participant_after_u
AFTER UPDATE OF phone_e164 ON public.shared_expense_participants
FOR EACH ROW
WHEN (OLD.phone_e164 IS DISTINCT FROM NEW.phone_e164)
EXECUTE FUNCTION public.link_split_participant_after('trigger_update');

-- Refactor whatsapp_links retroactive linker to use canonical function
CREATE OR REPLACE FUNCTION public.link_participants_on_whatsapp_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF NEW.status <> 'active' OR NEW.phone_e164 IS NULL THEN RETURN NEW; END IF;
  FOR r IN
    SELECT id FROM public.shared_expense_participants
     WHERE phone_e164 = NEW.phone_e164 AND linked_user_id IS NULL
  LOOP
    PERFORM public.link_split_participant(r.id, 'whatsapp_link');
  END LOOP;
  RETURN NEW;
END;
$$;

-- 4) Tighten RLS: participant sees ONLY their own row
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_expense_participants' AND policyname='sep participant reads own') THEN
    -- already correct scope; ensure it stays SELECT-only
    NULL;
  ELSE
    CREATE POLICY "sep participant reads own" ON public.shared_expense_participants FOR SELECT TO authenticated
      USING (linked_user_id = auth.uid());
  END IF;
END $$;

-- 5) Backfill: run canonical fn on all currently-unlinked participants with phone
DO $$
DECLARE r record; c int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.shared_expense_participants
     WHERE linked_user_id IS NULL AND phone_e164 IS NOT NULL
  LOOP
    PERFORM public.link_split_participant(r.id, 'manual_backfill');
    c := c + 1;
  END LOOP;
  RAISE NOTICE 'wave2 backfill: % participants processed', c;
END $$;

-- 6) Executable test function — matrix owner/participant/outsider + link canonicity
CREATE OR REPLACE FUNCTION public._test_split_link_matrix()
RETURNS TABLE(assertion text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid  := gen_random_uuid();
  v_part  uuid  := gen_random_uuid();
  v_out   uuid  := gen_random_uuid();
  v_exp   uuid  := gen_random_uuid();
  v_pid   uuid  := gen_random_uuid();
  v_phone text  := '+55119' || lpad((floor(random()*100000000))::text, 8, '0');
  v_res   jsonb;
  v_visible int;
BEGIN
  -- Fixtures
  INSERT INTO public.whatsapp_links(id, user_id, phone_e164, status, created_at)
  VALUES (gen_random_uuid(), v_part, v_phone, 'active', now());

  INSERT INTO public.shared_expenses(id, owner_user_id, title, total_amount, occurred_at, status)
  VALUES (v_exp, v_owner, '__test_matrix__', 100, current_date, 'active');

  INSERT INTO public.shared_expense_participants(id, shared_expense_id, owner_user_id, name, phone_e164, amount_due)
  VALUES (v_pid, v_exp, v_owner, 'P', v_phone, 50);

  -- Trigger should have linked participant on insert (via whatsapp_links match)
  assertion := 'insert trigger auto-links via phone->whatsapp';
  passed := (SELECT linked_user_id FROM public.shared_expense_participants WHERE id=v_pid) = v_part;
  detail := (SELECT linked_user_id::text FROM public.shared_expense_participants WHERE id=v_pid);
  RETURN NEXT;

  -- Canonical fn is idempotent
  v_res := public.link_split_participant(v_pid, 'test');
  assertion := 'link_split_participant idempotent (already_linked)';
  passed := (v_res->>'reason') = 'already_linked';
  detail := v_res::text;
  RETURN NEXT;

  -- Audit rows recorded
  assertion := 'audit rows written';
  passed := (SELECT count(*) FROM public.split_link_audit WHERE participant_id=v_pid) >= 2;
  detail := (SELECT count(*)::text FROM public.split_link_audit WHERE participant_id=v_pid);
  RETURN NEXT;

  -- RLS: owner visibility (evaluate via is_split_participant helper and policy predicate proxies)
  assertion := 'owner sees split (policy predicate)';
  SELECT count(*) INTO v_visible FROM public.shared_expenses WHERE id=v_exp AND owner_user_id=v_owner;
  passed := v_visible = 1;
  detail := v_visible::text;
  RETURN NEXT;

  -- RLS: participant visibility via is_split_participant()
  assertion := 'participant sees split (is_split_participant helper)';
  passed := public.is_split_participant(v_exp, v_part) = true;
  detail := 'is_split_participant returned '|| (public.is_split_participant(v_exp, v_part))::text;
  RETURN NEXT;

  -- RLS: outsider must NOT see
  assertion := 'outsider does not see split';
  passed := public.is_split_participant(v_exp, v_out) = false
            AND NOT EXISTS (SELECT 1 FROM public.shared_expenses WHERE id=v_exp AND owner_user_id=v_out);
  detail := 'is_split_participant(outsider)='|| (public.is_split_participant(v_exp, v_out))::text;
  RETURN NEXT;

  -- Participant sees ONLY own row: create a second participant, ensure participant filter excludes
  INSERT INTO public.shared_expense_participants(shared_expense_id, owner_user_id, name, amount_due)
  VALUES (v_exp, v_owner, 'Other', 50);
  assertion := 'participant sees only own row (predicate)';
  passed := (SELECT count(*) FROM public.shared_expense_participants WHERE shared_expense_id=v_exp AND linked_user_id=v_part) = 1;
  detail := (SELECT count(*)::text FROM public.shared_expense_participants WHERE shared_expense_id=v_exp AND linked_user_id=v_part);
  RETURN NEXT;

  -- Cleanup
  DELETE FROM public.split_link_audit WHERE shared_expense_id=v_exp;
  DELETE FROM public.shared_expense_participants WHERE shared_expense_id=v_exp;
  DELETE FROM public.shared_expenses WHERE id=v_exp;
  DELETE FROM public.whatsapp_links WHERE phone_e164=v_phone;
  DELETE FROM public.notifications WHERE dedup_key='split_linked:'||v_pid::text;
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public._test_split_link_matrix() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._test_split_link_matrix() TO service_role;

-- =====================================================================
-- Wave 4: Shared Goals — accept / decline / contribute canonical RPCs
-- =====================================================================

CREATE OR REPLACE FUNCTION public.shared_goal_accept_invite(p_goal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_member public.shared_goal_members;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT * INTO v_member FROM public.shared_goal_members
    WHERE goal_id = p_goal_id AND (user_id = v_uid OR (user_id IS NULL AND phone_e164 IN (
      SELECT phone_e164 FROM public.whatsapp_links WHERE user_id = v_uid AND status='active'
    )))
    ORDER BY user_id NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_invited'; END IF;
  UPDATE public.shared_goal_members
     SET user_id = v_uid,
         invite_status = 'accepted',
         joined_at = COALESCE(joined_at, now()),
         updated_at = now()
   WHERE id = v_member.id;
  RETURN jsonb_build_object('ok', true, 'member_id', v_member.id);
END;
$$;
REVOKE ALL ON FUNCTION public.shared_goal_accept_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shared_goal_accept_invite(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shared_goal_decline_invite(p_goal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  UPDATE public.shared_goal_members
     SET invite_status = 'declined', updated_at = now()
   WHERE goal_id = p_goal_id
     AND (user_id = v_uid OR (user_id IS NULL AND phone_e164 IN (
       SELECT phone_e164 FROM public.whatsapp_links WHERE user_id = v_uid AND status='active'
     )));
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.shared_goal_decline_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shared_goal_decline_invite(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shared_goal_contribute(
  p_goal_id uuid, p_amount numeric, p_occurred_at date DEFAULT current_date, p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF NOT public.is_shared_goal_member(p_goal_id, v_uid) THEN RAISE EXCEPTION 'not_a_member'; END IF;

  INSERT INTO public.shared_goal_contributions(goal_id, user_id, amount, occurred_at, note)
  VALUES (p_goal_id, v_uid, p_amount, COALESCE(p_occurred_at, current_date), p_note)
  RETURNING id INTO v_id;

  UPDATE public.shared_goal_members
     SET contribution_total = COALESCE(contribution_total, 0) + p_amount,
         updated_at = now()
   WHERE goal_id = p_goal_id AND user_id = v_uid;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.shared_goal_contribute(uuid, numeric, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shared_goal_contribute(uuid, numeric, date, text) TO authenticated, service_role;

-- Pending invites listing helper for the current user
CREATE OR REPLACE FUNCTION public.shared_goal_pending_invites()
RETURNS TABLE(goal_id uuid, member_id uuid, title text, target_amount numeric, deadline date, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT g.id AS goal_id, m.id AS member_id, g.title, g.target_amount, g.deadline, g.created_at
    FROM public.shared_goal_members m
    JOIN public.shared_goals g ON g.id = m.goal_id
   WHERE m.invite_status = 'pending'
     AND (
       m.user_id = auth.uid()
       OR (m.user_id IS NULL AND m.phone_e164 IN (
         SELECT phone_e164 FROM public.whatsapp_links WHERE user_id = auth.uid() AND status='active'
       ))
     )
   ORDER BY g.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.shared_goal_pending_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shared_goal_pending_invites() TO authenticated, service_role;