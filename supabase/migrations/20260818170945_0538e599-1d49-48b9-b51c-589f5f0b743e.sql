CREATE OR REPLACE FUNCTION public.canonical_merchant_token(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT nullif(
    regexp_replace(
      lower(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')),
      '[^a-z0-9 ]', '', 'g'
    ),
    ''
  );
$fn$;

ALTER TABLE public.credit_card_purchases
  ADD COLUMN IF NOT EXISTS merchant_canonical text,
  ADD COLUMN IF NOT EXISTS series_key text;

UPDATE public.credit_card_purchases
   SET merchant_canonical = public.canonical_merchant_token(merchant)
 WHERE merchant_canonical IS DISTINCT FROM public.canonical_merchant_token(merchant);

UPDATE public.credit_card_purchases
   SET series_key = concat_ws(
         '|',
         credit_card_id::text,
         coalesce(merchant_canonical, 'sem_estabelecimento'),
         greatest(1, coalesce(installments_total, 1))::text,
         round(coalesce(total_amount, 0), 2)::text
       )
 WHERE series_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_ccp_series_key
  ON public.credit_card_purchases (user_id, series_key);

CREATE TABLE IF NOT EXISTS public.card_reconciliation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credit_card_id uuid,
  event_kind text NOT NULL,
  purchase_id uuid,
  installment_id uuid,
  transaction_id uuid,
  statement_id uuid,
  competence_before date,
  competence_after date,
  amount numeric,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.card_reconciliation_events TO authenticated;
GRANT ALL ON public.card_reconciliation_events TO service_role;

ALTER TABLE public.card_reconciliation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "card_reconciliation_events_own_read" ON public.card_reconciliation_events;
CREATE POLICY "card_reconciliation_events_own_read"
  ON public.card_reconciliation_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_cre_user_created
  ON public.card_reconciliation_events (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.match_card_installment(
  p_user_id uuid,
  p_credit_card_id uuid,
  p_merchant text,
  p_installments_total integer,
  p_total_amount numeric,
  p_legacy_group uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_series text;
  v_purchase uuid;
BEGIN
  IF p_legacy_group IS NOT NULL THEN
    SELECT id INTO v_purchase
      FROM public.credit_card_purchases
     WHERE user_id = p_user_id AND legacy_purchase_group_id = p_legacy_group
     LIMIT 1;
    IF v_purchase IS NOT NULL THEN
      RETURN v_purchase;
    END IF;
  END IF;

  v_series := concat_ws(
    '|',
    p_credit_card_id::text,
    coalesce(public.canonical_merchant_token(p_merchant), 'sem_estabelecimento'),
    greatest(1, coalesce(p_installments_total, 1))::text,
    round(coalesce(p_total_amount, 0), 2)::text
  );

  SELECT id INTO v_purchase
    FROM public.credit_card_purchases
   WHERE user_id = p_user_id
     AND series_key = v_series
   ORDER BY created_at
   LIMIT 1;

  RETURN v_purchase;
END;
$fn$;

REVOKE ALL ON FUNCTION public.match_card_installment(uuid, uuid, text, integer, numeric, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.match_card_installment(uuid, uuid, text, integer, numeric, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_card_purchase_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  NEW.merchant_canonical := public.canonical_merchant_token(NEW.merchant);
  NEW.series_key := concat_ws(
    '|',
    NEW.credit_card_id::text,
    coalesce(NEW.merchant_canonical, 'sem_estabelecimento'),
    greatest(1, coalesce(NEW.installments_total, 1))::text,
    round(coalesce(NEW.total_amount, 0), 2)::text
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_card_purchase_identity ON public.credit_card_purchases;
CREATE TRIGGER trg_card_purchase_identity
  BEFORE INSERT OR UPDATE ON public.credit_card_purchases
  FOR EACH ROW EXECUTE FUNCTION public.tg_card_purchase_identity();

CREATE OR REPLACE FUNCTION public.backfill_card_competence(
  p_user_id uuid DEFAULT NULL,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row record;
  v_target date;
  v_source text;
  v_changed integer := 0;
  v_scanned integer := 0;
BEGIN
  FOR v_row IN
    SELECT t.id, t.user_id, t.credit_card_id, t.amount,
           t.competence_date, t.purchase_date, t.occurred_at::date AS occurred_on,
           c.closing_day, c.due_day
      FROM public.transactions t
      JOIN public.credit_cards c ON c.id = t.credit_card_id
     WHERE t.credit_card_id IS NOT NULL
       AND coalesce(t.movement_kind, 'transaction') = 'transaction'
       AND coalesce(t.status::text, 'confirmed') = 'confirmed'
       AND (p_user_id IS NULL OR t.user_id = p_user_id)
  LOOP
    v_scanned := v_scanned + 1;
    v_target := NULL;
    v_source := NULL;

    SELECT date_trunc('month', s.competence_month)::date INTO v_target
      FROM public.credit_card_statement_items i
      JOIN public.credit_card_statements s ON s.id = i.statement_id
     WHERE i.transaction_id = v_row.id
     ORDER BY s.competence_month
     LIMIT 1;
    IF v_target IS NOT NULL THEN v_source := 'statement'; END IF;

    IF v_target IS NULL THEN
      SELECT date_trunc('month', ci.competence_month)::date INTO v_target
        FROM public.credit_card_installments ci
       WHERE ci.legacy_transaction_id = v_row.id
       LIMIT 1;
      IF v_target IS NOT NULL THEN v_source := 'installment'; END IF;
    END IF;

    IF v_target IS NULL AND coalesce(v_row.closing_day, 0) >= 1 THEN
      SELECT date_trunc('month', cy.competence_month)::date INTO v_target
        FROM public.card_cycle_for(
               v_row.closing_day::smallint,
               coalesce(v_row.due_day, v_row.closing_day)::smallint,
               coalesce(v_row.purchase_date, v_row.occurred_on)
             ) cy
       LIMIT 1;
      IF v_target IS NOT NULL THEN v_source := 'cycle'; END IF;
    END IF;

    IF v_target IS NULL THEN CONTINUE; END IF;

    IF date_trunc('month', coalesce(v_row.competence_date, v_row.occurred_on))::date = v_target THEN
      CONTINUE;
    END IF;

    v_changed := v_changed + 1;

    IF NOT p_dry_run THEN
      UPDATE public.transactions
         SET competence_date = v_target
       WHERE id = v_row.id;
    END IF;

    INSERT INTO public.card_reconciliation_events(
      user_id, credit_card_id, event_kind, transaction_id,
      competence_before, competence_after, amount, reason, evidence
    ) VALUES (
      v_row.user_id, v_row.credit_card_id,
      CASE WHEN p_dry_run THEN 'competence_backfill_preview' ELSE 'competence_backfill' END,
      v_row.id,
      date_trunc('month', coalesce(v_row.competence_date, v_row.occurred_on))::date,
      v_target, v_row.amount, v_source,
      jsonb_build_object('source', v_source, 'dry_run', p_dry_run)
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'scanned', v_scanned, 'changed', v_changed, 'dry_run', p_dry_run);
END;
$fn$;

REVOKE ALL ON FUNCTION public.backfill_card_competence(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.backfill_card_competence(uuid, boolean) TO service_role;