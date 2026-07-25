-- Wave 2 hardening: lock down link_split_participant, require unique
-- whatsapp match, dedupe already_linked audit noise, extend test matrix.

REVOKE EXECUTE ON FUNCTION public.link_split_participant(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_split_participant(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.link_split_participant(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.link_split_participant(uuid, text) TO service_role;

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
  v_match_count int;
  v_last_reason text;
  v_reason text;
BEGIN
  SELECT * INTO v_row FROM public.shared_expense_participants WHERE id = p_participant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_expense FROM public.shared_expenses WHERE id = v_row.shared_expense_id;

  SELECT reason INTO v_last_reason
    FROM public.split_link_audit
   WHERE participant_id = v_row.id
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_row.linked_user_id IS NOT NULL THEN
    v_reason := 'already_linked';
    IF v_last_reason IS DISTINCT FROM v_reason THEN
      INSERT INTO public.split_link_audit(participant_id, shared_expense_id, source, prior_user_id, new_user_id, reason, phone_e164)
      VALUES (v_row.id, v_row.shared_expense_id, p_source, v_row.linked_user_id, v_row.linked_user_id, v_reason, v_row.phone_e164);
    END IF;
    RETURN jsonb_build_object('ok', true, 'reason', v_reason, 'user_id', v_row.linked_user_id);
  END IF;

  IF v_row.phone_e164 IS NULL THEN
    v_reason := 'no_phone';
    IF v_last_reason IS DISTINCT FROM v_reason THEN
      INSERT INTO public.split_link_audit(participant_id, shared_expense_id, source, prior_user_id, new_user_id, reason, phone_e164)
      VALUES (v_row.id, v_row.shared_expense_id, p_source, NULL, NULL, v_reason, NULL);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  SELECT count(DISTINCT wl.user_id) INTO v_match_count
    FROM public.whatsapp_links wl
   WHERE wl.phone_e164 = v_row.phone_e164 AND wl.status = 'active';

  IF v_match_count > 1 THEN
    v_reason := 'multiple_matches';
    IF v_last_reason IS DISTINCT FROM v_reason THEN
      INSERT INTO public.split_link_audit(participant_id, shared_expense_id, source, prior_user_id, new_user_id, reason, phone_e164)
      VALUES (v_row.id, v_row.shared_expense_id, p_source, NULL, NULL, v_reason, v_row.phone_e164);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', v_reason, 'matches', v_match_count);
  END IF;

  IF v_match_count = 0 THEN
    v_reason := 'no_whatsapp_link';
    IF v_last_reason IS DISTINCT FROM v_reason THEN
      INSERT INTO public.split_link_audit(participant_id, shared_expense_id, source, prior_user_id, new_user_id, reason, phone_e164)
      VALUES (v_row.id, v_row.shared_expense_id, p_source, NULL, NULL, v_reason, v_row.phone_e164);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  SELECT wl.user_id INTO v_target
    FROM public.whatsapp_links wl
   WHERE wl.phone_e164 = v_row.phone_e164 AND wl.status = 'active'
   ORDER BY wl.created_at DESC
   LIMIT 1;

  IF v_target = v_expense.owner_user_id THEN
    v_reason := 'self_owner';
    IF v_last_reason IS DISTINCT FROM v_reason THEN
      INSERT INTO public.split_link_audit(participant_id, shared_expense_id, source, prior_user_id, new_user_id, reason, phone_e164)
      VALUES (v_row.id, v_row.shared_expense_id, p_source, NULL, v_target, v_reason, v_row.phone_e164);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', v_reason);
  END IF;

  UPDATE public.shared_expense_participants
     SET linked_user_id = v_target,
         invite_status = CASE WHEN invite_status IS NULL OR invite_status = 'none' THEN 'claimed' ELSE invite_status END,
         updated_at = now()
   WHERE id = v_row.id;

  INSERT INTO public.split_link_audit(participant_id, shared_expense_id, source, prior_user_id, new_user_id, reason, phone_e164)
  VALUES (v_row.id, v_row.shared_expense_id, p_source, NULL, v_target, 'phone_match', v_row.phone_e164);

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

REVOKE EXECUTE ON FUNCTION public.link_split_participant(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_split_participant(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.link_split_participant(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.link_split_participant(uuid, text) TO service_role;

-- Extend test matrix
CREATE OR REPLACE FUNCTION public._test_split_link_matrix()
RETURNS TABLE(assertion text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_part  uuid := gen_random_uuid();
  v_out   uuid := gen_random_uuid();
  v_dup   uuid := gen_random_uuid();
  v_exp   uuid := gen_random_uuid();
  v_pid   uuid := gen_random_uuid();
  v_pid2  uuid := gen_random_uuid();
  v_acc   uuid := gen_random_uuid();
  v_phone text := '+55119' || lpad((floor(random()*100000000))::text, 8, '0');
  v_phone2 text := '+55119' || lpad((floor(random()*100000000))::text, 8, '0');
  v_res   jsonb;
  v_visible int;
  v_has_priv boolean;
BEGIN
  INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-o-'||v_owner::text||'@t.test', '', now(), now(), now()),
    (v_part , '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-p-'||v_part::text ||'@t.test', '', now(), now(), now()),
    (v_out  , '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-x-'||v_out::text  ||'@t.test', '', now(), now(), now()),
    (v_dup  , '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't-d-'||v_dup::text  ||'@t.test', '', now(), now(), now());

  INSERT INTO public.whatsapp_links(id, user_id, phone_e164, phone_hash, phone_masked, status)
  VALUES (gen_random_uuid(), v_part, v_phone, md5(v_phone), regexp_replace(v_phone,'(\+\d{4})\d+(\d{2})','\1****\2'), 'active');

  INSERT INTO public.whatsapp_links(id, user_id, phone_e164, phone_hash, phone_masked, status)
  VALUES
    (gen_random_uuid(), v_part, v_phone2, md5(v_phone2), regexp_replace(v_phone2,'(\+\d{4})\d+(\d{2})','\1****\2'), 'active'),
    (gen_random_uuid(), v_dup,  v_phone2, md5(v_phone2), regexp_replace(v_phone2,'(\+\d{4})\d+(\d{2})','\1****\2'), 'active');

  INSERT INTO public.accounts(id, user_id, name, type, opening_balance)
  VALUES (v_acc, v_owner, '__test_acc__', 'checking', 0);

  INSERT INTO public.shared_expenses(id, owner_user_id, title, total_amount, occurred_at, status, source_account_id)
  VALUES (v_exp, v_owner, '__test_matrix__', 100, current_date, 'active', v_acc);

  INSERT INTO public.shared_expense_participants(id, shared_expense_id, owner_user_id, name, phone_e164, amount_due)
  VALUES (v_pid, v_exp, v_owner, 'P', v_phone, 50);

  assertion := 'insert trigger auto-links via phone->whatsapp';
  passed := (SELECT linked_user_id FROM public.shared_expense_participants WHERE id=v_pid) = v_part;
  detail := COALESCE((SELECT linked_user_id::text FROM public.shared_expense_participants WHERE id=v_pid),'null');
  RETURN NEXT;

  v_res := public.link_split_participant(v_pid, 'test');
  assertion := 'link_split_participant idempotent (already_linked)';
  passed := (v_res->>'reason') = 'already_linked';
  detail := v_res::text;
  RETURN NEXT;

  PERFORM public.link_split_participant(v_pid, 'test');
  PERFORM public.link_split_participant(v_pid, 'test');
  assertion := 'audit dedups already_linked noise';
  passed := (SELECT count(*) FROM public.split_link_audit WHERE participant_id=v_pid AND reason='already_linked') = 1;
  detail := (SELECT count(*)::text FROM public.split_link_audit WHERE participant_id=v_pid AND reason='already_linked');
  RETURN NEXT;

  INSERT INTO public.shared_expense_participants(id, shared_expense_id, owner_user_id, name, phone_e164, amount_due)
  VALUES (v_pid2, v_exp, v_owner, 'P2', v_phone2, 25);
  v_res := public.link_split_participant(v_pid2, 'test');
  assertion := 'multiple_matches refuses to link';
  passed := (v_res->>'reason') = 'multiple_matches'
            AND (SELECT linked_user_id FROM public.shared_expense_participants WHERE id=v_pid2) IS NULL;
  detail := v_res::text;
  RETURN NEXT;

  assertion := 'audit row for multiple_matches persisted';
  passed := EXISTS (SELECT 1 FROM public.split_link_audit WHERE participant_id=v_pid2 AND reason='multiple_matches');
  detail := (SELECT count(*)::text FROM public.split_link_audit WHERE participant_id=v_pid2);
  RETURN NEXT;

  assertion := 'owner sees split (predicate)';
  SELECT count(*) INTO v_visible FROM public.shared_expenses WHERE id=v_exp AND owner_user_id=v_owner;
  passed := v_visible = 1;
  detail := v_visible::text;
  RETURN NEXT;

  assertion := 'participant sees split (is_split_participant)';
  passed := public.is_split_participant(v_exp, v_part) = true;
  detail := 'is_split_participant='|| (public.is_split_participant(v_exp, v_part))::text;
  RETURN NEXT;

  assertion := 'outsider does not see split';
  passed := public.is_split_participant(v_exp, v_out) = false
            AND NOT EXISTS (SELECT 1 FROM public.shared_expenses WHERE id=v_exp AND owner_user_id=v_out);
  detail := 'is_split_participant(outsider)='|| (public.is_split_participant(v_exp, v_out))::text;
  RETURN NEXT;

  SELECT has_function_privilege('authenticated',
           'public.link_split_participant(uuid, text)', 'EXECUTE')
    INTO v_has_priv;
  assertion := 'authenticated cannot call link_split_participant directly';
  passed := v_has_priv = false;
  detail := 'has_function_privilege(authenticated)='||v_has_priv::text;
  RETURN NEXT;

  DELETE FROM public.notifications WHERE dedup_key IN ('split_linked:'||v_pid::text,'split_linked:'||v_pid2::text);
  DELETE FROM public.split_link_audit WHERE shared_expense_id=v_exp;
  DELETE FROM public.shared_expense_participants WHERE shared_expense_id=v_exp;
  DELETE FROM public.shared_expenses WHERE id=v_exp;
  DELETE FROM public.accounts WHERE id=v_acc;
  DELETE FROM public.whatsapp_links WHERE phone_e164 IN (v_phone, v_phone2);
  DELETE FROM public.user_pseudonyms WHERE user_id IN (v_owner, v_part, v_out, v_dup);
  DELETE FROM public.profiles WHERE id IN (v_owner, v_part, v_out, v_dup);
  DELETE FROM auth.users WHERE id IN (v_owner, v_part, v_out, v_dup);
  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._test_split_link_matrix() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._test_split_link_matrix() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._test_split_link_matrix() FROM anon;
GRANT  EXECUTE ON FUNCTION public._test_split_link_matrix() TO service_role;