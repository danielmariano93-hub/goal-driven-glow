
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
  INSERT INTO auth.users(id, email, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES
    (v_owner, 'sg_owner_'||v_owner||'@test.local','authenticated','authenticated','x',now(),now(),now(),'{}','{}'),
    (v_member,'sg_mem_'||v_member||'@test.local','authenticated','authenticated','x',now(),now(),now(),'{}','{}'),
    (v_pending,'sg_pen_'||v_pending||'@test.local','authenticated','authenticated','x',now(),now(),now(),'{}','{}'),
    (v_outsider,'sg_out_'||v_outsider||'@test.local','authenticated','authenticated','x',now(),now(),now(),'{}','{}');

  INSERT INTO public.whatsapp_links(user_id, phone_e164, phone_hash, phone_masked, status)
    VALUES
    (v_member, v_phone_member, md5(v_phone_member), '+55 11 9****-0001', 'active'),
    (v_pending, v_phone_pending, md5(v_phone_pending), '+55 11 9****-0002', 'active');

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('role','authenticated', true);
  v_goal := public.shared_goal_create('Viagem', 1000, NULL);
  v_result := v_result || jsonb_build_object('created', v_goal IS NOT NULL);

  PERFORM public.shared_goal_invite(v_goal, v_phone_member, 'h1');
  PERFORM public.shared_goal_invite(v_goal, v_phone_pending, 'h2');

  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  PERFORM public.shared_goal_accept_invite(v_goal);
  v_result := v_result || jsonb_build_object(
    'role_member', public.shared_goal_role(v_goal, v_member) = 'member',
    'role_pending', public.shared_goal_role(v_goal, v_pending) = 'pending',
    'role_outsider', public.shared_goal_role(v_goal, v_outsider) = 'outsider',
    'role_owner', public.shared_goal_role(v_goal, v_owner) = 'owner'
  );

  v_contrib := public.shared_goal_add_contribution(v_goal, 250, current_date, 'a', 'idem-1');
  v_contrib2 := public.shared_goal_add_contribution(v_goal, 250, current_date, 'a', 'idem-1');
  v_result := v_result || jsonb_build_object('idempotent', v_contrib = v_contrib2);
  v_result := v_result || jsonb_build_object(
    'total_after_idem', (SELECT COALESCE(SUM(amount),0) FROM public.shared_goal_contributions WHERE goal_id = v_goal) = 250
  );

  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN
    PERFORM public.shared_goal_add_contribution(v_goal, 10, current_date, NULL, NULL);
    v_result := v_result || jsonb_build_object('outsider_blocked', false);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('outsider_blocked', true);
  END;

  PERFORM set_config('request.jwt.claim.sub', v_pending::text, true);
  BEGIN
    PERFORM public.shared_goal_add_contribution(v_goal, 10, current_date, NULL, NULL);
    v_result := v_result || jsonb_build_object('pending_blocked', false);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('pending_blocked', true);
  END;

  PERFORM public.shared_goal_decline_invite(v_goal);
  v_result := v_result || jsonb_build_object(
    'pending_declined',
    (SELECT status FROM public.shared_goal_invites WHERE goal_id=v_goal AND phone_e164=v_phone_pending) = 'declined'
  );

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  BEGIN
    PERFORM public.shared_goal_leave(v_goal);
    v_result := v_result || jsonb_build_object('owner_cannot_leave', false);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('owner_cannot_leave', true);
  END;

  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN
    PERFORM public.shared_goal_update(v_goal, 'Hack', NULL, NULL);
    v_result := v_result || jsonb_build_object('outsider_update_blocked', false);
  EXCEPTION WHEN OTHERS THEN
    v_result := v_result || jsonb_build_object('outsider_update_blocked', true);
  END;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.shared_goal_cancel(v_goal);
  v_result := v_result || jsonb_build_object(
    'cancelled', (SELECT status FROM public.shared_goals WHERE id = v_goal) = 'cancelled'
  );

  DELETE FROM public.notifications WHERE user_id IN (v_owner, v_member, v_pending, v_outsider);
  DELETE FROM public.shared_goals WHERE id = v_goal;
  DELETE FROM public.whatsapp_links WHERE user_id IN (v_member, v_pending);
  DELETE FROM public.user_pseudonyms WHERE user_id IN (v_owner, v_member, v_pending, v_outsider);
  DELETE FROM public.profiles WHERE id IN (v_owner, v_member, v_pending, v_outsider);
  DELETE FROM auth.users WHERE id IN (v_owner, v_member, v_pending, v_outsider);

  RETURN v_result;
END $$;
