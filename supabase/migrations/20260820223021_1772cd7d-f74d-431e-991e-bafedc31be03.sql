-- P0-A: financial_truth_changed writes to a non-existent "payload" column on
-- financial_performance_snapshots, which aborts EVERY write on the 14 tables
-- carrying tg_financial_truth_changed (transactions, debts, goals, cards...).
ALTER TABLE public.financial_performance_snapshots
  ADD COLUMN IF NOT EXISTS invalidation_reason text,
  ADD COLUMN IF NOT EXISTS invalidation_domains text[];

CREATE OR REPLACE FUNCTION public.financial_truth_changed(_user_id uuid, _reason text DEFAULT 'unknown'::text, _domains text[] DEFAULT ARRAY[]::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;

  UPDATE public.financial_performance_snapshots
     SET invalidated_at = now(),
         advisor_stale_at = now(),
         invalidation_reason = _reason,
         invalidation_domains = COALESCE(_domains, ARRAY[]::text[])
   WHERE user_id = _user_id AND invalidated_at IS NULL;
END;
$function$;

-- P0-B: queue rows closed as `no_longer_eligible` are terminal, so confirmed
-- transactions that are eligible again (or were closed by a race with the
-- enqueue trigger) never get categorized. Self-heal on every claim.
CREATE OR REPLACE FUNCTION public.claim_category_classification_batch(p_limit integer DEFAULT 100, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(queue_id uuid, transaction_id uuid, user_id uuid, type text, description text, movement_kind text, transfer_group_id uuid, settles_card_id uuid, shared_expense_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.category_classification_queue
     SET status='failed',locked_at=NULL,available_at=now(),last_error='stale_processing_lease',updated_at=now()
   WHERE status='processing' AND locked_at<now()-interval '5 minutes';

  -- Close queue rows that are no longer eligible instead of leasing them forever.
  UPDATE public.category_classification_queue q
     SET status='completed',processed_at=now(),locked_at=NULL,last_error='no_longer_eligible',updated_at=now()
   WHERE q.status IN ('queued','failed')
     AND NOT public.transaction_needs_categorization(q.transaction_id, q.user_id);

  -- Self-heal: reopen rows closed while the transaction still needs a category.
  UPDATE public.category_classification_queue q
     SET status='queued',attempts=0,available_at=now(),locked_at=NULL,processed_at=NULL,
         last_error='reopened_still_eligible',updated_at=now()
   WHERE q.status='completed'
     AND (p_user_id IS NULL OR q.user_id=p_user_id)
     AND public.transaction_needs_categorization(q.transaction_id, q.user_id);

  RETURN QUERY
  WITH picked AS (
    SELECT q.id
    FROM public.category_classification_queue q
    WHERE q.status IN ('queued','failed')
      AND q.attempts < 5
      AND q.available_at<=now()
      AND (p_user_id IS NULL OR q.user_id=p_user_id)
      AND public.transaction_needs_categorization(q.transaction_id, q.user_id)
    ORDER BY q.available_at,q.created_at
    FOR UPDATE OF q SKIP LOCKED
    LIMIT greatest(1,least(coalesce(p_limit,100),500))
  ), locked AS (
    UPDATE public.category_classification_queue q
       SET status='processing',locked_at=now(),attempts=q.attempts+1,updated_at=now()
      FROM picked p
     WHERE q.id=p.id
     RETURNING q.id,q.transaction_id,q.user_id
  )
  SELECT l.id,t.id,t.user_id,t.type::text,
    coalesce(t.friendly_description,t.raw_description,t.description),
    t.movement_kind,t.transfer_group_id,t.settles_card_id,t.shared_expense_id
  FROM locked l
  JOIN public.transactions t ON t.id=l.transaction_id AND t.user_id=l.user_id;
END $function$;