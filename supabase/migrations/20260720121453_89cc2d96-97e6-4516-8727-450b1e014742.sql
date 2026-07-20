
-- ============================================================================
-- Contabilidade documental v3 — Lote 1
-- ============================================================================

-- 1) investment_movements: vínculo idempotente transação ↔ investimento
CREATE TABLE IF NOT EXISTS public.investment_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  investment_id uuid NOT NULL REFERENCES public.investments(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('application','redemption','yield')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  occurred_at date NOT NULL,
  applied boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id)
);

GRANT SELECT ON public.investment_movements TO authenticated;
GRANT ALL ON public.investment_movements TO service_role;

ALTER TABLE public.investment_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS investment_movements_select_own ON public.investment_movements;
CREATE POLICY investment_movements_select_own
  ON public.investment_movements FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS investment_movements_user_idx
  ON public.investment_movements (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS investment_movements_investment_idx
  ON public.investment_movements (investment_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at_investment_movements()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS investment_movements_updated_at ON public.investment_movements;
CREATE TRIGGER investment_movements_updated_at
  BEFORE UPDATE ON public.investment_movements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_investment_movements();

-- 2) Trigger: manutenção automática de investments a partir de transactions
CREATE OR REPLACE FUNCTION public.tf_transactions_investment_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mk text;
  v_kind text;
  v_inv_id uuid;
  v_name text;
  v_existing public.investment_movements%ROWTYPE;
BEGIN
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
    -- linked row cascades via ON DELETE CASCADE
    RETURN OLD;
  END IF;

  v_mk := coalesce(NEW.movement_kind, 'transaction');
  IF v_mk NOT IN ('investment_application','investment_redemption') THEN
    RETURN NEW;
  END IF;

  v_kind := CASE WHEN v_mk = 'investment_application' THEN 'application' ELSE 'redemption' END;

  -- Se já existe vínculo para esta transação (idempotência em re-runs), não duplica
  IF EXISTS (SELECT 1 FROM public.investment_movements WHERE transaction_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Nome canônico: se descrição menciona CDB, usar "CDB DI"; senão, usar descrição normalizada
  v_name := CASE
    WHEN NEW.description ILIKE '%CDB%' THEN 'CDB DI'
    ELSE coalesce(NULLIF(trim(NEW.friendly_description), ''), NULLIF(trim(NEW.description), ''), 'Investimento')
  END;

  -- Casa por nome (case-insensitive) e user; senão cria
  SELECT id INTO v_inv_id FROM public.investments
    WHERE user_id = NEW.user_id AND name ILIKE v_name
    ORDER BY created_at ASC LIMIT 1;

  IF v_inv_id IS NULL THEN
    INSERT INTO public.investments (user_id, name, category, invested_amount, current_value, reference_date)
    VALUES (NEW.user_id, v_name, 'Renda fixa', 0, 0, NEW.occurred_at)
    RETURNING id INTO v_inv_id;
  END IF;

  -- Aplica delta
  IF v_kind = 'application' THEN
    UPDATE public.investments
       SET invested_amount = invested_amount + NEW.amount,
           current_value = current_value + NEW.amount,
           updated_at = now()
     WHERE id = v_inv_id;
  ELSE
    UPDATE public.investments
       SET current_value = GREATEST(0, current_value - NEW.amount),
           invested_amount = GREATEST(0, invested_amount - NEW.amount),
           updated_at = now()
     WHERE id = v_inv_id;
  END IF;

  INSERT INTO public.investment_movements
    (user_id, investment_id, transaction_id, kind, amount, occurred_at, applied)
  VALUES (NEW.user_id, v_inv_id, NEW.id, v_kind, NEW.amount, NEW.occurred_at, true);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS transactions_investment_link ON public.transactions;
CREATE TRIGGER transactions_investment_link
  AFTER INSERT OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tf_transactions_investment_link();

-- 3) Backfill idempotente: vincula transações históricas de CDB SEM re-aplicar deltas
--    (production já reflete a posição correta; queremos apenas rastreabilidade)
DO $$
DECLARE
  v_row record;
  v_inv_id uuid;
  v_name text;
BEGIN
  FOR v_row IN
    SELECT t.id, t.user_id, t.description, t.friendly_description,
           t.amount, t.occurred_at, t.movement_kind
    FROM public.transactions t
    WHERE t.movement_kind IN ('investment_application','investment_redemption')
      AND NOT EXISTS (SELECT 1 FROM public.investment_movements m WHERE m.transaction_id = t.id)
  LOOP
    v_name := CASE
      WHEN v_row.description ILIKE '%CDB%' THEN 'CDB DI'
      ELSE coalesce(NULLIF(trim(v_row.friendly_description), ''), NULLIF(trim(v_row.description), ''), 'Investimento')
    END;
    SELECT id INTO v_inv_id FROM public.investments
      WHERE user_id = v_row.user_id AND name ILIKE v_name
      ORDER BY created_at ASC LIMIT 1;
    IF v_inv_id IS NULL THEN
      INSERT INTO public.investments (user_id, name, category, invested_amount, current_value, reference_date)
      VALUES (v_row.user_id, v_name, 'Renda fixa', 0, 0, v_row.occurred_at)
      RETURNING id INTO v_inv_id;
    END IF;
    INSERT INTO public.investment_movements
      (user_id, investment_id, transaction_id, kind, amount, occurred_at, applied)
    VALUES (
      v_row.user_id, v_inv_id, v_row.id,
      CASE WHEN v_row.movement_kind = 'investment_application' THEN 'application' ELSE 'redemption' END,
      v_row.amount, v_row.occurred_at,
      false  -- não re-aplicar; posição atual já reflete o histórico
    );
  END LOOP;
END $$;

-- 4) Bloqueio de conciliação: confirm_document_import não confirma quando diff >= R$ 0,01
CREATE OR REPLACE FUNCTION public.confirm_document_import(p_document_id uuid, p_item_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_doc public.document_imports%ROWTYPE;
  v_item public.extracted_items%ROWTYPE;
  v_group_id uuid;
  v_new_tx_id uuid;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_errors  jsonb := '[]'::jsonb;
  v_created_count int := 0;
  v_total_selected int := coalesce(array_length(p_item_ids, 1), 0);
  v_income numeric; v_expense numeric; v_calc numeric; v_diff numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_doc FROM public.document_imports
    WHERE id = p_document_id AND user_id = v_user
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'document_not_found');
  END IF;

  IF v_doc.status IN ('canceled','expired') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'document_'||v_doc.status);
  END IF;

  -- GUARDRAIL DE CONCILIAÇÃO: se o documento traz saldo final, bloqueia se diff >= R$ 0,01
  IF v_doc.statement_closing_balance IS NOT NULL AND v_doc.statement_opening_balance IS NOT NULL THEN
    SELECT
      coalesce(sum(amount) FILTER (WHERE type='income'), 0),
      coalesce(sum(amount) FILTER (WHERE type='expense'), 0)
    INTO v_income, v_expense
    FROM public.extracted_items
    WHERE document_id = p_document_id AND user_id = v_user
      AND status NOT IN ('ignored','rejected','duplicate_suspect','failed','rolled_back');
    v_calc := coalesce(v_doc.statement_opening_balance, 0) + v_income - v_expense;
    v_diff := v_doc.statement_closing_balance - v_calc;
    IF abs(v_diff) >= 0.01 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'balance_mismatch',
        'opening', v_doc.statement_opening_balance,
        'income', v_income,
        'expense', v_expense,
        'calculated_closing', v_calc,
        'bank_closing', v_doc.statement_closing_balance,
        'difference', v_diff
      );
    END IF;
  END IF;

  FOR v_item IN
    SELECT * FROM public.extracted_items
     WHERE document_id = p_document_id
       AND user_id = v_user
       AND id = ANY(p_item_ids)
     ORDER BY idx ASC
     FOR UPDATE
  LOOP
    IF v_item.transaction_id IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('item_id', v_item.id, 'reason', 'already_confirmed', 'transaction_id', v_item.transaction_id);
      CONTINUE;
    END IF;

    IF v_item.status = 'ignored' OR v_item.status = 'rejected' THEN
      v_skipped := v_skipped || jsonb_build_object('item_id', v_item.id, 'reason', 'status_'||v_item.status);
      CONTINUE;
    END IF;

    IF v_item.payment_method = 'account' AND v_item.account_id IS NULL THEN
      v_errors := v_errors || jsonb_build_object('item_id', v_item.id, 'error', 'missing_account_id');
      UPDATE public.extracted_items SET status = 'failed' WHERE id = v_item.id;
      CONTINUE;
    END IF;
    IF v_item.payment_method = 'credit_card' AND v_item.credit_card_id IS NULL THEN
      v_errors := v_errors || jsonb_build_object('item_id', v_item.id, 'error', 'missing_credit_card_id');
      UPDATE public.extracted_items SET status = 'failed' WHERE id = v_item.id;
      CONTINUE;
    END IF;
    IF v_item.payment_method IS NULL THEN
      IF v_item.account_id IS NOT NULL AND v_item.credit_card_id IS NULL THEN
        v_item.payment_method := 'account';
      ELSIF v_item.credit_card_id IS NOT NULL THEN
        v_item.payment_method := 'credit_card';
      ELSE
        v_errors := v_errors || jsonb_build_object('item_id', v_item.id, 'error', 'missing_payment_target');
        UPDATE public.extracted_items SET status = 'failed' WHERE id = v_item.id;
        CONTINUE;
      END IF;
    END IF;

    IF v_item.installments_total IS NOT NULL AND v_item.installments_total > 1 THEN
      SELECT purchase_group_id INTO v_group_id
        FROM public.transactions
        WHERE user_id = v_user
          AND credit_card_id = v_item.credit_card_id
          AND purchase_date = v_item.purchase_date
          AND installments_total = v_item.installments_total
          AND import_source_id LIKE 'document:'||p_document_id::text||':%'
        LIMIT 1;
      IF v_group_id IS NULL THEN
        v_group_id := gen_random_uuid();
      END IF;
    ELSE
      v_group_id := NULL;
    END IF;

    BEGIN
      INSERT INTO public.transactions(
        user_id, account_id, credit_card_id, category_id,
        type, status, amount, occurred_at, description,
        raw_description, bank_reference, dedupe_fingerprint,
        payment_method, installment_number, installments_total,
        purchase_date, competence_date, purchase_group_id,
        origin, import_source_id, movement_kind
      ) VALUES (
        v_user,
        CASE WHEN v_item.payment_method = 'account' THEN v_item.account_id ELSE NULL END,
        CASE WHEN v_item.payment_method = 'credit_card' THEN v_item.credit_card_id ELSE NULL END,
        v_item.category_id,
        v_item.type::transaction_type,
        'confirmed'::transaction_status,
        v_item.amount,
        v_item.occurred_at,
        v_item.description,
        v_item.raw_description,
        v_item.bank_reference,
        v_item.dedupe_fingerprint,
        v_item.payment_method,
        v_item.installment_number,
        v_item.installments_total,
        v_item.purchase_date,
        v_item.competence_date,
        v_group_id,
        'import'::txn_origin,
        'document:'||p_document_id::text||':'||v_item.idx::text,
        coalesce(v_item.movement_kind, 'transaction')
      )
      RETURNING id INTO v_new_tx_id;

      UPDATE public.extracted_items
         SET transaction_id = v_new_tx_id,
             status = 'confirmed'
       WHERE id = v_item.id;

      v_created := v_created || jsonb_build_object('item_id', v_item.id, 'transaction_id', v_new_tx_id);
      v_created_count := v_created_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('item_id', v_item.id, 'error', SQLERRM);
      UPDATE public.extracted_items SET status = 'failed' WHERE id = v_item.id;
    END;
  END LOOP;

  IF v_created_count = 0 THEN
    NULL;
  ELSIF EXISTS (SELECT 1 FROM public.extracted_items WHERE document_id = p_document_id AND status IN ('needs_review','duplicate_suspect') AND transaction_id IS NULL) THEN
    UPDATE public.document_imports SET status = 'partially_confirmed' WHERE id = p_document_id;
  ELSE
    UPDATE public.document_imports SET status = 'confirmed' WHERE id = p_document_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'created', v_created,
    'skipped', v_skipped,
    'errors', v_errors,
    'created_count', v_created_count,
    'total_selected', v_total_selected
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_document_import(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_document_import(uuid, uuid[]) TO authenticated;
