-- ROLLBACK DE REFERÊNCIA — NINO PERFORMANCE ARCHITECTURE V2
-- NÃO É MIGRATION e NÃO deve ser executado junto do patch principal.
-- Se um rollback for necessário, reverta primeiro o código da aplicação e
-- transforme este conteúdo em uma NOVA migration forward-only pelo mesmo fluxo
-- GitHub/Lovable. Nenhum acesso manual ao painel Supabase é necessário.

DO $do$
DECLARE existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'finance-current-snapshot-worker-1m' LIMIT 1;
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'finance-current-snapshot-prewarm-daily' LIMIT 1;
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
END;
$do$;

DO $do$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'goals','category_spending_goals','investments','investment_movements',
    'debts','recurring_rules','user_financial_settings','credit_cards','accounts','categories'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_perf_read_version_%I ON public.%I', table_name, table_name);
    END IF;
  END LOOP;
END;
$do$;

-- Restaura a implementação anterior do dirty marking.
CREATE OR REPLACE FUNCTION public.mark_financial_ledger_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid;
  ref date;
  row_json jsonb;
  domain text;
BEGIN
  row_json := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  uid := NULLIF(row_json ->> 'user_id', '')::uuid;
  IF uid IS NULL THEN RETURN NULL; END IF;

  ref := COALESCE(
    NULLIF(row_json ->> 'competence_date', '')::date,
    NULLIF(row_json ->> 'competence_month', '')::date,
    NULLIF(row_json ->> 'occurred_at', '')::date,
    NULLIF(row_json ->> 'as_of', '')::date,
    CURRENT_DATE
  );

  domain := CASE TG_TABLE_NAME
    WHEN 'transactions' THEN 'ledger'
    WHEN 'account_balance_snapshots' THEN 'cash'
    WHEN 'goal_contributions' THEN 'goals'
    ELSE 'card'
  END;

  INSERT INTO public.financial_ledger_versions AS v (user_id, version, updated_at)
  VALUES (uid, 1, now())
  ON CONFLICT (user_id) DO UPDATE
    SET version = v.version + 1, updated_at = now();

  INSERT INTO public.financial_dirty_periods AS d
    (user_id, competence_month, marked_at, processed_at, domains)
  VALUES (uid, date_trunc('month', ref)::date, now(), NULL, ARRAY[domain])
  ON CONFLICT (user_id, competence_month) DO UPDATE
    SET marked_at = now(),
        processed_at = NULL,
        locked_until = NULL,
        domains = (
          SELECT array_agg(DISTINCT x) FROM unnest(d.domains || ARRAY[domain]) AS t(x)
        );
  RETURN NULL;
END;
$function$;

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'financial_ledger_versions'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.financial_ledger_versions;
  END IF;
END;
$do$;

DROP FUNCTION IF EXISTS public.finance_snapshot_refresh_claim(integer, integer);
DROP FUNCTION IF EXISTS public.finance_snapshot_refresh_done(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.finance_snapshot_refresh_failed(uuid, text);
DROP FUNCTION IF EXISTS public.finance_snapshot_refresh_enqueue_all();
DROP FUNCTION IF EXISTS public.bump_financial_read_version();
DROP FUNCTION IF EXISTS public.finance_facts_claim_v2(integer, integer);
DROP FUNCTION IF EXISTS public.finance_facts_mark_processed_v2(uuid, date, timestamptz);
DROP TABLE IF EXISTS public.financial_snapshot_refresh_queue;

-- Índices adicionados pelo patch podem permanecer: são não destrutivos e não
-- alteram semântica. `financial_current_snapshots` também é preservada.
