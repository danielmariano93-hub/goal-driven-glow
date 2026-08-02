-- ============================================================
-- M1 — posted_at (data bancária) + qualidade de origem
-- ============================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS posted_at date,
  ADD COLUMN IF NOT EXISTS posted_at_source text;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_posted_at_source_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_posted_at_source_check
  CHECK (posted_at_source IS NULL OR posted_at_source = ANY (ARRAY['statement','import','inferred','manual']));

ALTER TABLE public.extracted_items
  ADD COLUMN IF NOT EXISTS posted_at date,
  ADD COLUMN IF NOT EXISTS posted_at_source text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS source_line_index integer;

ALTER TABLE public.extracted_items
  DROP CONSTRAINT IF EXISTS extracted_items_posted_at_source_check;
ALTER TABLE public.extracted_items
  ADD CONSTRAINT extracted_items_posted_at_source_check
  CHECK (posted_at_source IS NULL OR posted_at_source = ANY (ARRAY['statement','import','inferred','manual']));

-- Backfill provisório idempotente: só onde nulo e só origem conta (cartão não move caixa)
UPDATE public.transactions
   SET posted_at = occurred_at,
       posted_at_source = 'inferred'
 WHERE posted_at IS NULL
   AND credit_card_id IS NULL
   AND coalesce(payment_method,'account') <> 'credit_card';

CREATE INDEX IF NOT EXISTS idx_transactions_user_account_posted
  ON public.transactions (user_id, account_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_extracted_items_doc_line
  ON public.extracted_items (document_id, source_line_index);
CREATE INDEX IF NOT EXISTS idx_extracted_items_external_id
  ON public.extracted_items (user_id, external_id) WHERE external_id IS NOT NULL;

-- Sanidade: posted_at nunca muito antes da data econômica
CREATE OR REPLACE FUNCTION public.tf_transactions_validate_posted_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.posted_at IS NOT NULL AND NEW.occurred_at IS NOT NULL
     AND NEW.posted_at < (NEW.occurred_at - INTERVAL '5 days') THEN
    RAISE EXCEPTION 'posted_at (%) não pode ser anterior a occurred_at (%) em mais de 5 dias', NEW.posted_at, NEW.occurred_at;
  END IF;
  IF NEW.posted_at IS NOT NULL AND NEW.posted_at_source IS NULL THEN
    NEW.posted_at_source := 'inferred';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_transactions_validate_posted_at ON public.transactions;
CREATE TRIGGER trg_transactions_validate_posted_at
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tf_transactions_validate_posted_at();

COMMENT ON COLUMN public.transactions.posted_at IS 'Data bancária (caixa). NULL para movimentos de cartão. Fonte em posted_at_source.';

-- ============================================================
-- M2 — movement_kind: transferências externas
-- ============================================================
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_movement_kind_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_movement_kind_check
  CHECK (movement_kind = ANY (ARRAY[
    'transaction','refund','internal_transfer',
    'investment_application','investment_redemption','investment_yield',
    'loan_proceeds','credit_card_bill_payment','card_bill_payment','card_payment',
    'debt_payment','external_transfer_in','external_transfer_out'
  ]));

ALTER TABLE public.extracted_items DROP CONSTRAINT IF EXISTS extracted_items_movement_kind_check;
ALTER TABLE public.extracted_items
  ADD CONSTRAINT extracted_items_movement_kind_check
  CHECK (movement_kind = ANY (ARRAY[
    'transaction','refund','internal_transfer',
    'investment_application','investment_redemption','investment_yield',
    'loan_proceeds','card_payment','external_transfer_in','external_transfer_out'
  ]));

-- ============================================================
-- M3 — estados explícitos de importação
-- ============================================================
ALTER TABLE public.extracted_items DROP CONSTRAINT IF EXISTS extracted_items_status_check;
ALTER TABLE public.extracted_items
  ADD CONSTRAINT extracted_items_status_check
  CHECK (status = ANY (ARRAY[
    'needs_review','ignored','confirmed','duplicate_suspect','rejected','failed','rolled_back',
    'ready_to_import','repeated_legitimate','probable_duplicate','exact_duplicate'
  ]));

CREATE OR REPLACE FUNCTION public.tf_document_imports_require_final_states()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_open int;
BEGIN
  IF NEW.status = 'completed' AND coalesce(OLD.status,'') <> 'completed' THEN
    SELECT count(*) INTO v_open
      FROM public.extracted_items
     WHERE document_id = NEW.id
       AND status NOT IN ('confirmed','rejected','ignored','failed','rolled_back','exact_duplicate');
    IF v_open > 0 THEN
      RAISE EXCEPTION 'Importação % não pode ser concluída: % item(ns) sem estado final', NEW.id, v_open;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_document_imports_require_final_states ON public.document_imports;
CREATE TRIGGER trg_document_imports_require_final_states
  BEFORE UPDATE ON public.document_imports
  FOR EACH ROW EXECUTE FUNCTION public.tf_document_imports_require_final_states();

-- ============================================================
-- M4 — investimentos: apelidos + trigger reescrito
-- ============================================================
CREATE TABLE IF NOT EXISTS public.investment_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  investment_id uuid NOT NULL REFERENCES public.investments(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, normalized_alias)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_aliases TO authenticated;
GRANT ALL ON public.investment_aliases TO service_role;
ALTER TABLE public.investment_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own investment aliases" ON public.investment_aliases;
CREATE POLICY "own investment aliases" ON public.investment_aliases
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_investment_aliases_touch ON public.investment_aliases;
CREATE TRIGGER trg_investment_aliases_touch
  BEFORE UPDATE ON public.investment_aliases
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- Normalização determinística de nome de ativo (sem depender de extensões)
CREATE OR REPLACE FUNCTION public.normalize_investment_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          translate(lower(coalesce(p_name,'')),
                    'áàâãäéèêëíìîïóòôõöúùûüçñ',
                    'aaaaaeeeeiiiiooooouuuucn'),
          '\y(resgate|resgates|aplicacao|aplicacoes|aplic|invest|investimento|investimentos|itau|bradesco|santander|banco|nubank|inter|xp|btg|caixa|bb|c6|de|do|da)\y',
          ' ', 'g'),
        '\s+', ' ', 'g')
    ), '')
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_investment_movements_transaction
  ON public.investment_movements (transaction_id) WHERE transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tf_transactions_investment_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mk text;
  v_kind text;
  v_inv_id uuid;
  v_norm text;
  v_matches int;
  v_current numeric;
  v_applied boolean := true;
  v_note text := NULL;
  v_existing public.investment_movements%ROWTYPE;
BEGIN
  -- ---------- DELETE: reverte apenas se aplicado ----------
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO v_existing FROM public.investment_movements WHERE transaction_id = OLD.id;
    IF FOUND AND v_existing.applied THEN
      IF v_existing.kind = 'application' THEN
        UPDATE public.investments
           SET current_value = GREATEST(0, current_value - v_existing.amount),
               invested_amount = GREATEST(0, invested_amount - v_existing.amount),
               updated_at = now()
         WHERE id = v_existing.investment_id;
      ELSIF v_existing.kind = 'redemption' THEN
        UPDATE public.investments
           SET current_value = current_value + v_existing.amount,
               invested_amount = invested_amount + v_existing.amount,
               updated_at = now()
         WHERE id = v_existing.investment_id;
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  v_mk := coalesce(NEW.movement_kind, 'transaction');

  -- ---------- UPDATE: reverte delta antigo antes de reaplicar ----------
  IF TG_OP = 'UPDATE' THEN
    SELECT * INTO v_existing FROM public.investment_movements WHERE transaction_id = NEW.id;
    IF FOUND THEN
      IF v_existing.applied THEN
        IF v_existing.kind = 'application' THEN
          UPDATE public.investments
             SET current_value = GREATEST(0, current_value - v_existing.amount),
                 invested_amount = GREATEST(0, invested_amount - v_existing.amount),
                 updated_at = now()
           WHERE id = v_existing.investment_id;
        ELSIF v_existing.kind = 'redemption' THEN
          UPDATE public.investments
             SET current_value = current_value + v_existing.amount,
                 invested_amount = invested_amount + v_existing.amount,
                 updated_at = now()
           WHERE id = v_existing.investment_id;
        END IF;
      END IF;
      DELETE FROM public.investment_movements WHERE id = v_existing.id;
    END IF;
  END IF;

  IF v_mk NOT IN ('investment_application','investment_redemption') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.investment_movements WHERE transaction_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_kind := CASE WHEN v_mk = 'investment_application' THEN 'application' ELSE 'redemption' END;

  v_norm := public.normalize_investment_name(
    coalesce(NULLIF(btrim(NEW.friendly_description), ''), NULLIF(btrim(NEW.description), ''), '')
  );

  -- 1) apelido cadastrado
  SELECT investment_id INTO v_inv_id
    FROM public.investment_aliases
   WHERE user_id = NEW.user_id AND normalized_alias = v_norm
   LIMIT 1;

  -- 2) nome normalizado idêntico
  IF v_inv_id IS NULL AND v_norm IS NOT NULL THEN
    SELECT count(*) INTO v_matches FROM public.investments
      WHERE user_id = NEW.user_id AND public.normalize_investment_name(name) = v_norm;
    IF v_matches = 1 THEN
      SELECT id INTO v_inv_id FROM public.investments
        WHERE user_id = NEW.user_id AND public.normalize_investment_name(name) = v_norm;
    ELSIF v_matches > 1 THEN
      -- ambiguidade: prefere o de maior valor atual
      SELECT id INTO v_inv_id FROM public.investments
        WHERE user_id = NEW.user_id AND public.normalize_investment_name(name) = v_norm
        ORDER BY current_value DESC, created_at ASC LIMIT 1;
    END IF;
  END IF;

  -- 3) containment único (ex.: "cdb di" ⊂ "cdb di prefixado")
  IF v_inv_id IS NULL AND v_norm IS NOT NULL THEN
    SELECT count(*) INTO v_matches FROM public.investments
      WHERE user_id = NEW.user_id
        AND (public.normalize_investment_name(name) LIKE '%' || v_norm || '%'
             OR v_norm LIKE '%' || public.normalize_investment_name(name) || '%');
    IF v_matches = 1 THEN
      SELECT id INTO v_inv_id FROM public.investments
        WHERE user_id = NEW.user_id
          AND (public.normalize_investment_name(name) LIKE '%' || v_norm || '%'
               OR v_norm LIKE '%' || public.normalize_investment_name(name) || '%');
    END IF;
  END IF;

  -- Sem match seguro: NUNCA cria investimento zerado; registra pendência
  IF v_inv_id IS NULL THEN
    INSERT INTO public.investment_movements
      (user_id, investment_id, transaction_id, kind, amount, occurred_at, applied, notes)
    SELECT NEW.user_id, i.id, NEW.id, v_kind, NEW.amount, NEW.occurred_at, false,
           'Ativo não identificado automaticamente — revisar vínculo'
      FROM public.investments i
     WHERE i.user_id = NEW.user_id
     ORDER BY i.created_at ASC LIMIT 1;
    RETURN NEW;
  END IF;

  SELECT current_value INTO v_current FROM public.investments WHERE id = v_inv_id;

  -- Resgate acima do saldo: não aplica, manda para revisão
  IF v_kind = 'redemption' AND NEW.amount > coalesce(v_current, 0) THEN
    v_applied := false;
    v_note := 'Resgate maior que o saldo do ativo — pendente de revisão';
  END IF;

  IF v_applied THEN
    IF v_kind = 'application' THEN
      UPDATE public.investments
         SET invested_amount = invested_amount + NEW.amount,
             current_value = current_value + NEW.amount,
             reference_date = GREATEST(coalesce(reference_date, NEW.occurred_at), NEW.occurred_at),
             updated_at = now()
       WHERE id = v_inv_id;
    ELSE
      UPDATE public.investments
         SET current_value = current_value - NEW.amount,
             invested_amount = GREATEST(0, invested_amount - NEW.amount),
             reference_date = GREATEST(coalesce(reference_date, NEW.occurred_at), NEW.occurred_at),
             updated_at = now()
       WHERE id = v_inv_id;
    END IF;
  END IF;

  INSERT INTO public.investment_movements
    (user_id, investment_id, transaction_id, kind, amount, occurred_at, applied, notes)
  VALUES (NEW.user_id, v_inv_id, NEW.id, v_kind, NEW.amount, NEW.occurred_at, v_applied, v_note);

  RETURN NEW;
END $$;

-- ============================================================
-- M5 — conciliação de saldo por extrato
-- ============================================================
CREATE OR REPLACE FUNCTION public.reconcile_account_from_statement(
  p_account_id uuid,
  p_balance_date date,
  p_balance numeric,
  p_source text DEFAULT 'statement',
  p_period_start date DEFAULT NULL,
  p_period_end date DEFAULT NULL,
  p_issued_at timestamptz DEFAULT now(),
  p_document_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_snap_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = v_user) THEN
    RAISE EXCEPTION 'Conta não encontrada';
  END IF;
  IF p_source NOT IN ('statement','manual','open_finance') THEN
    RAISE EXCEPTION 'Origem inválida: %', p_source;
  END IF;

  UPDATE public.account_balance_snapshots
     SET status = 'superseded', updated_at = now()
   WHERE user_id = v_user
     AND account_id = p_account_id
     AND balance_date = p_balance_date
     AND status <> 'superseded';

  INSERT INTO public.account_balance_snapshots
    (user_id, account_id, balance_date, balance, source, source_document_id, status, reconciliation)
  VALUES (v_user, p_account_id, p_balance_date, p_balance, p_source, p_document_id, 'confirmed',
          jsonb_build_object(
            'period_start', p_period_start,
            'period_end', p_period_end,
            'issued_at', p_issued_at,
            'reconciled_at', now()
          ))
  RETURNING id INTO v_snap_id;

  RETURN v_snap_id;
END $$;

REVOKE ALL ON FUNCTION public.reconcile_account_from_statement(uuid,date,numeric,text,date,date,timestamptz,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reconcile_account_from_statement(uuid,date,numeric,text,date,date,timestamptz,uuid) TO authenticated, service_role;