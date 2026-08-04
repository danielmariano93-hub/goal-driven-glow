GRANT EXECUTE ON FUNCTION public.nino_fix_money_text(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.nino_curate_items(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.nino_rebuild_items(uuid, text) TO postgres;

DO $do$
DECLARE u record;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM public.nino_intelligence_items LOOP
    PERFORM public.nino_curate_items(u.user_id);
  END LOOP;
END $do$;