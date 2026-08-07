-- Nino Financial Truth v8
-- Conciliação explícita conta <-> investimento para todos os usuários.
-- Não contém e-mail, UUID de usuário ou regra específica de uma conta.
BEGIN;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS investment_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_investment_id_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_investment_id_fkey
      FOREIGN KEY (investment_id) REFERENCES public.investments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_user_investment
  ON public.transactions(user_id, investment_id, occurred_at DESC)
  WHERE investment_id IS NOT NULL;

ALTER TABLE public.investment_movements
  ADD COLUMN IF NOT EXISTS principal_amount numeric(14,2) NULL;

-- Movimentos legados não guardavam o principal baixado. O valor original é a
-- única restauração segura disponível; novos resgates passam a usar proporção.
UPDATE public.investment_movements
   SET principal_amount = CASE WHEN kind = 'yield' THEN 0 ELSE amount END
 WHERE principal_amount IS NULL;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_movement_kind_check;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_movement_kind_check
  CHECK (movement_kind IN (
    'transaction','refund','internal_transfer',
    'investment_application','investment_redemption','investment_yield',
    'loan_proceeds','credit_card_bill_payment','card_bill_payment','card_payment',
    'debt_payment','external_transfer_in','external_transfer_out',
    'fee','interest','adjustment'
  ));

CREATE OR REPLACE FUNCTION public.tf_transactions_investment_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.transactions%ROWTYPE;
  v_existing public.investment_movements%ROWTYPE;
  v_inv_id uuid;
  v_kind text;
  v_norm text;
  v_matches integer := 0;
  v_current numeric := 0;
  v_principal numeric := 0;
  v_applied boolean := true;
  v_embodied boolean := false;
  v_note text := NULL;
BEGIN
  -- A reversão roda em BEFORE. Em DELETE isso é essencial: o FK
  -- investment_movements.transaction_id possui ON DELETE CASCADE e poderia
  -- remover a evidência antes de um trigger AFTER conseguir restaurar o ativo.
  IF TG_WHEN = 'BEFORE' AND TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT * INTO v_existing
      FROM public.investment_movements
     WHERE transaction_id = OLD.id
     FOR UPDATE;

    IF FOUND THEN
      -- Backfills antigos usavam applied=false sem nota para dizer "não some
      -- novamente, a posição atual já contém este movimento". Esse vínculo é
      -- contabilmente incorporado e precisa ser revertido em edit/delete. Já
      -- pendências reais possuem uma nota e não alteraram o ativo.
      v_embodied := v_existing.applied OR (NOT v_existing.applied AND v_existing.notes IS NULL);
      IF v_embodied THEN
        IF v_existing.kind = 'application' THEN
          UPDATE public.investments
             SET current_value = GREATEST(0, current_value - v_existing.amount),
                 invested_amount = GREATEST(0, invested_amount - COALESCE(v_existing.principal_amount, v_existing.amount)),
                 updated_at = now()
           WHERE id = v_existing.investment_id;
        ELSIF v_existing.kind = 'redemption' THEN
          UPDATE public.investments
             SET current_value = current_value + v_existing.amount,
                 invested_amount = invested_amount + COALESCE(v_existing.principal_amount, v_existing.amount),
                 updated_at = now()
           WHERE id = v_existing.investment_id;
        END IF;
      END IF;
      DELETE FROM public.investment_movements WHERE id = v_existing.id;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- O segundo trigger chama a mesma função somente em AFTER INSERT/UPDATE,
  -- quando a linha-pai já existe para satisfazer o FK do movimento.
  IF TG_WHEN <> 'AFTER' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_row := NEW;

  -- Mesmo operações executadas com service_role não podem criar um vínculo
  -- entre a transação de uma pessoa e o investimento de outra.
  IF v_row.investment_id IS NOT NULL THEN
    SELECT id INTO v_inv_id FROM public.investments
     WHERE id = v_row.investment_id AND user_id = v_row.user_id;
    IF v_inv_id IS NULL THEN
      RAISE EXCEPTION 'investment_not_owned';
    END IF;
  END IF;

  IF v_row.status <> 'confirmed'
     OR COALESCE(v_row.movement_kind, 'transaction') NOT IN ('investment_application','investment_redemption') THEN
    RETURN NEW;
  END IF;

  v_kind := CASE WHEN v_row.movement_kind = 'investment_application' THEN 'application' ELSE 'redemption' END;

  -- O vínculo explícito informado pela UI sempre tem precedência e precisa
  -- pertencer ao mesmo usuário (proteção adicional às RLS).
  -- Compatibilidade para importações antigas: só vincula por nome/alias quando
  -- o match é único. Nunca escolhe arbitrariamente entre dois ativos.
  IF v_inv_id IS NULL THEN
    v_norm := public.normalize_investment_name(
      COALESCE(NULLIF(btrim(v_row.friendly_description), ''), NULLIF(btrim(v_row.description), ''), '')
    );
    SELECT investment_id INTO v_inv_id
      FROM public.investment_aliases
     WHERE user_id = v_row.user_id AND normalized_alias = v_norm
     LIMIT 1;
  END IF;

  IF v_inv_id IS NULL AND v_norm IS NOT NULL THEN
    SELECT count(*), (array_agg(id ORDER BY id))[1] INTO v_matches, v_inv_id
      FROM public.investments
     WHERE user_id = v_row.user_id
       AND public.normalize_investment_name(name) = v_norm;
    IF v_matches <> 1 THEN v_inv_id := NULL; END IF;
  END IF;

  IF v_inv_id IS NULL THEN
    -- Mantém o caixa correto, mas não altera um ativo sem evidência suficiente.
    RETURN NEW;
  END IF;

  SELECT current_value, invested_amount
    INTO v_current, v_principal
    FROM public.investments
   WHERE id = v_inv_id
   FOR UPDATE;

  IF v_kind = 'application' THEN
    v_principal := v_row.amount;
    UPDATE public.investments
       SET current_value = current_value + v_row.amount,
           invested_amount = invested_amount + v_row.amount,
           reference_date = GREATEST(COALESCE(reference_date, v_row.occurred_at), v_row.occurred_at),
           updated_at = now()
     WHERE id = v_inv_id;
  ELSE
    IF v_row.amount > COALESCE(v_current, 0) + 0.01 THEN
      v_applied := false;
      v_principal := 0;
      v_note := 'Resgate maior que o valor atual do ativo — revisar vínculo/valor';
    ELSE
      -- Baixa proporcional do principal: rendimento não vira principal e o
      -- patrimônio líquido permanece conciliado após o resgate.
      v_principal := CASE WHEN v_current > 0
        THEN LEAST(v_principal, round((v_principal * v_row.amount / v_current)::numeric, 2))
        ELSE 0 END;
      UPDATE public.investments
         SET current_value = GREATEST(0, current_value - v_row.amount),
             invested_amount = GREATEST(0, invested_amount - v_principal),
             reference_date = GREATEST(COALESCE(reference_date, v_row.occurred_at), v_row.occurred_at),
             updated_at = now()
       WHERE id = v_inv_id;
    END IF;
  END IF;

  INSERT INTO public.investment_movements
    (user_id, investment_id, transaction_id, kind, amount, principal_amount, occurred_at, applied, notes)
  VALUES
    (v_row.user_id, v_inv_id, v_row.id, v_kind, v_row.amount, v_principal, v_row.occurred_at, v_applied, v_note);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS transactions_investment_unlink ON public.transactions;
DROP TRIGGER IF EXISTS transactions_investment_link ON public.transactions;
CREATE TRIGGER transactions_investment_unlink
  BEFORE DELETE OR UPDATE OF movement_kind, investment_id, amount,
    occurred_at, description, friendly_description, status, user_id
  ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tf_transactions_investment_link();

CREATE TRIGGER transactions_investment_link
  AFTER INSERT OR UPDATE OF movement_kind, investment_id, amount,
    occurred_at, description, friendly_description, status, user_id
  ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tf_transactions_investment_link();

-- Reprocessamento global conservador: vínculos já classificados ganham o ativo
-- quando há um único match de nome. Ambiguidades permanecem para revisão.
WITH candidates AS (
  SELECT t.id, (array_agg(i.id ORDER BY i.id))[1] AS investment_id
    FROM public.transactions t
    JOIN public.investments i
      ON i.user_id = t.user_id
     AND public.normalize_investment_name(i.name) = public.normalize_investment_name(
       COALESCE(NULLIF(btrim(t.friendly_description), ''), NULLIF(btrim(t.description), ''), '')
     )
   WHERE t.investment_id IS NULL
     AND t.status = 'confirmed'
     AND t.movement_kind IN ('investment_application','investment_redemption')
     AND NOT EXISTS (
       SELECT 1 FROM public.investment_movements movement
        WHERE movement.transaction_id = t.id
     )
   GROUP BY t.id
  HAVING count(*) = 1
)
UPDATE public.transactions t
   SET investment_id = c.investment_id,
       updated_at = now()
  FROM candidates c
 WHERE t.id = c.id;

-- Inferência histórica apenas com linguagem inequívoca e exatamente um ativo
-- cadastrado. Não reclassifica uma receita comum nem escolhe entre ativos.
WITH one_asset AS (
  SELECT user_id, (array_agg(id ORDER BY id))[1] AS investment_id
    FROM public.investments
   GROUP BY user_id
  HAVING count(*) = 1
), historical AS (
  SELECT t.id, oa.investment_id
    FROM public.transactions t
    JOIN one_asset oa ON oa.user_id = t.user_id
   WHERE t.status = 'confirmed'
     AND t.type = 'income'
     AND t.payment_method = 'account'
     AND t.movement_kind = 'transaction'
     AND public.normalize_investment_name(COALESCE(t.friendly_description, t.description, '')) IS NOT NULL
     AND lower(COALESCE(t.friendly_description, t.description, '')) ~ '(resgat|resgate|withdrawal).*(invest|cdb|fundo|aplica)|^(resgat|resgate)'
)
UPDATE public.transactions t
   SET movement_kind = 'investment_redemption',
       investment_id = h.investment_id,
       category_id = NULL,
       category_source = NULL,
       updated_at = now()
  FROM historical h
 WHERE t.id = h.id;

NOTIFY pgrst, 'reload schema';
COMMIT;
