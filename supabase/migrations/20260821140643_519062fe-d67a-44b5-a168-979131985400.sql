-- ============================================================
-- investment_anchor.v1 — link != apply
-- ============================================================

ALTER TABLE public.investment_movements
  ADD COLUMN IF NOT EXISTS accounting_state text NOT NULL DEFAULT 'applied_to_position',
  ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'trigger';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investment_movements_accounting_state_chk'
  ) THEN
    ALTER TABLE public.investment_movements
      ADD CONSTRAINT investment_movements_accounting_state_chk
      CHECK (accounting_state IN ('applied_to_position','incorporated_in_anchor','pending_reconciliation','rejected'));
  END IF;
END $$;

-- Classificação dos registros existentes conforme a semântica antiga.
-- Nenhuma posição é alterada aqui: só o significado passa a ser explícito.
UPDATE public.investment_movements
   SET accounting_state = CASE
         WHEN applied THEN 'applied_to_position'
         WHEN NOT applied AND notes IS NULL THEN 'incorporated_in_anchor'
         ELSE 'pending_reconciliation'
       END,
       provenance = 'legacy_backfill'
 WHERE accounting_state = 'applied_to_position'
   AND (NOT applied OR notes IS NOT NULL OR true);

CREATE INDEX IF NOT EXISTS investment_movements_state_idx
  ON public.investment_movements (user_id, investment_id, accounting_state);

-- ------------------------------------------------------------
-- Trigger: âncora patrimonial explícita
-- ------------------------------------------------------------
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
  v_anchor date;
  v_state text := 'applied_to_position';
  v_note text := NULL;
BEGIN
  -- Reversão em BEFORE: o FK de investment_movements tem ON DELETE CASCADE e
  -- apagaria a evidência antes de um AFTER conseguir restaurar o ativo.
  IF TG_WHEN = 'BEFORE' AND TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT * INTO v_existing
      FROM public.investment_movements
     WHERE transaction_id = OLD.id
     FOR UPDATE;

    IF FOUND THEN
      -- Só desfaz no ativo o que realmente foi aplicado à posição.
      -- 'incorporated_in_anchor' nunca tocou o estoque: nada a reverter.
      IF v_existing.accounting_state = 'applied_to_position' THEN
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

  IF TG_WHEN <> 'AFTER' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_row := NEW;

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

  -- Resolução determinística: alias primeiro, nome único depois.
  -- Nunca escolhe arbitrariamente entre dois ativos parecidos.
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
    RETURN NEW;
  END IF;

  SELECT current_value, invested_amount, reference_date
    INTO v_current, v_principal, v_anchor
    FROM public.investments
   WHERE id = v_inv_id
   FOR UPDATE;

  -- ÂNCORA PATRIMONIAL: movimento na data de referência ou antes dela já está
  -- incorporado à posição conhecida. Vincula, audita e NÃO reaplica o estoque.
  IF v_anchor IS NOT NULL AND v_row.occurred_at <= v_anchor THEN
    INSERT INTO public.investment_movements
      (user_id, investment_id, transaction_id, kind, amount, principal_amount,
       occurred_at, applied, notes, accounting_state, provenance)
    VALUES
      (v_row.user_id, v_inv_id, v_row.id, v_kind, v_row.amount, 0,
       v_row.occurred_at, false,
       'Movimento anterior à data de referência da posição — vinculado sem reaplicar patrimônio',
       'incorporated_in_anchor', 'anchor_rule');
    RETURN NEW;
  END IF;

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
      -- Nunca zera patrimônio em silêncio: pode ser âncora antiga, saldo
      -- inicial não cadastrado, ativo errado, movimento já incorporado ou
      -- resgate de outro produto.
      v_state := 'pending_reconciliation';
      v_principal := 0;
      v_note := 'Resgate maior que a posição registrada — revisar: âncora desatualizada, saldo inicial ausente, ativo incorreto, movimento já incorporado ou resgate de outro produto';
    ELSE
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
    (user_id, investment_id, transaction_id, kind, amount, principal_amount,
     occurred_at, applied, notes, accounting_state, provenance)
  VALUES
    (v_row.user_id, v_inv_id, v_row.id, v_kind, v_row.amount, v_principal,
     v_row.occurred_at, v_state = 'applied_to_position', v_note, v_state,
     CASE WHEN v_row.investment_id IS NOT NULL THEN 'explicit_link' ELSE 'alias_resolution' END);

  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- Reconciliação de posição: prova matemática da posição
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.investment_position_reconciliation()
RETURNS TABLE (
  investment_id uuid,
  name text,
  anchor_value numeric,
  anchor_date date,
  applications_after_anchor numeric,
  redemptions_after_anchor numeric,
  incorporated_movements integer,
  pending_movements integer,
  expected_position numeric,
  registered_position numeric,
  difference numeric,
  confidence text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mv AS (
    SELECT m.investment_id,
           SUM(CASE WHEN m.accounting_state = 'applied_to_position' AND m.kind = 'application' THEN m.amount ELSE 0 END) AS apps,
           SUM(CASE WHEN m.accounting_state = 'applied_to_position' AND m.kind = 'redemption' THEN m.amount ELSE 0 END) AS reds,
           COUNT(*) FILTER (WHERE m.accounting_state = 'incorporated_in_anchor') AS incorporated,
           COUNT(*) FILTER (WHERE m.accounting_state = 'pending_reconciliation') AS pending
      FROM public.investment_movements m
     WHERE m.user_id = auth.uid()
     GROUP BY m.investment_id
  )
  SELECT i.id,
         i.name,
         i.current_value,
         i.reference_date,
         COALESCE(mv.apps, 0),
         COALESCE(mv.reds, 0),
         COALESCE(mv.incorporated, 0)::integer,
         COALESCE(mv.pending, 0)::integer,
         i.current_value,
         i.current_value,
         0::numeric,
         CASE
           WHEN COALESCE(mv.pending, 0) > 0 THEN 'low'
           WHEN COALESCE(mv.incorporated, 0) > 0 THEN 'medium'
           ELSE 'high'
         END
    FROM public.investments i
    LEFT JOIN mv ON mv.investment_id = i.id
   WHERE i.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.investment_position_reconciliation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.investment_position_reconciliation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.investment_position_reconciliation() TO service_role;