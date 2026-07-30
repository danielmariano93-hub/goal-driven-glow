-- Meu Nino — núcleo contábil de cartões, faturas e dívidas.
-- A migration é aditiva e mantém transactions/debts legados compatíveis.

ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS installments_total integer,
  ADD COLUMN IF NOT EXISTS installments_paid integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contract_total_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS principal_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS first_due_date date,
  ADD COLUMN IF NOT EXISTS accounting_method text NOT NULL DEFAULT 'contractual_schedule',
  ADD COLUMN IF NOT EXISTS amount_was_inferred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS formula_version text NOT NULL DEFAULT 'debt_schedule.v1';

ALTER TABLE public.extracted_items
  ADD COLUMN IF NOT EXISTS historical_installments_paid_assumption boolean;

UPDATE public.debts
   SET contract_total_amount = coalesce(contract_total_amount, original_amount),
       principal_amount = coalesce(principal_amount, original_amount),
       installments_paid = greatest(0, coalesce(installments_paid, 0))
 WHERE contract_total_amount IS NULL
    OR principal_amount IS NULL;

ALTER TABLE public.debts
  ALTER COLUMN contract_total_amount SET NOT NULL,
  ALTER COLUMN principal_amount SET NOT NULL;

ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_installments_total_check;
ALTER TABLE public.debts ADD CONSTRAINT debts_installments_total_check
  CHECK (installments_total IS NULL OR installments_total BETWEEN 1 AND 600);
ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_installments_paid_check;
ALTER TABLE public.debts ADD CONSTRAINT debts_installments_paid_check
  CHECK (
    installments_paid >= 0
    AND (installments_total IS NULL OR installments_paid <= installments_total)
  );
ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_contract_total_check;
ALTER TABLE public.debts ADD CONSTRAINT debts_contract_total_check
  CHECK (contract_total_amount > 0 AND principal_amount > 0);
ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_accounting_method_check;
ALTER TABLE public.debts ADD CONSTRAINT debts_accounting_method_check
  CHECK (accounting_method IN ('contractual_schedule','open_balance','manual_reconciliation'));

CREATE TABLE IF NOT EXISTS public.debt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  paid_at date NOT NULL DEFAULT current_date,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  amount_applied numeric(14,2) NOT NULL CHECK (amount_applied >= 0),
  interest_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
  fee_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  installments_covered integer NOT NULL DEFAULT 0 CHECK (installments_covered >= 0),
  notes text,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT debt_payment_composition CHECK (
    round(amount_applied + interest_amount + fee_amount, 2) = round(amount, 2)
  ),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS debt_payments_debt_date_idx
  ON public.debt_payments(debt_id, paid_at DESC);
ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "debt_payments own rows" ON public.debt_payments;
CREATE POLICY "debt_payments own rows" ON public.debt_payments
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.debts d
       WHERE d.id = debt_id AND d.user_id = auth.uid()
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON public.debt_payments TO authenticated;
GRANT ALL ON public.debt_payments TO service_role;

-- Compra é o evento econômico único. Parcela e fatura são compromissos/liquidações.
CREATE TABLE IF NOT EXISTS public.credit_card_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_card_id uuid NOT NULL REFERENCES public.credit_cards(id) ON DELETE RESTRICT,
  merchant text NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  purchase_date date NOT NULL,
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  installments_total integer NOT NULL DEFAULT 1 CHECK (installments_total BETWEEN 1 AND 600),
  source text NOT NULL DEFAULT 'manual',
  source_document_id uuid REFERENCES public.document_imports(id) ON DELETE SET NULL,
  inferred_total boolean NOT NULL DEFAULT false,
  confidence numeric(5,4),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','refunded','cancelled')),
  legacy_purchase_group_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.credit_card_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL REFERENCES public.credit_card_purchases(id) ON DELETE CASCADE,
  credit_card_id uuid NOT NULL REFERENCES public.credit_cards(id) ON DELETE RESTRICT,
  installment_number integer NOT NULL CHECK (installment_number >= 1),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  competence_month date NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('historical_unconfirmed','scheduled','billed','paid','overdue','refunded','cancelled')),
  legacy_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_id, installment_number)
);

CREATE TABLE IF NOT EXISTS public.credit_card_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_card_id uuid NOT NULL REFERENCES public.credit_cards(id) ON DELETE RESTRICT,
  competence_month date NOT NULL,
  period_start date,
  period_end date,
  closing_date date,
  due_date date NOT NULL,
  stated_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (stated_total >= 0),
  reconciled_total numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  outstanding_amount numeric(14,2) GENERATED ALWAYS AS
    (greatest(0::numeric, stated_total - paid_amount)) STORED,
  reconciliation_difference numeric(14,2) GENERATED ALWAYS AS
    (round(stated_total - reconciled_total, 2)) STORED,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','needs_review','open','partially_paid','paid','overdue','refinanced','cancelled')),
  source_document_id uuid REFERENCES public.document_imports(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credit_card_id, competence_month)
);

CREATE TABLE IF NOT EXISTS public.credit_card_statement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  statement_id uuid NOT NULL REFERENCES public.credit_card_statements(id) ON DELETE CASCADE,
  installment_id uuid REFERENCES public.credit_card_installments(id) ON DELETE SET NULL,
  legacy_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  item_kind text NOT NULL DEFAULT 'purchase'
    CHECK (item_kind IN ('purchase','installment','refund','interest','fee','adjustment')),
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  occurred_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.credit_card_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_card_id uuid NOT NULL REFERENCES public.credit_cards(id) ON DELETE RESTRICT,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  paid_at date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.credit_card_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.credit_card_payments(id) ON DELETE CASCADE,
  statement_id uuid NOT NULL REFERENCES public.credit_card_statements(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, statement_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_card_purchases_legacy_group_unique
  ON public.credit_card_purchases(user_id, legacy_purchase_group_id)
  WHERE legacy_purchase_group_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_card_installments_legacy_tx_unique
  ON public.credit_card_installments(legacy_transaction_id)
  WHERE legacy_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_card_statement_items_legacy_tx_unique
  ON public.credit_card_statement_items(legacy_transaction_id)
  WHERE legacy_transaction_id IS NOT NULL;

-- Backfill conservador: cria a estrutura, mas marca faturas reconstruídas para revisão.
INSERT INTO public.credit_card_purchases(
  user_id, credit_card_id, merchant, category_id, purchase_date, total_amount,
  installments_total, source, inferred_total, status, legacy_purchase_group_id
)
SELECT
  t.user_id,
  t.credit_card_id,
  coalesce(max(nullif(t.description, '')), 'Compra importada'),
  (array_agg(t.category_id) FILTER (WHERE t.category_id IS NOT NULL))[1],
  min(coalesce(t.purchase_date, t.occurred_at::date)),
  sum(t.amount),
  greatest(1, max(coalesce(t.installments_total, 1))),
  'legacy_backfill',
  false,
  'active',
  coalesce(t.purchase_group_id, t.id)
FROM public.transactions t
WHERE t.credit_card_id IS NOT NULL
  AND t.type = 'expense'
  AND coalesce(t.status::text, 'confirmed') = 'confirmed'
  AND coalesce(t.movement_kind, 'transaction') = 'transaction'
GROUP BY t.user_id, t.credit_card_id, coalesce(t.purchase_group_id, t.id)
ON CONFLICT DO NOTHING;

INSERT INTO public.credit_card_installments(
  user_id, purchase_id, credit_card_id, installment_number, amount,
  competence_month, status, legacy_transaction_id
)
SELECT
  t.user_id,
  p.id,
  t.credit_card_id,
  coalesce(t.installment_number, 1),
  t.amount,
  date_trunc('month', coalesce(t.competence_date, t.occurred_at::date))::date,
  CASE
    WHEN coalesce(t.competence_date, t.occurred_at::date) < date_trunc('month', current_date)::date
      THEN 'historical_unconfirmed'
    ELSE 'scheduled'
  END,
  t.id
FROM public.transactions t
JOIN public.credit_card_purchases p
  ON p.user_id = t.user_id
 AND p.legacy_purchase_group_id = coalesce(t.purchase_group_id, t.id)
WHERE t.credit_card_id IS NOT NULL
  AND t.type = 'expense'
  AND coalesce(t.status::text, 'confirmed') = 'confirmed'
  AND coalesce(t.movement_kind, 'transaction') = 'transaction'
ON CONFLICT DO NOTHING;

INSERT INTO public.credit_card_statements(
  user_id, credit_card_id, competence_month, due_date, stated_total,
  reconciled_total, status
)
SELECT
  i.user_id,
  i.credit_card_id,
  i.competence_month,
  make_date(
    extract(year from i.competence_month)::int,
    extract(month from i.competence_month)::int,
    least(cc.due_day, extract(day from (date_trunc('month', i.competence_month) + interval '1 month - 1 day'))::int)
  ),
  sum(i.amount),
  sum(i.amount),
  'needs_review'
FROM public.credit_card_installments i
JOIN public.credit_cards cc ON cc.id = i.credit_card_id
GROUP BY i.user_id, i.credit_card_id, i.competence_month, cc.due_day
ON CONFLICT (credit_card_id, competence_month) DO NOTHING;

INSERT INTO public.credit_card_statement_items(
  user_id, statement_id, installment_id, legacy_transaction_id,
  item_kind, description, amount, occurred_at
)
SELECT
  i.user_id,
  s.id,
  i.id,
  i.legacy_transaction_id,
  CASE WHEN p.installments_total > 1 THEN 'installment' ELSE 'purchase' END,
  p.merchant,
  i.amount,
  p.purchase_date
FROM public.credit_card_installments i
JOIN public.credit_card_purchases p ON p.id = i.purchase_id
JOIN public.credit_card_statements s
  ON s.credit_card_id = i.credit_card_id
 AND s.competence_month = i.competence_month
WHERE NOT EXISTS (
  SELECT 1 FROM public.credit_card_statement_items existing
   WHERE existing.installment_id = i.id
);

-- Mantém a camada contábil sincronizada com todos os caminhos atuais
-- (formulário, assessor, WhatsApp e importação), que ainda gravam transactions.
CREATE OR REPLACE FUNCTION public.sync_card_accounting_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_purchase_id uuid;
  v_installment_id uuid;
  v_statement_id uuid;
  v_competence date;
  v_total numeric;
  v_due_day integer;
BEGIN
  IF NEW.credit_card_id IS NULL
     OR NEW.type::text <> 'expense'
     OR coalesce(NEW.status::text, 'confirmed') <> 'confirmed'
     OR coalesce(NEW.movement_kind, 'transaction') <> 'transaction' THEN
    RETURN NEW;
  END IF;

  v_group := coalesce(NEW.purchase_group_id, NEW.id);
  v_competence := date_trunc(
    'month', coalesce(NEW.competence_date, NEW.occurred_at::date)
  )::date;

  SELECT id INTO v_purchase_id
    FROM public.credit_card_purchases
   WHERE user_id = NEW.user_id AND legacy_purchase_group_id = v_group;

  IF v_purchase_id IS NULL THEN
    INSERT INTO public.credit_card_purchases(
      user_id, credit_card_id, merchant, category_id, purchase_date,
      total_amount, installments_total, source, inferred_total,
      legacy_purchase_group_id
    ) VALUES (
      NEW.user_id, NEW.credit_card_id,
      coalesce(nullif(NEW.description, ''), 'Compra no cartão'),
      NEW.category_id, coalesce(NEW.purchase_date, NEW.occurred_at::date),
      CASE WHEN coalesce(NEW.installments_total, 1) > 1
           THEN NEW.amount * NEW.installments_total ELSE NEW.amount END,
      greatest(1, coalesce(NEW.installments_total, 1)),
      coalesce(nullif(NEW.origin::text, ''), 'transaction_sync'),
      coalesce(NEW.installments_total, 1) > 1,
      v_group
    ) RETURNING id INTO v_purchase_id;
  ELSE
    UPDATE public.credit_card_purchases
       SET merchant = coalesce(nullif(NEW.description, ''), merchant),
           category_id = coalesce(NEW.category_id, category_id),
           updated_at = now()
     WHERE id = v_purchase_id;
  END IF;

  -- Uma fatura pode começar na parcela 4/10. Criamos o cronograma inteiro,
  -- mas o passado fica explicitamente não confirmado até o usuário responder.
  INSERT INTO public.credit_card_installments(
    user_id, purchase_id, credit_card_id, installment_number, amount,
    competence_month, status
  )
  SELECT
    NEW.user_id, v_purchase_id, NEW.credit_card_id, installment_no, NEW.amount,
    (
      v_competence
      + make_interval(
          months => (
            installment_no - greatest(1, coalesce(NEW.installment_number, 1))
          )::integer
        )
    )::date,
    CASE
      WHEN installment_no < greatest(1, coalesce(NEW.installment_number, 1))
        THEN 'historical_unconfirmed'
      WHEN installment_no = greatest(1, coalesce(NEW.installment_number, 1))
        THEN 'billed'
      ELSE 'scheduled'
    END
  FROM generate_series(1, greatest(1, coalesce(NEW.installments_total, 1))) AS installment_no
  ON CONFLICT (purchase_id, installment_number) DO NOTHING;

  INSERT INTO public.credit_card_installments(
    user_id, purchase_id, credit_card_id, installment_number, amount,
    competence_month, status, legacy_transaction_id
  ) VALUES (
    NEW.user_id, v_purchase_id, NEW.credit_card_id,
    greatest(1, coalesce(NEW.installment_number, 1)), NEW.amount,
    v_competence,
    CASE WHEN v_competence < date_trunc('month', current_date)::date
         THEN 'historical_unconfirmed' ELSE 'scheduled' END,
    NEW.id
  )
  ON CONFLICT (purchase_id, installment_number)
  DO UPDATE SET
    amount = excluded.amount,
    competence_month = excluded.competence_month,
    legacy_transaction_id = excluded.legacy_transaction_id,
    status = excluded.status,
    updated_at = now()
  RETURNING id INTO v_installment_id;

  SELECT due_day INTO v_due_day FROM public.credit_cards WHERE id = NEW.credit_card_id;
  SELECT id INTO v_statement_id
    FROM public.credit_card_statements
   WHERE credit_card_id = NEW.credit_card_id AND competence_month = v_competence;

  IF v_statement_id IS NULL THEN
    INSERT INTO public.credit_card_statements(
      user_id, credit_card_id, competence_month, due_date,
      stated_total, reconciled_total, status
    ) VALUES (
      NEW.user_id, NEW.credit_card_id, v_competence,
      make_date(
        extract(year from v_competence)::int,
        extract(month from v_competence)::int,
        least(coalesce(v_due_day, 1), extract(day from (date_trunc('month', v_competence) + interval '1 month - 1 day'))::int)
      ),
      NEW.amount, NEW.amount, 'needs_review'
    ) RETURNING id INTO v_statement_id;
  END IF;

  INSERT INTO public.credit_card_statement_items(
    user_id, statement_id, installment_id, legacy_transaction_id,
    item_kind, description, amount, occurred_at
  ) VALUES (
    NEW.user_id, v_statement_id, v_installment_id, NEW.id,
    CASE WHEN coalesce(NEW.installments_total, 1) > 1 THEN 'installment' ELSE 'purchase' END,
    coalesce(nullif(NEW.description, ''), 'Compra no cartão'),
    NEW.amount, NEW.occurred_at::date
  )
  ON CONFLICT (legacy_transaction_id) WHERE legacy_transaction_id IS NOT NULL
  DO UPDATE SET
    statement_id = excluded.statement_id,
    installment_id = excluded.installment_id,
    description = excluded.description,
    amount = excluded.amount,
    occurred_at = excluded.occurred_at;

  SELECT coalesce(sum(amount), 0) INTO v_total
    FROM public.credit_card_statement_items WHERE statement_id = v_statement_id;
  UPDATE public.credit_card_statements
     SET reconciled_total = v_total,
         stated_total = CASE WHEN source_document_id IS NULL THEN v_total ELSE stated_total END,
         updated_at = now()
   WHERE id = v_statement_id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_card_accounting_from_transaction ON public.transactions;
CREATE TRIGGER trg_sync_card_accounting_from_transaction
  AFTER INSERT OR UPDATE OF amount, occurred_at, competence_date, credit_card_id,
    installment_number, installments_total, description, category_id, status
  ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_card_accounting_from_transaction();

CREATE OR REPLACE FUNCTION public.reconcile_imported_installment_history(p_document_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  WITH decisions AS (
    SELECT e.transaction_id, e.installment_number
      FROM public.extracted_items e
     WHERE e.document_id = p_document_id
       AND e.user_id = v_user
       AND e.historical_installments_paid_assumption IS TRUE
       AND e.transaction_id IS NOT NULL
       AND coalesce(e.installment_number, 1) > 1
  ), current_installments AS (
    SELECT i.purchase_id, d.installment_number
      FROM decisions d
      JOIN public.credit_card_installments i
        ON i.legacy_transaction_id = d.transaction_id
  )
  UPDATE public.credit_card_installments target
     SET status = 'paid', updated_at = now()
    FROM current_installments current_item
   WHERE target.purchase_id = current_item.purchase_id
     AND target.installment_number < current_item.installment_number
     AND target.status = 'historical_unconfirmed';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_imported_installment_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_imported_installment_history(uuid)
  TO authenticated, service_role;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'credit_card_purchases','credit_card_installments','credit_card_statements',
    'credit_card_statement_items','credit_card_payments','credit_card_payment_allocations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "%s own rows" ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY "%s own rows" ON public.%I FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)',
      table_name, table_name
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.record_debt_payment(
  p_debt_id uuid,
  p_account_id uuid,
  p_paid_at date,
  p_amount numeric,
  p_interest_amount numeric DEFAULT 0,
  p_fee_amount numeric DEFAULT 0,
  p_installments_covered integer DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_debt public.debts;
  v_applied numeric;
  v_payment_id uuid;
  v_transaction_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_debt FROM public.debts
   WHERE id = p_debt_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'debt_not_found'; END IF;
  IF p_amount <= 0 OR p_interest_amount < 0 OR p_fee_amount < 0
     OR p_interest_amount + p_fee_amount > p_amount THEN
    RAISE EXCEPTION 'invalid_payment_composition';
  END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = v_user AND active
  ) THEN RAISE EXCEPTION 'account_not_found'; END IF;

  v_applied := p_amount - p_interest_amount - p_fee_amount;
  IF v_applied > v_debt.outstanding_balance THEN
    RAISE EXCEPTION 'payment_exceeds_outstanding_balance';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_payment_id FROM public.debt_payments
     WHERE user_id = v_user AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'payment_id', v_payment_id);
    END IF;
  END IF;

  INSERT INTO public.transactions(
    user_id, account_id, type, status, amount, occurred_at, description,
    payment_method, movement_kind
  ) VALUES (
    v_user, p_account_id, 'expense', 'confirmed', v_applied,
    coalesce(p_paid_at, current_date), 'Pagamento de dívida: ' || v_debt.name,
    'account', 'debt_payment'
  ) RETURNING id INTO v_transaction_id;

  IF p_interest_amount > 0 THEN
    INSERT INTO public.transactions(
      user_id, account_id, type, status, amount, occurred_at, description,
      payment_method, movement_kind
    ) VALUES (
      v_user, p_account_id, 'expense', 'confirmed', p_interest_amount,
      coalesce(p_paid_at, current_date), 'Juros da dívida: ' || v_debt.name,
      'account', 'transaction'
    );
  END IF;
  IF p_fee_amount > 0 THEN
    INSERT INTO public.transactions(
      user_id, account_id, type, status, amount, occurred_at, description,
      payment_method, movement_kind
    ) VALUES (
      v_user, p_account_id, 'expense', 'confirmed', p_fee_amount,
      coalesce(p_paid_at, current_date), 'Tarifas da dívida: ' || v_debt.name,
      'account', 'transaction'
    );
  END IF;

  INSERT INTO public.debt_payments(
    user_id, debt_id, account_id, paid_at, amount, amount_applied,
    interest_amount, fee_amount, installments_covered, notes,
    transaction_id, idempotency_key
  ) VALUES (
    v_user, p_debt_id, p_account_id, coalesce(p_paid_at, current_date),
    p_amount, v_applied, p_interest_amount, p_fee_amount,
    greatest(0, coalesce(p_installments_covered, 0)), nullif(p_notes, ''),
    v_transaction_id, p_idempotency_key
  ) RETURNING id INTO v_payment_id;

  UPDATE public.debts
     SET outstanding_balance = greatest(0, outstanding_balance - v_applied),
         installments_paid = least(
           coalesce(installments_total, 2147483647),
           installments_paid + greatest(0, coalesce(p_installments_covered, 0))
         ),
         status = CASE WHEN greatest(0, outstanding_balance - v_applied) = 0
                       THEN 'settled'::public.debt_status ELSE status END,
         updated_at = now()
   WHERE id = p_debt_id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'payment_id', v_payment_id,
    'transaction_id', v_transaction_id, 'amount_applied', v_applied
  );
END $$;
REVOKE ALL ON FUNCTION public.record_debt_payment(uuid,uuid,date,numeric,numeric,numeric,integer,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_debt_payment(uuid,uuid,date,numeric,numeric,numeric,integer,text,text)
  TO authenticated, service_role;

-- A nova movimentação afeta caixa, mas nunca é consumo comportamental.
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_movement_kind_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_movement_kind_check
  CHECK (movement_kind IN (
    'transaction','refund','internal_transfer','investment_application',
    'investment_redemption','investment_yield','loan_proceeds',
    'credit_card_bill_payment','card_bill_payment','card_payment','debt_payment'
  ));

NOTIFY pgrst, 'reload schema';
