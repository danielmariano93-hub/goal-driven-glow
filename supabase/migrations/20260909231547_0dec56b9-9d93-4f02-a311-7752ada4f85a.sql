CREATE OR REPLACE FUNCTION public.tg_transactions_resolve_tips()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.category_id IS NOT NULL AND OLD.category_id IS NULL THEN
    UPDATE public.user_insights
      SET status = 'resolved', resolved_at = now()
    WHERE user_id = NEW.user_id
      AND status = 'active'
      AND (evidence->>'transaction_id') = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$function$;