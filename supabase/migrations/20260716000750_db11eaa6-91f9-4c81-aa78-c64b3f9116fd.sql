
-- =========================================================
-- 1. REVOGAR EXECUTE PÚBLICO E CONCEDER MÍNIMO NECESSÁRIO
-- =========================================================
-- Estratégia: remover PUBLIC e anon de todas as funções SECURITY DEFINER
-- e conceder por role de acordo com o uso pretendido.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', f.proname, f.args);
  END LOOP;
END $$;

-- Funções chamadas pelo cliente autenticado (usam auth.uid()):
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(text, numeric, income_frequency, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer(uuid, uuid, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_phone_link_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_whatsapp_link() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_whatsapp_link() TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_pending_action(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pending_action(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recurring_confirm(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recurring_skip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_add_payment(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_reverse_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_send_reminders(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_legacy_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_transactions_batch(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_export_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_request_deletion(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_challenge(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.challenge_progress_add(text, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_user_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_upsert(uuid, notification_type, text, text, text, text) TO service_role;

-- Funções de job/servidor: somente service_role
GRANT EXECUTE ON FUNCTION public.claim_outbound_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_outbound_sent(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_expired_outbound_leases() TO service_role;
GRANT EXECUTE ON FUNCTION public.recurring_generate_due(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_execute_confirmation(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_upsert_draft(uuid, uuid, text, jsonb, text, integer) TO service_role;

-- Funções admin (usam is_current_user_admin dentro; podem ser chamadas via authenticated)
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_prompt_version(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_agent_settings(text, numeric, smallint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_sim_enqueue(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_sim_reset(uuid) TO authenticated;

-- =========================================================
-- 2. DIVISÃO PERSONALIZADA: proprietário separado
-- =========================================================
CREATE OR REPLACE FUNCTION public.split_create(
  p_title text,
  p_total numeric,
  p_occurred_at date,
  p_due_date date,
  p_split_mode split_mode,
  p_include_owner boolean,
  p_reminder_enabled boolean,
  p_pix_key text,
  p_participants jsonb,
  p_owner_amount numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  new_id uuid;
  n_participants int;
  base_cents bigint;
  total_cents bigint;
  remainder bigint;
  it jsonb;
  sum_cents bigint := 0;
  owner_cents bigint := 0;
  extra_cent int;
  owner_name text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_total IS NULL OR p_total <= 0 THEN RAISE EXCEPTION 'invalid total'; END IF;
  IF p_title IS NULL OR btrim(p_title) = '' THEN RAISE EXCEPTION 'invalid title'; END IF;

  n_participants := jsonb_array_length(coalesce(p_participants,'[]'::jsonb))
                    + CASE WHEN p_include_owner THEN 1 ELSE 0 END;
  IF n_participants < 1 THEN RAISE EXCEPTION 'no participants'; END IF;

  total_cents := round(p_total * 100)::bigint;

  IF p_split_mode = 'custom' THEN
    FOR it IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
      sum_cents := sum_cents + round(coalesce((it->>'amount_due')::numeric, 0) * 100)::bigint;
    END LOOP;
    IF p_include_owner THEN
      owner_cents := round(coalesce(p_owner_amount, 0) * 100)::bigint;
      sum_cents := sum_cents + owner_cents;
    END IF;
    IF sum_cents <> total_cents THEN
      RAISE EXCEPTION 'custom_sum_mismatch: expected %, got %', total_cents, sum_cents;
    END IF;
  END IF;

  INSERT INTO public.shared_expenses(owner_user_id,title,description,total_amount,occurred_at,due_date,split_mode,reminder_enabled,status,pix_key)
    VALUES (uid,p_title,NULL,p_total,coalesce(p_occurred_at,CURRENT_DATE),p_due_date,p_split_mode,coalesce(p_reminder_enabled,false),'active',nullif(btrim(coalesce(p_pix_key,'')),''))
    RETURNING id INTO new_id;

  IF p_split_mode = 'equal' THEN
    base_cents := total_cents / n_participants;
    remainder := total_cents - (base_cents * n_participants);
    IF p_include_owner THEN
      SELECT coalesce(display_name,'Você') INTO owner_name FROM public.profiles WHERE id = uid;
      extra_cent := CASE WHEN remainder > 0 THEN 1 ELSE 0 END;
      remainder := GREATEST(remainder - 1, 0);
      INSERT INTO public.shared_expense_participants(shared_expense_id,owner_user_id,name,amount_due,status,amount_paid,paid_at)
        VALUES (new_id, uid, coalesce(owner_name,'Você'), (base_cents + extra_cent)::numeric/100, 'paid', (base_cents + extra_cent)::numeric/100, now());
    END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
      extra_cent := CASE WHEN remainder > 0 THEN 1 ELSE 0 END;
      remainder := GREATEST(remainder - 1, 0);
      INSERT INTO public.shared_expense_participants(
        shared_expense_id,owner_user_id,name,phone_e164,phone_masked,amount_due,opt_out_token
      ) VALUES (
        new_id, uid,
        coalesce(it->>'name','Participante'),
        nullif(it->>'phone_e164',''),
        CASE WHEN it->>'phone_e164' IS NOT NULL THEN regexp_replace(it->>'phone_e164','^(\+\d{2})\d+(\d{4})$','\1****\2') END,
        (base_cents + extra_cent)::numeric/100,
        encode(gen_random_bytes(16),'hex')
      );
    END LOOP;
  ELSE -- custom
    IF p_include_owner THEN
      SELECT coalesce(display_name,'Você') INTO owner_name FROM public.profiles WHERE id = uid;
      INSERT INTO public.shared_expense_participants(shared_expense_id,owner_user_id,name,amount_due,status,amount_paid,paid_at)
        VALUES (new_id, uid, coalesce(owner_name,'Você'), owner_cents::numeric/100, 'paid', owner_cents::numeric/100, now());
    END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
      INSERT INTO public.shared_expense_participants(
        shared_expense_id,owner_user_id,name,phone_e164,phone_masked,amount_due,opt_out_token
      ) VALUES (
        new_id, uid,
        coalesce(it->>'name','Participante'),
        nullif(it->>'phone_e164',''),
        CASE WHEN it->>'phone_e164' IS NOT NULL THEN regexp_replace(it->>'phone_e164','^(\+\d{2})\d+(\d{4})$','\1****\2') END,
        coalesce((it->>'amount_due')::numeric,0),
        encode(gen_random_bytes(16),'hex')
      );
    END LOOP;
  END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,event_type,payload)
    VALUES (new_id, uid, 'created', jsonb_build_object('total',p_total,'mode',p_split_mode));

  RETURN new_id;
END $function$;

REVOKE ALL ON FUNCTION public.split_create(text,numeric,date,date,split_mode,boolean,boolean,text,jsonb,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_create(text,numeric,date,date,split_mode,boolean,boolean,text,jsonb,numeric) TO authenticated;

-- =========================================================
-- 3. ACCOUNT DELETION — MÁQUINA DE ESTADOS
-- =========================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='deletion_status') THEN
    CREATE TYPE public.deletion_status AS ENUM ('pending','approved','processing','completed','rejected','cancelled');
  END IF;
END $$;

ALTER TABLE public.account_deletion_requests
  ADD COLUMN IF NOT EXISTS status_new deletion_status,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_by uuid,
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

UPDATE public.account_deletion_requests
  SET status_new = COALESCE(NULLIF(status,'')::deletion_status, 'pending'::deletion_status)
  WHERE status_new IS NULL;

ALTER TABLE public.account_deletion_requests DROP COLUMN IF EXISTS status;
ALTER TABLE public.account_deletion_requests RENAME COLUMN status_new TO status;
ALTER TABLE public.account_deletion_requests ALTER COLUMN status SET DEFAULT 'pending'::deletion_status;
ALTER TABLE public.account_deletion_requests ALTER COLUMN status SET NOT NULL;

DROP POLICY IF EXISTS "users manage own deletion requests" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "users select own deletion requests" ON public.account_deletion_requests;
DROP POLICY IF EXISTS "admin all deletion requests" ON public.account_deletion_requests;

CREATE POLICY "users_view_own_deletion" ON public.account_deletion_requests
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admin_view_all_deletion" ON public.account_deletion_requests
  FOR SELECT TO authenticated USING (public.is_current_user_admin());

-- INSERT/UPDATE via RPC apenas (nenhuma política de escrita para authenticated diretamente)
CREATE POLICY "service_all_deletion" ON public.account_deletion_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.user_cancel_deletion_request(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.account_deletion_requests
    SET status = 'cancelled', cancelled_at = now()
    WHERE id = p_id AND user_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'cannot_cancel'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.user_cancel_deletion_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_cancel_deletion_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_approve_deletion_request(p_id uuid, p_notes text, p_grace_days int DEFAULT 7)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  UPDATE public.account_deletion_requests
    SET status = 'approved',
        admin_notes = p_notes,
        processed_by = auth.uid(),
        grace_period_ends_at = now() + make_interval(days => GREATEST(p_grace_days, 0))
    WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found_or_bad_state'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_approve_deletion_request(uuid,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_deletion_request(uuid,text,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reject_deletion_request(p_id uuid, p_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  IF NOT public.is_current_user_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  UPDATE public.account_deletion_requests
    SET status = 'rejected', admin_notes = p_notes, processed_by = auth.uid(), processed_at = now()
    WHERE id = p_id AND status IN ('pending','approved');
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found_or_bad_state'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_reject_deletion_request(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reject_deletion_request(uuid,text) TO authenticated;

-- Processamento server-side (service_role via edge function)
CREATE OR REPLACE FUNCTION public.admin_process_deletion_request(p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.account_deletion_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r.status NOT IN ('approved') THEN RAISE EXCEPTION 'not_approved'; END IF;
  IF r.grace_period_ends_at IS NOT NULL AND r.grace_period_ends_at > now() THEN
    RAISE EXCEPTION 'grace_period_active';
  END IF;
  UPDATE public.account_deletion_requests SET status='processing' WHERE id = p_id;

  -- anonimizar/apagar em ordem segura (RLS neutralizada por SECURITY DEFINER)
  DELETE FROM public.transactions WHERE user_id = r.user_id;
  DELETE FROM public.goal_contributions WHERE user_id = r.user_id;
  DELETE FROM public.goals WHERE user_id = r.user_id;
  DELETE FROM public.debts WHERE user_id = r.user_id;
  DELETE FROM public.investments WHERE user_id = r.user_id;
  DELETE FROM public.recurring_occurrences WHERE user_id = r.user_id;
  DELETE FROM public.recurring_rules WHERE user_id = r.user_id;
  DELETE FROM public.emotional_checkins WHERE user_id = r.user_id;
  DELETE FROM public.shared_expenses WHERE owner_user_id = r.user_id;
  DELETE FROM public.notifications WHERE user_id = r.user_id;
  DELETE FROM public.pending_confirmations WHERE user_id = r.user_id;
  DELETE FROM public.conversation_messages WHERE user_id = r.user_id;
  DELETE FROM public.conversations WHERE user_id = r.user_id;
  DELETE FROM public.whatsapp_links WHERE user_id = r.user_id;
  DELETE FROM public.user_challenges WHERE user_id = r.user_id;
  DELETE FROM public.user_gamification WHERE user_id = r.user_id;
  DELETE FROM public.xp_events WHERE user_id = r.user_id;
  DELETE FROM public.user_financial_settings WHERE user_id = r.user_id;
  DELETE FROM public.categories WHERE user_id = r.user_id;
  DELETE FROM public.accounts WHERE user_id = r.user_id;
  DELETE FROM public.user_roles WHERE user_id = r.user_id;
  DELETE FROM public.profiles WHERE id = r.user_id;

  UPDATE public.account_deletion_requests
    SET status='completed', processed_at = now()
    WHERE id = p_id;
  RETURN r.user_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_process_deletion_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_process_deletion_request(uuid) TO service_role;

-- =========================================================
-- 4. CLAIM ATÔMICO DE REMINDER JOBS
-- =========================================================
ALTER TYPE public.reminder_status ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE public.reminder_status ADD VALUE IF NOT EXISTS 'enqueued';

ALTER TABLE public.reminder_jobs
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS reminder_jobs_idem_key
  ON public.reminder_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
