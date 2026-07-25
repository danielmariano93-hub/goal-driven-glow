
-- ============================================================
-- Onda 1.a — auto-fill de competence_date em despesas de cartão
-- ============================================================
-- Rede de segurança: qualquer INSERT em transactions com credit_card_id
-- não-nulo e competence_date NULL passa a herdar a competência do cartão
-- via credit_card_competence(closing_day, occurred_at). Corrige o gap do
-- formulário manual e de qualquer path que esqueça o campo.

CREATE OR REPLACE FUNCTION public.transactions_fill_competence_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closing int;
BEGIN
  IF NEW.credit_card_id IS NOT NULL AND NEW.competence_date IS NULL THEN
    SELECT closing_day INTO v_closing
      FROM public.credit_cards
      WHERE id = NEW.credit_card_id;
    IF v_closing IS NOT NULL AND NEW.occurred_at IS NOT NULL THEN
      NEW.competence_date := public.credit_card_competence(v_closing, NEW.occurred_at::date);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.transactions_fill_competence_date() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transactions_fill_competence_date() TO service_role;

DROP TRIGGER IF EXISTS trg_transactions_fill_competence_date ON public.transactions;
CREATE TRIGGER trg_transactions_fill_competence_date
  BEFORE INSERT OR UPDATE OF credit_card_id, occurred_at
  ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.transactions_fill_competence_date();

-- Backfill idempotente para linhas existentes que ainda não têm competência
-- e possuem cartão. Não toca em pagamentos de fatura (settles_card_id).
UPDATE public.transactions t
   SET competence_date = public.credit_card_competence(cc.closing_day, t.occurred_at::date)
  FROM public.credit_cards cc
 WHERE t.credit_card_id = cc.id
   AND t.competence_date IS NULL
   AND t.occurred_at IS NOT NULL;

-- ============================================================
-- Onda 1.b — watchdog cron para o worker whatsapp-send
-- ============================================================
-- O webhook chama whatsapp-send de forma "fire-and-forget" via
-- EdgeRuntime.waitUntil. Se o isolate for suspenso ou o fetch falhar
-- silenciosamente, a linha em outbound_messages fica "queued" para sempre.
-- Este tick roda a cada minuto, chama whatsapp-send com o secret interno
-- e força um novo claim_outbound_batch. É idempotente (SKIP LOCKED),
-- reentrante e best-effort — se o secret não existir, não faz nada.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.whatsapp_send_dispatch_tick()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  secret_value text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret INTO secret_value
    FROM vault.decrypted_secrets
   WHERE name = 'nocontrole_cron_secret'
   ORDER BY created_at DESC
   LIMIT 1;
  IF nullif(secret_value, '') IS NULL THEN
    RETURN NULL;
  END IF;

  -- Só dispara se realmente existir trabalho pendente — evita ruído no log.
  IF NOT EXISTS (
    SELECT 1 FROM public.outbound_messages
     WHERE status IN ('queued','processing')
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
     LIMIT 1
  ) THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/whatsapp-send',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret', secret_value
    ),
    body := jsonb_build_object('source','pg_cron')
  ) INTO request_id;
  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_send_dispatch_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_send_dispatch_tick() TO service_role;

DO $$
DECLARE existing_job bigint;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'whatsapp-send-dispatch-1m'
  LOOP
    PERFORM cron.unschedule(existing_job);
  END LOOP;
  PERFORM cron.schedule(
    'whatsapp-send-dispatch-1m',
    '* * * * *',
    'SELECT public.whatsapp_send_dispatch_tick()'
  );
END $$;

NOTIFY pgrst, 'reload schema';
