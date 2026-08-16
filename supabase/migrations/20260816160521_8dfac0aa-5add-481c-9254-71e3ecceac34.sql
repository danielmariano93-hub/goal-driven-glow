CREATE TABLE IF NOT EXISTS public.account_deletion_targets (
  table_name    text PRIMARY KEY,
  user_column   text NOT NULL,
  strategy      text NOT NULL DEFAULT 'delete' CHECK (strategy IN ('delete', 'anonymize', 'skip')),
  purge_order   int  NOT NULL DEFAULT 100,
  reason        text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.account_deletion_targets TO authenticated;
GRANT ALL ON public.account_deletion_targets TO service_role;
ALTER TABLE public.account_deletion_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_deletion_targets" ON public.account_deletion_targets;
CREATE POLICY "admin_read_deletion_targets" ON public.account_deletion_targets
  FOR SELECT TO authenticated USING (public.is_current_user_admin());
DROP POLICY IF EXISTS "service_all_deletion_targets" ON public.account_deletion_targets;
CREATE POLICY "service_all_deletion_targets" ON public.account_deletion_targets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.sync_account_deletion_targets()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $fn$
DECLARE
  v_count int := 0;
  rec record;
  v_strategy text;
  v_order int;
BEGIN
  FOR rec IN
    SELECT c.table_name::text AS table_name, c.column_name::text AS column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name IN ('user_id', 'owner_user_id')
      AND c.table_name NOT IN ('account_deletion_targets', 'account_deletion_requests')
  LOOP
    IF rec.table_name ~ '(audit|_log$|_logs$|_events$|ledger_corrections|security)' THEN
      v_strategy := 'anonymize';
      v_order := 900;
    ELSE
      v_strategy := 'delete';
      v_order := 100;
    END IF;

    INSERT INTO public.account_deletion_targets(table_name, user_column, strategy, purge_order, reason)
    VALUES (rec.table_name, rec.column_name, v_strategy, v_order,
            CASE WHEN v_strategy = 'anonymize' THEN 'trilha de auditoria: desvincula do usuario' ELSE NULL END)
    ON CONFLICT (table_name) DO UPDATE
      SET user_column = EXCLUDED.user_column, updated_at = now();
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $fn$;

REVOKE ALL ON FUNCTION public.sync_account_deletion_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_account_deletion_targets() TO service_role;

SELECT public.sync_account_deletion_targets();

UPDATE public.account_deletion_targets SET purge_order = 950 WHERE table_name = 'user_roles';

CREATE OR REPLACE FUNCTION public.purge_user_data(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $fn$
DECLARE
  rec record;
  v_removed bigint;
  v_report jsonb := '{}'::jsonb;
  v_sql text;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'missing_user'; END IF;
  PERFORM public.sync_account_deletion_targets();

  FOR rec IN
    SELECT table_name, user_column, strategy
    FROM public.account_deletion_targets
    WHERE strategy <> 'skip'
    ORDER BY purge_order, table_name
  LOOP
    BEGIN
      IF rec.strategy = 'anonymize' THEN
        v_sql := format('UPDATE public.%I SET %I = NULL WHERE %I = $1', rec.table_name, rec.user_column, rec.user_column);
      ELSE
        v_sql := format('DELETE FROM public.%I WHERE %I = $1', rec.table_name, rec.user_column);
      END IF;
      EXECUTE v_sql USING p_user_id;
      GET DIAGNOSTICS v_removed = ROW_COUNT;
      IF v_removed > 0 THEN
        v_report := v_report || jsonb_build_object(rec.table_name, v_removed);
      END IF;
    EXCEPTION WHEN others THEN
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE %I = $1', rec.table_name, rec.user_column) USING p_user_id;
        GET DIAGNOSTICS v_removed = ROW_COUNT;
        v_report := v_report || jsonb_build_object(rec.table_name, v_removed);
      EXCEPTION WHEN others THEN
        v_report := v_report || jsonb_build_object(rec.table_name, 'falhou');
      END;
    END;
  END LOOP;

  DELETE FROM public.profiles WHERE id = p_user_id;
  RETURN v_report;
END $fn$;

REVOKE ALL ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;

ALTER TABLE public.account_deletion_requests
  ADD COLUMN IF NOT EXISTS purge_report jsonb,
  ADD COLUMN IF NOT EXISTS self_service boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.user_request_deletion(p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $fn$
DECLARE v_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT id INTO v_id FROM public.account_deletion_requests
   WHERE user_id = v_uid AND status IN ('pending', 'approved', 'processing')
   ORDER BY requested_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.account_deletion_requests(user_id, reason, status, grace_period_ends_at, self_service)
  VALUES (v_uid, p_reason, 'approved'::deletion_status, now() + interval '3 days', true)
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

REVOKE ALL ON FUNCTION public.user_request_deletion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_request_deletion(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_cancel_deletion_request(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.account_deletion_requests
     SET status = 'cancelled', cancelled_at = now()
   WHERE id = p_id AND user_id = auth.uid()
     AND status IN ('pending', 'approved')
     AND (grace_period_ends_at IS NULL OR grace_period_ends_at > now());
  IF NOT FOUND THEN RAISE EXCEPTION 'cannot_cancel'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.user_cancel_deletion_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_cancel_deletion_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_process_deletion_request(p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $fn$
DECLARE r record; v_report jsonb;
BEGIN
  SELECT * INTO r FROM public.account_deletion_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF r.status = 'completed' THEN RETURN r.user_id; END IF;
  IF r.status NOT IN ('approved', 'processing') THEN RAISE EXCEPTION 'not_approved'; END IF;
  IF r.grace_period_ends_at IS NOT NULL AND r.grace_period_ends_at > now() THEN
    RAISE EXCEPTION 'grace_period_active';
  END IF;

  UPDATE public.account_deletion_requests SET status = 'processing' WHERE id = p_id;
  v_report := public.purge_user_data(r.user_id);
  UPDATE public.account_deletion_requests
     SET status = 'completed', processed_at = now(), purge_report = v_report
   WHERE id = p_id;
  RETURN r.user_id;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_process_deletion_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_process_deletion_request(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.due_deletion_requests(p_limit int DEFAULT 20)
RETURNS TABLE(id uuid, user_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = 'public' AS $fn$
  SELECT r.id, r.user_id
  FROM public.account_deletion_requests r
  WHERE r.status IN ('approved', 'processing')
    AND (r.grace_period_ends_at IS NULL OR r.grace_period_ends_at <= now())
  ORDER BY r.requested_at
  LIMIT GREATEST(p_limit, 1)
$fn$;
REVOKE ALL ON FUNCTION public.due_deletion_requests(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.due_deletion_requests(int) TO service_role;