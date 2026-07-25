
-- ============================================================================
-- BLOCO A: Metas Conjuntas — RPCs canônicas, RLS por papel, notificações, testes
-- Idempotente e aditivo. Preserva Onda 1 e Onda 2.
-- ============================================================================

-- 1) SCHEMA ADITIVO -----------------------------------------------------------

ALTER TABLE public.shared_goals
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_milestone_pct int NOT NULL DEFAULT 0;

ALTER TABLE public.shared_goal_contributions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS sgc_idem_uniq
  ON public.shared_goal_contributions(goal_id, user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 2) HELPER: papel do usuário na meta ----------------------------------------

CREATE OR REPLACE FUNCTION public.shared_goal_role(_goal_id uuid, _user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.shared_goals g
                  WHERE g.id = _goal_id AND g.created_by = _user_id) THEN 'owner'
    WHEN EXISTS (SELECT 1 FROM public.shared_goal_members m
                  WHERE m.goal_id = _goal_id AND m.user_id = _user_id
                    AND m.invite_status = 'accepted') THEN 'member'
    WHEN EXISTS (
      SELECT 1 FROM public.shared_goal_invites i
      JOIN public.whatsapp_links wl ON wl.phone_e164 = i.phone_e164 AND wl.status = 'active'
      WHERE i.goal_id = _goal_id AND wl.user_id = _user_id AND i.status = 'pending'
    ) THEN 'pending'
    ELSE 'outsider'
  END
$$;
REVOKE ALL ON FUNCTION public.shared_goal_role(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shared_goal_role(uuid, uuid) TO authenticated, service_role;

-- 3) NOTIFICAÇÕES: helper de dispatch dedupado --------------------------------

CREATE OR REPLACE FUNCTION public._sg_notify(
  _user_id uuid, _type notification_type, _title text, _body text, _url text, _dedup text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications(user_id, type, title, body, action_url, dedup_key)
  VALUES (_user_id, _type, _title, _body, _url, _dedup)
  ON CONFLICT (user_id, dedup_key) DO NOTHING;
END $$;

-- 4) RPCs CANÔNICAS -----------------------------------------------------------

-- 4.1 create ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_goal_create(
  p_title text, p_target_amount numeric, p_deadline date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_title IS NULL OR length(trim(p_title)) < 2 THEN RAISE EXCEPTION 'invalid_title'; END IF;
  IF p_target_amount IS NULL OR p_target_amount <= 0 THEN RAISE EXCEPTION 'invalid_target'; END IF;

  INSERT INTO public.shared_goals(title, target_amount, deadline, created_by, status)
  VALUES (trim(p_title), p_target_amount, p_deadline, v_uid, 'active')
  RETURNING id INTO v_id;

  INSERT INTO public.shared_goal_members(goal_id, user_id, role, invite_status, joined_at)
  VALUES (v_id, v_uid, 'owner', 'accepted', now())
  ON CONFLICT DO NOTHING;

  RETURN v_id;
END $$;

-- 4.2 invite ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_goal_invite(
  p_goal_id uuid, p_phone_e164 text, p_token_hash text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_target_uid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shared_goals WHERE id = p_goal_id AND created_by = v_uid) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  IF p_phone_e164 !~ '^\+55[1-9][0-9]{9,10}$' THEN RAISE EXCEPTION 'invalid_phone'; END IF;

  INSERT INTO public.shared_goal_invites(goal_id, phone_e164, invited_by, token_hash)
  VALUES (p_goal_id, p_phone_e164, v_uid, p_token_hash)
  RETURNING id INTO v_id;

  -- reserva slot em members (pending, sem user_id)
  INSERT INTO public.shared_goal_members(goal_id, phone_e164, role, invite_status)
  VALUES (p_goal_id, p_phone_e164, 'member', 'pending')
  ON CONFLICT DO NOTHING;

  -- se telefone já é de usuário cadastrado, dispara notificação in-app
  SELECT wl.user_id INTO v_target_uid
    FROM public.whatsapp_links wl
   WHERE wl.phone_e164 = p_phone_e164 AND wl.status = 'active'
   ORDER BY wl.created_at DESC LIMIT 1;
  IF v_target_uid IS NOT NULL AND v_target_uid <> v_uid THEN
    PERFORM public._sg_notify(
      v_target_uid, 'goal_invite',
      'Você foi convidado para uma meta',
      'Aceite para começar a contribuir juntos.',
      '/app/metas-conjuntas/' || p_goal_id,
      'sg_invite:' || v_id::text
    );
  END IF;

  RETURN v_id;
END $$;

-- 4.3 accept ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_goal_accept_invite(p_goal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_phone text; v_invite record; v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  SELECT phone_e164 INTO v_phone FROM public.whatsapp_links
   WHERE user_id = v_uid AND status = 'active' ORDER BY created_at DESC LIMIT 1;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'no_active_whatsapp_link'; END IF;

  SELECT i.*, g.created_by INTO v_invite
    FROM public.shared_goal_invites i
    JOIN public.shared_goals g ON g.id = i.goal_id
   WHERE i.goal_id = p_goal_id AND i.phone_e164 = v_phone
     AND i.status = 'pending' AND i.expires_at > now()
   ORDER BY i.created_at DESC LIMIT 1;
  IF v_invite IS NULL THEN RAISE EXCEPTION 'no_pending_invite'; END IF;

  UPDATE public.shared_goal_invites
     SET status = 'accepted', accepted_by_user_id = v_uid, accepted_at = now()
   WHERE id = v_invite.id;

  -- promove slot pending → accepted, ou cria caso não exista
  UPDATE public.shared_goal_members
     SET user_id = v_uid, invite_status = 'accepted', joined_at = now(), updated_at = now()
   WHERE goal_id = p_goal_id AND phone_e164 = v_phone AND user_id IS NULL;

  IF NOT FOUND THEN
    INSERT INTO public.shared_goal_members(goal_id, user_id, phone_e164, role, invite_status, joined_at)
    VALUES (p_goal_id, v_uid, v_phone, 'member', 'accepted', now())
    ON CONFLICT DO NOTHING;
  END IF;

  v_owner := v_invite.created_by;
  IF v_owner IS NOT NULL AND v_owner <> v_uid THEN
    PERFORM public._sg_notify(
      v_owner, 'goal_invite',
      'Sua meta ganhou um novo participante',
      'Alguém aceitou seu convite.',
      '/app/metas-conjuntas/' || p_goal_id,
      'sg_accepted:' || v_invite.id::text
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'goal_id', p_goal_id);
END $$;

-- 4.4 decline -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_goal_decline_invite(p_goal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_phone text; v_invite_id uuid; v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT phone_e164 INTO v_phone FROM public.whatsapp_links
   WHERE user_id = v_uid AND status = 'active' ORDER BY created_at DESC LIMIT 1;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'no_active_whatsapp_link'; END IF;

  UPDATE public.shared_goal_invites
     SET status = 'declined'
   WHERE goal_id = p_goal_id AND phone_e164 = v_phone AND status = 'pending'
   RETURNING id, invited_by INTO v_invite_id, v_owner;

  DELETE FROM public.shared_goal_members
   WHERE goal_id = p_goal_id AND phone_e164 = v_phone AND user_id IS NULL;

  IF v_owner IS NOT NULL THEN
    PERFORM public._sg_notify(
      v_owner, 'system',
      'Um convite foi recusado',
      'Um convite da sua meta conjunta foi recusado.',
      '/app/metas-conjuntas/' || p_goal_id,
      'sg_declined:' || COALESCE(v_invite_id::text, p_goal_id::text)
    );
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 4.5 add_contribution (idempotente) -----------------------------------------
CREATE OR REPLACE FUNCTION public.shared_goal_add_contribution(
  p_goal_id uuid, p_amount numeric, p_occurred_at date DEFAULT CURRENT_DATE,
  p_note text DEFAULT NULL, p_idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid(); v_id uuid;
  v_total numeric; v_target numeric; v_pct int; v_last int; v_m record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF NOT public.is_shared_goal_member(p_goal_id, v_uid) THEN RAISE EXCEPTION 'not_a_member'; END IF;

  -- idempotência: se já existe, retorna o mesmo id sem duplicar
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.shared_goal_contributions
     WHERE goal_id = p_goal_id AND user_id = v_uid AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  INSERT INTO public.shared_goal_contributions(goal_id, user_id, amount, occurred_at, note, idempotency_key)
  VALUES (p_goal_id, v_uid, p_amount, COALESCE(p_occurred_at, current_date), p_note, p_idempotency_key)
  RETURNING id INTO v_id;

  UPDATE public.shared_goal_members
     SET contribution_total = COALESCE(contribution_total, 0) + p_amount,
         updated_at = now()
   WHERE goal_id = p_goal_id AND user_id = v_uid;

  -- Notifica outros membros da contribuição
  FOR v_m IN SELECT user_id FROM public.shared_goal_members
              WHERE goal_id = p_goal_id AND invite_status = 'accepted'
                AND user_id IS NOT NULL AND user_id <> v_uid LOOP
    PERFORM public._sg_notify(
      v_m.user_id, 'goal_contribution',
      'Nova contribuição na meta',
      'Sua meta conjunta recebeu uma nova contribuição.',
      '/app/metas-conjuntas/' || p_goal_id,
      'sg_contrib:' || v_id::text
    );
  END LOOP;

  -- Marcos: 25/50/75/100
  SELECT COALESCE(SUM(amount),0), (SELECT target_amount FROM public.shared_goals WHERE id = p_goal_id)
    INTO v_total, v_target FROM public.shared_goal_contributions WHERE goal_id = p_goal_id;
  v_pct := LEAST(100, floor((v_total / NULLIF(v_target,0)) * 100)::int);
  SELECT last_milestone_pct INTO v_last FROM public.shared_goals WHERE id = p_goal_id;

  IF v_pct >= 100 AND v_last < 100 THEN
    UPDATE public.shared_goals
       SET last_milestone_pct = 100, status = 'completed', completed_at = now(), updated_at = now()
     WHERE id = p_goal_id;
    FOR v_m IN SELECT user_id FROM public.shared_goal_members
                WHERE goal_id = p_goal_id AND invite_status = 'accepted' AND user_id IS NOT NULL LOOP
      PERFORM public._sg_notify(v_m.user_id, 'goal_reached',
        'Meta conjunta concluída!', 'Vocês atingiram 100% da meta.',
        '/app/metas-conjuntas/' || p_goal_id, 'sg_reached:' || p_goal_id::text);
    END LOOP;
  ELSIF v_pct >= 75 AND v_last < 75 THEN
    UPDATE public.shared_goals SET last_milestone_pct = 75, updated_at = now() WHERE id = p_goal_id;
    FOR v_m IN SELECT user_id FROM public.shared_goal_members
                WHERE goal_id = p_goal_id AND invite_status = 'accepted' AND user_id IS NOT NULL LOOP
      PERFORM public._sg_notify(v_m.user_id, 'goal_milestone',
        '75% da meta alcançados', 'Continuem assim!',
        '/app/metas-conjuntas/' || p_goal_id, 'sg_ms75:' || p_goal_id::text);
    END LOOP;
  ELSIF v_pct >= 50 AND v_last < 50 THEN
    UPDATE public.shared_goals SET last_milestone_pct = 50, updated_at = now() WHERE id = p_goal_id;
    FOR v_m IN SELECT user_id FROM public.shared_goal_members
                WHERE goal_id = p_goal_id AND invite_status = 'accepted' AND user_id IS NOT NULL LOOP
      PERFORM public._sg_notify(v_m.user_id, 'goal_milestone',
        'Metade do caminho!', 'A meta conjunta chegou a 50%.',
        '/app/metas-conjuntas/' || p_goal_id, 'sg_ms50:' || p_goal_id::text);
    END LOOP;
  ELSIF v_pct >= 25 AND v_last < 25 THEN
    UPDATE public.shared_goals SET last_milestone_pct = 25, updated_at = now() WHERE id = p_goal_id;
  END IF;

  RETURN v_id;
END $$;

-- 4.6 leave -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_goal_leave(p_goal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF EXISTS (SELECT 1 FROM public.shared_goals WHERE id = p_goal_id AND created_by = v_uid) THEN
    RAISE EXCEPTION 'owner_cannot_leave';
  END IF;
  DELETE FROM public.shared_goal_members WHERE goal_id = p_goal_id AND user_id = v_uid;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 4.7 remove_member -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_goal_remove_member(p_goal_id uuid, p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shared_goals WHERE id = p_goal_id AND created_by = v_uid) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  DELETE FROM public.shared_goal_members
   WHERE id = p_member_id AND goal_id = p_goal_id AND role <> 'owner';
  RETURN jsonb_build_object('ok', true);
END $$;

-- 4.8 update ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_goal_update(
  p_goal_id uuid, p_title text DEFAULT NULL, p_target_amount numeric DEFAULT NULL, p_deadline date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shared_goals WHERE id = p_goal_id AND created_by = v_uid) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  IF p_target_amount IS NOT NULL AND p_target_amount <= 0 THEN RAISE EXCEPTION 'invalid_target'; END IF;
  UPDATE public.shared_goals
     SET title = COALESCE(NULLIF(trim(p_title),''), title),
         target_amount = COALESCE(p_target_amount, target_amount),
         deadline = COALESCE(p_deadline, deadline),
         updated_at = now()
   WHERE id = p_goal_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 4.9 cancel ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shared_goal_cancel(p_goal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shared_goals WHERE id = p_goal_id AND created_by = v_uid) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  UPDATE public.shared_goals
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
   WHERE id = p_goal_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 5) GRANTS: acesso mínimo, revogado de PUBLIC ------------------------------

REVOKE ALL ON FUNCTION public.shared_goal_create(text,numeric,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shared_goal_invite(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shared_goal_accept_invite(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shared_goal_decline_invite(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shared_goal_add_contribution(uuid,numeric,date,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shared_goal_leave(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shared_goal_remove_member(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shared_goal_update(uuid,text,numeric,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shared_goal_cancel(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.shared_goal_create(text,numeric,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shared_goal_invite(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shared_goal_accept_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shared_goal_decline_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shared_goal_add_contribution(uuid,numeric,date,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shared_goal_leave(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shared_goal_remove_member(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shared_goal_update(uuid,text,numeric,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shared_goal_cancel(uuid) TO authenticated;

-- 6) RLS: reforço por papel ---------------------------------------------------

-- shared_goal_invites: convidado pendente (via whatsapp_link) pode LER seu convite
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goal_invites' AND policyname='sgi_invitee_read') THEN
    CREATE POLICY sgi_invitee_read ON public.shared_goal_invites FOR SELECT TO authenticated
      USING (
        status = 'pending' AND EXISTS (
          SELECT 1 FROM public.whatsapp_links wl
          WHERE wl.user_id = auth.uid() AND wl.status = 'active'
            AND wl.phone_e164 = shared_goal_invites.phone_e164
        )
      );
  END IF;
END $$;

-- shared_goals: convidado pendente vê apenas título/valor/prazo mínimos
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goals' AND policyname='sg_pending_read') THEN
    CREATE POLICY sg_pending_read ON public.shared_goals FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.shared_goal_invites i
          JOIN public.whatsapp_links wl ON wl.phone_e164 = i.phone_e164 AND wl.status = 'active'
          WHERE i.goal_id = shared_goals.id AND wl.user_id = auth.uid()
            AND i.status = 'pending' AND i.expires_at > now()
        )
      );
  END IF;
END $$;

-- Bloquear INSERT/UPDATE/DELETE direto: forçar uso das RPCs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_goal_contributions' AND policyname='sgc_no_direct_update') THEN
    CREATE POLICY sgc_no_direct_update ON public.shared_goal_contributions FOR UPDATE TO authenticated
      USING (false) WITH CHECK (false);
  END IF;
END $$;

-- 7) TESTE EXECUTÁVEL ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public._test_shared_goals_matrix()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_pending uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_goal uuid; v_contrib uuid; v_contrib2 uuid;
  v_result jsonb := '{}'::jsonb;
  v_phone_member text := '+5511900000001';
  v_phone_pending text := '+5511900000002';
BEGIN
  -- Fixtures
  INSERT INTO auth.users(id, email, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES
    (v_owner, 'sg_owner_'||v_owner||'@test.local','authenticated','authenticated','x',now(),now(),now(),'{}','{}'),
    (v_member,'sg_mem_'||v_member||'@test.local','authenticated','authenticated','x',now(),now(),now(),'{}','{}'),
    (v_pending,'sg_pen_'||v_pending||'@test.local','authenticated','authenticated','x',now(),now(),now(),'{}','{}'),
    (v_outsider,'sg_out_'||v_outsider||'@test.local','authenticated','authenticated','x',now(),now(),now(),'{}','{}');

  INSERT INTO public.whatsapp_links(user_id, phone_e164, status, created_at)
    VALUES
    (v_member, v_phone_member, 'active', now()),
    (v_pending, v_phone_pending, 'active', now());

  -- owner cria
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('role','authenticated', true);
  v_goal := public.shared_goal_create('Viagem', 1000, NULL);
  v_result := v_result || jsonb_build_object('created', v_goal IS NOT NULL);

  -- convida member e pending
  PERFORM public.shared_goal_invite(v_goal, v_phone_member, 'h1');
  PERFORM public.shared_goal_invite(v_goal, v_phone_pending, 'h2');

  -- member aceita
  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM public.shared_goal_accept_invite(v_goal);
  v_result := v_result || jsonb_build_object(
    'role_member', public.shared_goal_role(v_goal, v_member) = 'member',
    'role_pending', public.shared_goal_role(v_goal, v_pending) = 'pending',
    'role_outsider', public.shared_goal_role(v_goal, v_outsider) = 'outsider',
    'role_owner', public.shared_goal_role(v_goal, v_owner) = 'owner'
  );

  -- contribuição com idempotência (mesmo idem_key não duplica)
  v_contrib := public.shared_goal_add_contribution(v_goal, 250, current_date, 'a', 'idem-1');
  v_contrib2 := public.shared_goal_add_contribution(v_goal, 250, current_date, 'a', 'idem-1');
  v_result := v_result || jsonb_build_object('idempotent', v_contrib = v_contrib2);

  -- total deve ser 250, não 500
  v_result := v_result || jsonb_build_object(
    'total_after_idem', (SELECT COALESCE(SUM(amount),0) FROM public.shared_goal_contributions WHERE goal_id = v_goal) = 250
  );

  -- outsider tentando contribuir → deve falhar
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN
    PERFORM public.shared_goal_add_contribution(v_goal, 10, current_date, NULL, NULL);
    v_result := v_result || jsonb_build_object('outsider_blocked', false);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('outsider_blocked', true);
  END;

  -- pending tentando contribuir → deve falhar
  PERFORM set_config('request.jwt.claim.sub', v_pending::text, true);
  BEGIN
    PERFORM public.shared_goal_add_contribution(v_goal, 10, current_date, NULL, NULL);
    v_result := v_result || jsonb_build_object('pending_blocked', false);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('pending_blocked', true);
  END;

  -- pending recusa
  PERFORM public.shared_goal_decline_invite(v_goal);
  v_result := v_result || jsonb_build_object(
    'pending_declined',
    (SELECT status FROM public.shared_goal_invites WHERE goal_id=v_goal AND phone_e164=v_phone_pending) = 'declined'
  );

  -- owner tentando sair → deve falhar
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  BEGIN
    PERFORM public.shared_goal_leave(v_goal);
    v_result := v_result || jsonb_build_object('owner_cannot_leave', false);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('owner_cannot_leave', true);
  END;

  -- outsider tentando editar → deve falhar
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN
    PERFORM public.shared_goal_update(v_goal, 'Hack', NULL, NULL);
    v_result := v_result || jsonb_build_object('outsider_update_blocked', false);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('outsider_update_blocked', true);
  END;

  -- owner cancela
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.shared_goal_cancel(v_goal);
  v_result := v_result || jsonb_build_object(
    'cancelled', (SELECT status FROM public.shared_goals WHERE id = v_goal) = 'cancelled'
  );

  -- cleanup
  DELETE FROM public.notifications WHERE user_id IN (v_owner, v_member, v_pending, v_outsider);
  DELETE FROM public.shared_goals WHERE id = v_goal;
  DELETE FROM public.whatsapp_links WHERE user_id IN (v_member, v_pending);
  DELETE FROM public.user_pseudonyms WHERE user_id IN (v_owner, v_member, v_pending, v_outsider);
  DELETE FROM public.profiles WHERE id IN (v_owner, v_member, v_pending, v_outsider);
  DELETE FROM auth.users WHERE id IN (v_owner, v_member, v_pending, v_outsider);

  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public._test_shared_goals_matrix() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._test_shared_goals_matrix() TO service_role;
