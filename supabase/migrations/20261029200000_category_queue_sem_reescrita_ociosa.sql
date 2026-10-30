-- O worker de categorização chama claim_category_classification_batch a cada minuto. A segunda UPDATE
-- reescrevia TODAS as linhas já concluídas ("no_longer_eligible") a cada chamada: ~52 milhões de
-- atualizações numa fila de ~1,1 mil linhas, que esgotaram o orçamento de E/S de disco do projeto.
-- Agora só atualiza o que ainda não está nesse estado terminal. O comportamento é o mesmo.
CREATE OR REPLACE FUNCTION public.claim_category_classification_batch(p_limit integer DEFAULT 100, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(queue_id uuid, transaction_id uuid, user_id uuid, type text, description text, movement_kind text, transfer_group_id uuid, settles_card_id uuid, shared_expense_id uuid, evidence_hash text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.category_classification_queue q
     SET status='failed', locked_at=NULL, available_at=now() + interval '5 minutes', last_error='stale_processing_lease', updated_at=now(), next_retry_reason='technical_retry'
   WHERE q.status='processing' AND q.locked_at < now()-interval '5 minutes';

  UPDATE public.category_classification_queue q
     SET status='completed', processed_at=now(), locked_at=NULL, last_error='no_longer_eligible', terminal_reason='no_longer_eligible', updated_at=now()
   WHERE q.status IN ('queued','failed','completed')
     AND NOT (q.status='completed' AND q.terminal_reason IS NOT DISTINCT FROM 'no_longer_eligible')
     AND (p_user_id IS NULL OR q.user_id=p_user_id)
     AND NOT public.transaction_needs_categorization(q.transaction_id, q.user_id);

  RETURN QUERY
  WITH eligible AS (
    SELECT q.id, public.category_transaction_evidence_hash(q.transaction_id, q.user_id) AS current_hash
    FROM public.category_classification_queue q
    WHERE q.status IN ('queued','failed')
      AND q.attempts < 5
      AND q.available_at <= now()
      AND (p_user_id IS NULL OR q.user_id=p_user_id)
      AND public.transaction_needs_categorization(q.transaction_id, q.user_id)
  ), picked AS (
    SELECT q.id, e.current_hash
    FROM public.category_classification_queue q
    JOIN eligible e ON e.id=q.id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_classification_attempts a
      WHERE a.transaction_id=q.transaction_id
        AND a.user_id=q.user_id
        AND a.evidence_hash=e.current_hash
        AND a.engine_version='categorization_truth.v2'
        AND a.status IN ('resolved','suggested','needs_review_until_new_evidence')
    )
    ORDER BY q.available_at,q.created_at
    FOR UPDATE OF q SKIP LOCKED
    LIMIT greatest(1,least(coalesce(p_limit,100),500))
  ), locked AS (
    UPDATE public.category_classification_queue q
       SET status='processing', locked_at=now(), attempts=q.attempts+1, updated_at=now(), evidence_hash=p.current_hash, terminal_reason=NULL
      FROM picked p
     WHERE q.id=p.id
     RETURNING q.id,q.transaction_id,q.user_id,q.evidence_hash
  )
  SELECT l.id,t.id,t.user_id,t.type::text,
    coalesce(t.friendly_description,t.raw_description,t.description),
    t.movement_kind,t.transfer_group_id,t.settles_card_id,t.shared_expense_id,l.evidence_hash
  FROM locked l
  JOIN public.transactions t ON t.id=l.transaction_id AND t.user_id=l.user_id;
END $function$;
