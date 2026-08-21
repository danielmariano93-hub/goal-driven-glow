-- Nino Performance Architecture v2
-- Somente infraestrutura de leitura/invalidação. Não altera nenhuma fórmula
-- financeira e não reescreve lançamentos do ledger.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Read-model refresh queue: uma linha por usuário, coalescendo rajadas.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.financial_snapshot_refresh_queue (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  marked_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);

ALTER TABLE public.financial_snapshot_refresh_queue ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS financial_snapshot_refresh_queue_ready_idx
  ON public.financial_snapshot_refresh_queue (marked_at)
  WHERE locked_until IS NULL;

-- A fila é operacional e só é consumida por service-role/worker.
REVOKE ALL ON public.financial_snapshot_refresh_queue FROM anon, authenticated;

-- Realtime passa a observar a versão semântica, não cada UPDATE técnico do ledger.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'financial_ledger_versions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_ledger_versions;
  END IF;
END;
$do$;

-- Claim v2 dos fatos: carrega o `marked_at` que foi efetivamente reivindicado.
-- Se uma nova escrita chegar durante o cálculo, o worker antigo NÃO pode
-- marcar aquela versão mais nova como processada.
CREATE OR REPLACE FUNCTION public.finance_facts_claim_v2(
  p_limit integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE(user_id uuid, competence_month date, domains text[], attempts integer, claimed_marked_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT d.user_id, d.competence_month, d.marked_at
      FROM public.financial_dirty_periods d
     WHERE d.processed_at IS NULL
       AND (d.locked_until IS NULL OR d.locked_until < now())
       AND d.attempts < 6
     ORDER BY d.marked_at
     LIMIT greatest(1, least(coalesce(p_limit, 25), 200))
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.financial_dirty_periods t
       SET locked_until = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300))),
           attempts = t.attempts + 1
      FROM candidates c
     WHERE t.user_id = c.user_id AND t.competence_month = c.competence_month
    RETURNING t.user_id, t.competence_month, t.domains, t.attempts, c.marked_at
  )
  SELECT claimed.user_id, claimed.competence_month, claimed.domains, claimed.attempts, claimed.marked_at FROM claimed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finance_facts_mark_processed_v2(
  p_user uuid,
  p_month date,
  p_claimed_marked_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.financial_dirty_periods
     SET processed_at = now(), locked_until = NULL, last_error = NULL, attempts = 0
   WHERE user_id = p_user AND competence_month = p_month
     AND marked_at <= p_claimed_marked_at;
  IF NOT FOUND THEN
    UPDATE public.financial_dirty_periods
       SET locked_until = NULL
     WHERE user_id = p_user AND competence_month = p_month;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.finance_facts_claim_v2(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_facts_mark_processed_v2(uuid, date, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_facts_claim_v2(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_facts_mark_processed_v2(uuid, date, timestamptz) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) A função existente continua marcando fatos mensais, mas também agenda o
--    refresh do snapshot. Upsert coalesce 100 updates em UMA linha de fila.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- UPDATEs puramente técnicos da categorização não alteram verdade financeira.
  -- O trigger BEFORE também incrementa `version`/`updated_at`; removemos esses
  -- campos junto da metadata para comparar somente o conteúdo semanticamente útil.
  IF TG_TABLE_NAME = 'transactions' AND TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY[
      'updated_at','version','category_source','category_confidence','category_reason',
      'category_engine_version','category_classified_at','category_decision_id',
      'category_review_status'
    ]::text[]) = (to_jsonb(OLD) - ARRAY[
      'updated_at','version','category_source','category_confidence','category_reason',
      'category_engine_version','category_classified_at','category_decision_id',
      'category_review_status'
    ]::text[]) THEN
      RETURN NULL;
    END IF;
  END IF;

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
        attempts = 0,
        last_error = NULL,
        domains = (
          SELECT array_agg(DISTINCT x) FROM unnest(d.domains || ARRAY[domain]) AS t(x)
        );

  INSERT INTO public.financial_snapshot_refresh_queue AS q (user_id, marked_at, locked_until, attempts, last_error)
  VALUES (uid, now(), NULL, 0, NULL)
  ON CONFLICT (user_id) DO UPDATE
    SET marked_at = now(), last_error = NULL;

  RETURN NULL;
END;
$function$;

-- Mudanças que afetam a Home mas não exigem recomputar fatos mensais também
-- precisam invalidar o read cache e agendar materialização.
CREATE OR REPLACE FUNCTION public.bump_financial_read_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid;
  row_json jsonb;
BEGIN
  row_json := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  uid := NULLIF(row_json ->> 'user_id', '')::uuid;
  IF uid IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  INSERT INTO public.financial_ledger_versions AS v (user_id, version, updated_at)
  VALUES (uid, 1, now())
  ON CONFLICT (user_id) DO UPDATE
    SET version = v.version + 1, updated_at = now();

  INSERT INTO public.financial_snapshot_refresh_queue AS q (user_id, marked_at, locked_until, attempts, last_error)
  VALUES (uid, now(), NULL, 0, NULL)
  ON CONFLICT (user_id) DO UPDATE
    SET marked_at = now(), last_error = NULL;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

DO $do$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'goals','category_spending_goals','investments','investment_movements',
    'debts','recurring_rules','user_financial_settings','credit_cards','accounts','categories'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_perf_read_version_%I ON public.%I', table_name, table_name);
      EXECUTE format(
        'CREATE TRIGGER trg_perf_read_version_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_financial_read_version()',
        table_name, table_name
      );
    END IF;
  END LOOP;
END;
$do$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Claim seguro. Usuário só sai da fila quando os fatos mensais dele não têm
--    mais período pendente; isso evita materializar Home sobre carry velho.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finance_snapshot_refresh_claim(
  p_limit integer DEFAULT 12,
  p_lease_seconds integer DEFAULT 180
)
RETURNS TABLE(user_id uuid, claimed_marked_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT q.user_id, q.marked_at
    FROM public.financial_snapshot_refresh_queue q
    WHERE (q.locked_until IS NULL OR q.locked_until < now())
      AND NOT EXISTS (
        SELECT 1 FROM public.financial_dirty_periods d
        WHERE d.user_id = q.user_id AND d.processed_at IS NULL
      )
    ORDER BY q.marked_at
    LIMIT greatest(1, least(coalesce(p_limit, 12), 30))
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.financial_snapshot_refresh_queue q
       SET locked_until = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 180))),
           attempts = q.attempts + 1
      FROM candidates c
     WHERE q.user_id = c.user_id
    RETURNING q.user_id, q.marked_at
  )
  SELECT claimed.user_id, claimed.marked_at FROM claimed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finance_snapshot_refresh_done(
  p_user uuid,
  p_claimed_marked_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.financial_snapshot_refresh_queue
   WHERE user_id = p_user AND marked_at <= p_claimed_marked_at;
  UPDATE public.financial_snapshot_refresh_queue
     SET locked_until = NULL
   WHERE user_id = p_user;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finance_snapshot_refresh_failed(p_user uuid, p_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.financial_snapshot_refresh_queue
     SET locked_until = NULL, last_error = left(coalesce(p_error, 'unknown'), 500)
   WHERE user_id = p_user;
END;
$function$;

REVOKE ALL ON FUNCTION public.finance_snapshot_refresh_claim(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_snapshot_refresh_done(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finance_snapshot_refresh_failed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_snapshot_refresh_claim(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_snapshot_refresh_done(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_snapshot_refresh_failed(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.finance_snapshot_refresh_enqueue_all()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE affected integer;
BEGIN
  INSERT INTO public.financial_snapshot_refresh_queue AS q (user_id, marked_at, attempts, last_error)
  SELECT id, now(), 0, NULL FROM auth.users
  ON CONFLICT (user_id) DO UPDATE SET marked_at = excluded.marked_at, last_error = NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;
REVOKE ALL ON FUNCTION public.finance_snapshot_refresh_enqueue_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finance_snapshot_refresh_enqueue_all() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Índices das leituras que ainda são listas reais.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS goal_contributions_user_goal_date_idx
  ON public.goal_contributions (user_id, goal_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS credit_card_statements_user_month_idx
  ON public.credit_card_statements (user_id, competence_month DESC);

CREATE INDEX IF NOT EXISTS credit_card_installments_user_month_idx
  ON public.credit_card_installments (user_id, competence_month DESC)
  WHERE status NOT IN ('paid', 'refunded', 'cancelled', 'reversed', 'anticipated');

COMMENT ON TABLE public.financial_current_snapshots IS
  'Read model materializado da verdade financeira canônica. Payload versionado; nunca é fonte de escrita do ledger.';
COMMENT ON TABLE public.financial_monthly_facts IS
  'Fatos mensais derivados do ledger canônico para leituras O(janela), nunca O(histórico total).';

-- Pré-aquece os usuários existentes de forma limitada pelo worker (12/min).
INSERT INTO public.financial_snapshot_refresh_queue (user_id, marked_at)
SELECT id, now() FROM auth.users
ON CONFLICT (user_id) DO UPDATE SET marked_at = excluded.marked_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Worker de snapshot. Usa o mesmo segredo/host já utilizado pelos workers
--    existentes do projeto; nada exige acesso manual ao painel Supabase.
--    Um enqueue diário após a virada de data evita que projeções dependentes de
--    `today` só sejam atualizadas quando o primeiro usuário abrir o app.
-- ─────────────────────────────────────────────────────────────────────────────
DO $do$
DECLARE existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'finance-current-snapshot-worker-1m' LIMIT 1;
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
  SELECT jobid INTO existing_job FROM cron.job WHERE jobname = 'finance-current-snapshot-prewarm-daily' LIMIT 1;
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
END;
$do$;

SELECT cron.schedule(
  'finance-current-snapshot-prewarm-daily',
  '5 3 * * *',
  $cron$ SELECT public.finance_snapshot_refresh_enqueue_all(); $cron$
);

SELECT cron.schedule(
  'finance-current-snapshot-worker-1m',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://wesjjdjmlnfjihkkgzfp.supabase.co/functions/v1/finance-current-snapshot-worker',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',coalesce((
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
          ORDER BY CASE name WHEN 'INTERNAL_CRON_SECRET' THEN 0 WHEN 'meunino_cron_secret' THEN 1 ELSE 2 END,
                   created_at DESC
          LIMIT 1
        ),'')
      ),
      body := jsonb_build_object('limit',12)
    );
  $cron$
);