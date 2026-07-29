-- 1) Nova ação canônica: escrita de mensageria (templates/catálogo)
INSERT INTO public.platform_permissions (role, action, allowed) VALUES
  ('platform_owner','messaging.write',true),
  ('platform_admin','messaging.write',true),
  ('support','messaging.write',false),
  ('analyst','messaging.write',false)
ON CONFLICT (role, action) DO UPDATE SET allowed = EXCLUDED.allowed;

-- 2) Reescreve as funções que exigiam ações inexistentes (ops.read / ops.write)
DO $mig$
DECLARE
  r record;
  v_def text;
  v_target text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_communication_catalog',
        'admin_communication_templates',
        'admin_communication_catalog_update',
        'admin_communication_template_upsert',
        'admin_proactive_engine_status',
        'admin_proactive_queue',
        'admin_proactive_engine_toggle'
      )
  LOOP
    v_def := pg_get_functiondef(r.oid);

    v_target := CASE r.proname
      WHEN 'admin_communication_catalog' THEN 'messaging.read'
      WHEN 'admin_communication_templates' THEN 'messaging.read'
      WHEN 'admin_communication_catalog_update' THEN 'messaging.write'
      WHEN 'admin_communication_template_upsert' THEN 'messaging.write'
      WHEN 'admin_proactive_engine_status' THEN 'operations.read'
      WHEN 'admin_proactive_queue' THEN 'operations.read'
      WHEN 'admin_proactive_engine_toggle' THEN 'operations.write'
    END;

    v_def := replace(v_def, '_require_perm(''ops.read'')', '_require_perm(''' || v_target || ''')');
    v_def := replace(v_def, '_require_perm(''ops.write'')', '_require_perm(''' || v_target || ''')');

    EXECUTE v_def;
  END LOOP;
END
$mig$;

-- 3) admin_v2_proactive_summary não verificava permissão alguma
DO $mig2$
DECLARE
  v_oid oid;
  v_def text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_v2_proactive_summary'
  LIMIT 1;

  IF v_oid IS NULL THEN RETURN; END IF;

  v_def := pg_get_functiondef(v_oid);

  IF position('_require_perm' in v_def) = 0 THEN
    v_def := regexp_replace(
      v_def,
      E'\\nBEGIN\\n',
      E'\nBEGIN\n  PERFORM public._require_perm(''messaging.read'');\n',
      ''
    );
    EXECUTE v_def;
  END IF;
END
$mig2$;
