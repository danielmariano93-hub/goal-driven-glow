-- Single source of truth for categorization eligibility, used by the queue
-- worker (claim/close/reopen) and by the enqueue triggers.
CREATE OR REPLACE FUNCTION public.transaction_needs_categorization(_transaction_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.transactions t
     WHERE t.id = _transaction_id
       AND t.user_id = _user_id
       AND t.type IN ('income','expense')
       AND coalesce(t.movement_kind,'transaction') = 'transaction'
       AND coalesce(t.status::text,'confirmed') = 'confirmed'
       AND t.transfer_group_id IS NULL
       AND t.settles_card_id IS NULL
       AND t.shared_expense_id IS NULL
       AND NOT (
         t.category_id IS NOT NULL
         AND coalesce(t.category_source,'') IN ('user','personal','alias','history','global','rule')
       )
  );
$function$;

REVOKE ALL ON FUNCTION public.transaction_needs_categorization(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transaction_needs_categorization(uuid, uuid) TO service_role;