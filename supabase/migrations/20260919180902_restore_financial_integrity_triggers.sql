-- P0: uma operação anterior deixou praticamente todos os triggers
-- de usuário do schema public em estado DISABLED. Isso interrompeu invariantes
-- de escrita (ledger version, refresh queue, auditoria, categorização etc.).
--
-- O repositório não possui migrations que declarem esses triggers como
-- intencionalmente desativados. Portanto, a fonte de verdade esperada é todo
-- trigger de usuário criado por migration permanecer habilitado.
DO $migration$
DECLARE
  trigger_row record;
  disabled_count integer;
BEGIN
  FOR trigger_row IN
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           t.tgname AS trigger_name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND NOT t.tgisinternal
       AND t.tgenabled = 'D'
     ORDER BY c.relname, t.tgname
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE TRIGGER %I',
      trigger_row.schema_name,
      trigger_row.table_name,
      trigger_row.trigger_name
    );
  END LOOP;

  SELECT count(*)
    INTO disabled_count
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND NOT t.tgisinternal
     AND t.tgenabled = 'D';

  IF disabled_count <> 0 THEN
    RAISE EXCEPTION
      'financial integrity restore failed: % public user triggers remain disabled',
      disabled_count;
  END IF;
END
$migration$;

-- Escritas ocorridas enquanto os triggers estavam desligados não produziram a
-- invalidação do read model. Reagenda todos os usuários com dados financeiros;
-- o worker idempotente recompõe a fotografia sem alterar lançamentos.
WITH affected_users AS (
  SELECT user_id FROM public.accounts
  UNION
  SELECT user_id FROM public.transactions
  UNION
  SELECT user_id FROM public.account_balance_snapshots
  UNION
  SELECT user_id FROM public.credit_card_statements
  UNION
  SELECT user_id FROM public.investments
  UNION
  SELECT user_id FROM public.debts
)
INSERT INTO public.financial_ledger_versions AS versions (user_id, version, updated_at)
SELECT user_id, 1, now()
  FROM affected_users
 WHERE user_id IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
  SET version = versions.version + 1,
      updated_at = now();

WITH affected_users AS (
  SELECT user_id FROM public.accounts
  UNION
  SELECT user_id FROM public.transactions
  UNION
  SELECT user_id FROM public.account_balance_snapshots
  UNION
  SELECT user_id FROM public.credit_card_statements
  UNION
  SELECT user_id FROM public.investments
  UNION
  SELECT user_id FROM public.debts
)
INSERT INTO public.financial_snapshot_refresh_queue AS queue
  (user_id, marked_at, locked_until, attempts, last_error)
SELECT user_id, now(), NULL, 0, NULL
  FROM affected_users
 WHERE user_id IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
  SET marked_at = now(),
      locked_until = NULL,
      attempts = 0,
      last_error = NULL;
