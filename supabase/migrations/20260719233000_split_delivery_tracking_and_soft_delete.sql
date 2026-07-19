-- Divisão do Rolê: exclusão auditável, fila acionável e tracking confiável.

ALTER TABLE public.shared_expenses
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS shared_expenses_owner_visible_idx
  ON public.shared_expenses(owner_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Migra divisões cujo lançamento já foi removido. Elas somem da aba "Todas",
-- mas continuam em "Canceladas" com o rótulo "Excluída" para auditoria.
UPDATE public.shared_expenses se
   SET deleted_at = coalesce(se.cancelled_at, (
         SELECT max(ev.created_at) FROM public.shared_expense_events ev
          WHERE ev.shared_expense_id = se.id
            AND ev.event_type = 'cancelled'
            AND coalesce((ev.payload->>'transaction_removed')::boolean, false)
       ), now()),
       cancellation_reason = coalesce(se.cancellation_reason, 'Lançamento financeiro excluído')
 WHERE se.status = 'cancelled'
   AND se.deleted_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.shared_expense_events ev
      WHERE ev.shared_expense_id = se.id
        AND ev.event_type = 'cancelled'
        AND coalesce((ev.payload->>'transaction_removed')::boolean, false)
   );

-- Claim restrito: o clique do usuário só pode adiantar os próprios convites.
CREATE OR REPLACE FUNCTION public.claim_reminder_jobs_for_owner(
  p_owner_user_id uuid,
  p_limit integer DEFAULT 10
) RETURNS SETOF public.reminder_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur_hour integer;
BEGIN
  IF p_owner_user_id IS NULL THEN RETURN; END IF;
  cur_hour := extract(hour FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer;
  IF cur_hour < 8 OR cur_hour >= 22 THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.reminder_jobs r
       SET status = 'processing'::public.reminder_status,
           attempts = coalesce(r.attempts, 0) + 1,
           lease_expires_at = now() + interval '2 minutes',
           updated_at = now()
     WHERE r.id IN (
       SELECT q.id FROM public.reminder_jobs q
        WHERE q.owner_user_id = p_owner_user_id
          AND (q.status = 'queued'::public.reminder_status
               OR (q.status = 'processing'::public.reminder_status AND q.lease_expires_at < now()))
          AND q.scheduled_for <= now()
          AND coalesce(q.attempts, 0) < 5
        ORDER BY q.scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT greatest(1, least(coalesce(p_limit, 10), 20))
     )
     RETURNING r.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_reminder_jobs_for_owner(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reminder_jobs_for_owner(uuid, integer) TO service_role;

-- Exclusão lógica coordenada. Apaga o efeito financeiro, interrompe mensagens e
-- preserva participantes/eventos somente para rastreabilidade.
CREATE OR REPLACE FUNCTION public.split_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  se record;
  received numeric;
  tx_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  SELECT * INTO se FROM public.shared_expenses
   WHERE id = p_id AND owner_user_id = uid FOR UPDATE;
  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;

  SELECT coalesce(sum(amount_paid), 0) INTO received
    FROM public.shared_expense_participants
   WHERE shared_expense_id = p_id AND phone_e164 IS NOT NULL;
  IF received > 0 THEN
    RAISE EXCEPTION 'Há pagamentos recebidos; cancele para preservar o histórico financeiro';
  END IF;

  SELECT t.id INTO tx_id FROM public.transactions t
   WHERE t.user_id = uid
     AND t.split_transaction_role = 'original_expense'
     AND (t.id = se.linked_transaction_id OR t.shared_expense_id = p_id)
   ORDER BY CASE WHEN t.id = se.linked_transaction_id THEN 0 ELSE 1 END LIMIT 1;

  UPDATE public.shared_expenses
     SET status = 'cancelled', deleted_at = now(), cancelled_at = coalesce(cancelled_at, now()),
         cancellation_reason = 'Excluída pelo usuário', linked_transaction_id = NULL, updated_at = now()
   WHERE id = p_id;
  UPDATE public.reminder_jobs SET status = 'skipped', last_error = 'split_deleted',
         lease_expires_at = NULL, updated_at = now()
   WHERE shared_expense_id = p_id AND status IN ('queued','processing');
  DELETE FROM public.transactions
   WHERE user_id = uid AND shared_expense_id = p_id AND split_transaction_role = 'original_expense';
  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
  VALUES(p_id, uid, 'deleted', jsonb_build_object('transaction_id', tx_id, 'soft_delete', true));
END $$;
REVOKE ALL ON FUNCTION public.split_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_delete(uuid) TO authenticated;

-- Qualquer remoção legada do gasto original deixa a divisão coerente e marcada
-- como excluída, evitando um rolê ativo sem reflexo nas movimentações.
CREATE OR REPLACE FUNCTION public.sync_split_after_original_transaction_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF old.shared_expense_id IS NOT NULL AND old.split_transaction_role = 'original_expense' THEN
    UPDATE public.shared_expenses
       SET status = 'cancelled', deleted_at = coalesce(deleted_at, now()),
           cancelled_at = coalesce(cancelled_at, now()), linked_transaction_id = NULL,
           cancellation_reason = coalesce(cancellation_reason, 'Lançamento financeiro excluído'), updated_at = now()
     WHERE id = old.shared_expense_id;
    UPDATE public.reminder_jobs SET status = 'skipped', last_error = 'split_deleted',
           lease_expires_at = NULL, updated_at = now()
     WHERE shared_expense_id = old.shared_expense_id AND status IN ('queued','processing');
  END IF;
  RETURN old;
END $$;
DROP TRIGGER IF EXISTS transactions_sync_split_after_delete ON public.transactions;
CREATE TRIGGER transactions_sync_split_after_delete
AFTER DELETE ON public.transactions FOR EACH ROW
EXECUTE FUNCTION public.sync_split_after_original_transaction_delete();

-- A função de status expõe tentativas e horário agendado para uma interface
-- realmente explicativa, sem revelar telefone ou conteúdo da mensagem.
DROP FUNCTION IF EXISTS public.split_message_status(uuid);
CREATE FUNCTION public.split_message_status(p_id uuid)
RETURNS TABLE(
  participant_id uuid, job_id uuid, kind text, job_status text, outbound_status text,
  last_error text, attempts integer, scheduled_for timestamptz, updated_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (j.participant_id)
    j.participant_id, j.id, j.kind, j.status::text, o.status::text,
    coalesce(o.last_error, j.last_error), coalesce(j.attempts, 0), j.scheduled_for,
    greatest(j.updated_at, coalesce(o.updated_at, j.updated_at))
  FROM public.reminder_jobs j
  JOIN public.shared_expenses s ON s.id = j.shared_expense_id
  LEFT JOIN public.outbound_messages o ON o.id = j.outbound_message_id
  WHERE j.shared_expense_id = p_id AND s.owner_user_id = auth.uid()
  ORDER BY j.participant_id, j.updated_at DESC
$$;
REVOKE ALL ON FUNCTION public.split_message_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_message_status(uuid) TO authenticated;

-- Retaguarda automática. O segredo fica no Vault, nunca no repositório. Assim
-- que `nocontrole_cron_secret` existir com o mesmo valor de CRON_SECRET das
-- Edge Functions, o tick passa a funcionar sem nova migration.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.split_message_pipeline_tick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, vault AS $$
DECLARE secret_value text; request_id bigint;
BEGIN
  SELECT decrypted_secret INTO secret_value
    FROM vault.decrypted_secrets
   WHERE name = 'nocontrole_cron_secret'
   ORDER BY created_at DESC LIMIT 1;
  IF nullif(secret_value, '') IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/split-reminders-dispatch',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',secret_value),
    body := jsonb_build_object('source','pg_cron')
  ) INTO request_id;
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.split_message_pipeline_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.split_message_pipeline_tick() TO service_role;

DO $$
DECLARE existing_job bigint;
BEGIN
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'split-message-pipeline-1m' LOOP
    PERFORM cron.unschedule(existing_job);
  END LOOP;
  PERFORM cron.schedule('split-message-pipeline-1m', '* * * * *', 'SELECT public.split_message_pipeline_tick()');
END $$;

NOTIFY pgrst, 'reload schema';
