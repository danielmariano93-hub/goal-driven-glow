CREATE OR REPLACE FUNCTION public.split_delete(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  se record;
  received numeric;
  tx_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;

  SELECT * INTO se
    FROM public.shared_expenses
   WHERE id = p_id AND owner_user_id = uid
   FOR UPDATE;

  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;

  SELECT coalesce(sum(amount_paid), 0) INTO received
    FROM public.shared_expense_participants
   WHERE shared_expense_id = p_id
     AND owner_user_id = uid
     AND phone_e164 IS NOT NULL;

  IF received > 0 THEN
    RAISE EXCEPTION 'Há pagamentos recebidos; cancele para preservar o histórico financeiro';
  END IF;

  SELECT t.id INTO tx_id
    FROM public.transactions t
   WHERE t.user_id = uid
     AND t.split_transaction_role = 'original_expense'
     AND (t.id = se.linked_transaction_id OR t.shared_expense_id = p_id)
   ORDER BY CASE WHEN t.id = se.linked_transaction_id THEN 0 ELSE 1 END
   LIMIT 1
   FOR UPDATE;

  UPDATE public.shared_expenses
     SET status = 'cancelled',
         deleted_at = coalesce(deleted_at, now()),
         cancelled_at = coalesce(cancelled_at, now()),
         cancellation_reason = 'Excluída pelo usuário',
         linked_transaction_id = NULL,
         updated_at = now()
   WHERE id = p_id;

  UPDATE public.reminder_jobs
     SET status = 'skipped',
         last_error = 'split_deleted',
         lease_expires_at = NULL,
         updated_at = now()
   WHERE shared_expense_id = p_id
     AND status IN ('queued', 'processing', 'enqueued');

  UPDATE public.outbound_messages o
     SET status = 'dead',
         last_error = 'split_deleted',
         claimed_at = NULL,
         lease_expires_at = NULL,
         updated_at = now()
    FROM public.reminder_jobs j
   WHERE j.shared_expense_id = p_id
     AND j.outbound_message_id = o.id
     AND o.status IN ('queued', 'processing', 'failed');

  DELETE FROM public.transactions
   WHERE user_id = uid
     AND split_transaction_role = 'original_expense'
     AND (shared_expense_id = p_id OR id = tx_id OR id = se.linked_transaction_id);

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
  VALUES(p_id, uid, 'deleted', jsonb_build_object('transaction_id', tx_id, 'soft_delete', true));
END $$;

REVOKE ALL ON FUNCTION public.split_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_delete(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.split_message_status(uuid);

CREATE FUNCTION public.split_message_status(p_id uuid)
RETURNS TABLE(
  participant_id uuid,
  job_id uuid,
  kind text,
  job_status text,
  outbound_status text,
  last_error text,
  attempts integer,
  scheduled_for timestamptz,
  updated_at timestamptz,
  outbound_attempts integer,
  last_attempt_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (j.participant_id)
    j.participant_id,
    j.id,
    j.kind,
    j.status::text,
    o.status::text,
    coalesce(o.last_error, j.last_error),
    coalesce(j.attempts, 0),
    j.scheduled_for,
    greatest(j.updated_at, coalesce(o.updated_at, j.updated_at)),
    coalesce(o.attempts::integer, 0),
    coalesce(o.claimed_at, o.sent_at, o.updated_at)
  FROM public.reminder_jobs j
  JOIN public.shared_expenses s ON s.id = j.shared_expense_id
  LEFT JOIN public.outbound_messages o ON o.id = j.outbound_message_id
  WHERE j.shared_expense_id = p_id
    AND s.owner_user_id = auth.uid()
  ORDER BY j.participant_id, j.updated_at DESC
$$;

REVOKE ALL ON FUNCTION public.split_message_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_message_status(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';