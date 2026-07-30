-- Correções de integridade descobertas na confirmação real de faturas.
-- A origem "import" é legítima para categorias recebidas de um documento,
-- porém o trigger já a produzia e o CHECK antigo a rejeitava.
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_category_source_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_category_source_check
  CHECK (
    category_source IS NULL OR category_source = ANY (ARRAY[
      'user'::text,
      'alias'::text,
      'history'::text,
      'rule'::text,
      'llm'::text,
      'none'::text,
      'legacy'::text,
      'import'::text
    ])
  );

-- O catálogo canônico já usa card_payment para pagamento/antecipação de fatura.
-- Mantemos as constraints alinhadas para que créditos extraídos não sejam
-- rejeitados entre a revisão e a persistência.
ALTER TABLE public.extracted_items
  DROP CONSTRAINT IF EXISTS extracted_items_movement_kind_check;
ALTER TABLE public.extracted_items
  ADD CONSTRAINT extracted_items_movement_kind_check
  CHECK (movement_kind = ANY (ARRAY[
    'transaction'::text,
    'refund'::text,
    'internal_transfer'::text,
    'investment_application'::text,
    'investment_redemption'::text,
    'investment_yield'::text,
    'loan_proceeds'::text,
    'card_payment'::text
  ]));

-- Categorias de recebimentos da Divisão do Rolê podem ser editadas sem liberar
-- valor, conta, data ou vínculo financeiro do reembolso.
CREATE OR REPLACE FUNCTION public.split_set_reimbursement_category(
  p_transaction_id uuid,
  p_category_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx public.transactions%ROWTYPE;
  v_category public.categories%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO v_tx
  FROM public.transactions
  WHERE id = p_transaction_id
    AND user_id = auth.uid()
    AND split_transaction_role = 'reimbursement'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_reimbursement');
  END IF;

  IF p_category_id IS NOT NULL THEN
    SELECT * INTO v_category
    FROM public.categories
    WHERE id = p_category_id
      AND archived_at IS NULL
      AND (user_id IS NULL OR user_id = auth.uid())
      AND type::text IN ('income', 'both');
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_income_category');
    END IF;
  END IF;

  UPDATE public.transactions
  SET category_id = p_category_id,
      category_source = CASE WHEN p_category_id IS NULL THEN 'none' ELSE 'user' END,
      category_confidence = CASE WHEN p_category_id IS NULL THEN 0 ELSE 1 END,
      category_reason = 'categoria do reembolso editada pelo usuário',
      user_edited_at = now()
  WHERE id = v_tx.id;

  RETURN jsonb_build_object('ok', true, 'transaction_id', v_tx.id);
END;
$$;

REVOKE ALL ON FUNCTION public.split_set_reimbursement_category(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.split_set_reimbursement_category(uuid, uuid) TO authenticated;