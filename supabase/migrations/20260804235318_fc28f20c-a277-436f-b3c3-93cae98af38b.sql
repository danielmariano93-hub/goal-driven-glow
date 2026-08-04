DO $do$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='nino_rebuild_items';
  v_def := replace(v_def, 'Seus gastos aumentaram '' || public.nino_num(', 'Seus gastos aumentaram R$ '' || public.nino_num(');
  v_def := replace(v_def, 'Seus gastos caíram '' || public.nino_num(', 'Seus gastos caíram R$ '' || public.nino_num(');
  EXECUTE v_def;
END $do$;

UPDATE public.nino_intelligence_items
   SET title = regexp_replace(title, '^(Seus gastos (aumentaram|caíram)) (\d)', '\1 R$ \3'),
       updated_at = now()
 WHERE title ~ '^Seus gastos (aumentaram|caíram) \d';