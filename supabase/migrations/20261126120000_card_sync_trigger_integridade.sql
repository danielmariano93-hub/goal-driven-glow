-- Auditoria da fatura Itaú nov/2026 (cartão final 0098): o gatilho que espelha compras de cartão na
-- contabilidade do cartão tinha quatro defeitos, todos confirmados com dados reais:
--  1) recalculava reconciled_total = soma dos itens, SEM o saldo anterior (opening_balance);
--  2) sobrescrevia stated_total com essa soma em faturas sem documento de origem — inclusive pagas.
--     Foi o que transformou a fatura de R$ 1.004,79 em R$ 4.648,85 (4.658,85 de lançamentos − 10,00 de
--     pagamento, ignorando o saldo credor anterior de −3.644,06);
--  3) em qualquer edição (ex.: troca de categoria) rebaixava parcelas pagas/canceladas para
--     'historical_unconfirmed'/'scheduled';
--  4) criava um item novo em vez de ligar a transação ao item que já existia na fatura (duplicidade).
-- Também passa a manter statement_items.category_id igual à categoria da transação (fonte de verdade).
-- Coluna criada na intervenção manual de 26/11 (registrada aqui para o repositório refletir o banco).
ALTER TABLE public.credit_card_statement_items
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id);

CREATE OR REPLACE FUNCTION public.sync_card_accounting_from_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group uuid;
  v_purchase_id uuid;
  v_installment_id uuid;
  v_statement_id uuid;
  v_competence date;
  v_total numeric;
  v_due_day integer;
  v_item uuid;
BEGIN
  IF NEW.credit_card_id IS NULL
     OR NEW.type::text <> 'expense'
     OR coalesce(NEW.status::text, 'confirmed') <> 'confirmed'
     OR coalesce(NEW.movement_kind, 'transaction') <> 'transaction' THEN
    RETURN NEW;
  END IF;

  v_group := coalesce(NEW.purchase_group_id, NEW.id);
  v_competence := date_trunc('month', coalesce(NEW.competence_date, NEW.occurred_at::date))::date;

  SELECT id INTO v_purchase_id
    FROM public.credit_card_purchases
   WHERE user_id = NEW.user_id AND legacy_purchase_group_id = v_group;

  IF v_purchase_id IS NULL THEN
    INSERT INTO public.credit_card_purchases(
      user_id, credit_card_id, merchant, category_id, purchase_date,
      total_amount, installments_total, source, inferred_total, legacy_purchase_group_id
    ) VALUES (
      NEW.user_id, NEW.credit_card_id,
      coalesce(nullif(NEW.description, ''), 'Compra no cartão'),
      NEW.category_id, coalesce(NEW.purchase_date, NEW.occurred_at::date),
      CASE WHEN coalesce(NEW.installments_total, 1) > 1 THEN NEW.amount * NEW.installments_total ELSE NEW.amount END,
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

  INSERT INTO public.credit_card_installments(
    user_id, purchase_id, credit_card_id, installment_number, amount, competence_month, status
  )
  SELECT
    NEW.user_id, v_purchase_id, NEW.credit_card_id, installment_no, NEW.amount,
    (v_competence + make_interval(months => (installment_no - greatest(1, coalesce(NEW.installment_number, 1)))::integer))::date,
    CASE
      WHEN installment_no < greatest(1, coalesce(NEW.installment_number, 1)) THEN 'historical_unconfirmed'
      WHEN installment_no = greatest(1, coalesce(NEW.installment_number, 1)) THEN 'billed'
      ELSE 'scheduled'
    END
  FROM generate_series(1, greatest(1, coalesce(NEW.installments_total, 1))) AS installment_no
  ON CONFLICT (purchase_id, installment_number) DO NOTHING;

  INSERT INTO public.credit_card_installments(
    user_id, purchase_id, credit_card_id, installment_number, amount, competence_month, status, legacy_transaction_id
  ) VALUES (
    NEW.user_id, v_purchase_id, NEW.credit_card_id,
    greatest(1, coalesce(NEW.installment_number, 1)), NEW.amount, v_competence,
    CASE WHEN v_competence < date_trunc('month', current_date)::date THEN 'historical_unconfirmed' ELSE 'scheduled' END,
    NEW.id
  )
  ON CONFLICT (purchase_id, installment_number)
  DO UPDATE SET
    amount = excluded.amount,
    competence_month = excluded.competence_month,
    legacy_transaction_id = excluded.legacy_transaction_id,
    -- (3) estado já decidido (pago, cancelado) não é rebaixado por uma edição da transação
    status = CASE WHEN public.credit_card_installments.status IN ('paid', 'cancelled')
                  THEN public.credit_card_installments.status ELSE excluded.status END,
    updated_at = now()
  RETURNING id INTO v_installment_id;

  SELECT due_day INTO v_due_day FROM public.credit_cards WHERE id = NEW.credit_card_id;
  SELECT id INTO v_statement_id
    FROM public.credit_card_statements
   WHERE credit_card_id = NEW.credit_card_id AND competence_month = v_competence;

  IF v_statement_id IS NULL THEN
    INSERT INTO public.credit_card_statements(
      user_id, credit_card_id, competence_month, due_date, stated_total, reconciled_total, status
    ) VALUES (
      NEW.user_id, NEW.credit_card_id, v_competence,
      make_date(extract(year from v_competence)::int, extract(month from v_competence)::int,
        least(coalesce(v_due_day, 1), extract(day from (date_trunc('month', v_competence) + interval '1 month - 1 day'))::int)),
      NEW.amount, NEW.amount, 'needs_review'
    ) RETURNING id INTO v_statement_id;
  END IF;

  -- (4) se a fatura já tem o item desta parcela (ou o mesmo lançamento sem parcela), liga em vez de duplicar
  IF NOT EXISTS (SELECT 1 FROM public.credit_card_statement_items WHERE legacy_transaction_id = NEW.id) THEN
    SELECT id INTO v_item
      FROM public.credit_card_statement_items
     WHERE statement_id = v_statement_id
       AND legacy_transaction_id IS NULL
       AND (installment_id = v_installment_id
            OR (installment_id IS NULL AND amount = NEW.amount AND occurred_at = NEW.occurred_at::date))
     ORDER BY (installment_id = v_installment_id) DESC NULLS LAST, created_at
     LIMIT 1;
  END IF;

  IF v_item IS NOT NULL THEN
    UPDATE public.credit_card_statement_items
       SET legacy_transaction_id = NEW.id,
           installment_id = coalesce(installment_id, v_installment_id),
           category_id = NEW.category_id
     WHERE id = v_item;
  ELSE
    INSERT INTO public.credit_card_statement_items(
      user_id, statement_id, installment_id, legacy_transaction_id, item_kind, description, amount, occurred_at, category_id
    ) VALUES (
      NEW.user_id, v_statement_id, v_installment_id, NEW.id,
      CASE WHEN coalesce(NEW.installments_total, 1) > 1 THEN 'installment' ELSE 'purchase' END,
      coalesce(nullif(NEW.description, ''), 'Compra no cartão'),
      NEW.amount, NEW.occurred_at::date, NEW.category_id
    )
    ON CONFLICT (legacy_transaction_id) WHERE legacy_transaction_id IS NOT NULL
    DO UPDATE SET
      statement_id = excluded.statement_id,
      installment_id = excluded.installment_id,
      description = excluded.description,
      amount = excluded.amount,
      occurred_at = excluded.occurred_at,
      category_id = excluded.category_id;
  END IF;

  -- (1) e (2): total conciliado inclui o saldo anterior; o total declarado só é derivado em fatura
  -- ainda em montagem (sem documento, sem total assinado, aberta ou em revisão).
  SELECT coalesce(sum(amount), 0) INTO v_total
    FROM public.credit_card_statement_items WHERE statement_id = v_statement_id;
  UPDATE public.credit_card_statements
     SET reconciled_total = round(coalesce(opening_balance, 0) + v_total, 2),
         stated_total = CASE
           WHEN source_document_id IS NULL AND signed_total IS NULL AND status IN ('needs_review', 'open')
             THEN round(coalesce(opening_balance, 0) + v_total, 2)
           ELSE stated_total END,
         updated_at = now()
   WHERE id = v_statement_id;

  RETURN NEW;
END $function$;

-- Categoria do item da fatura: espelho da transação vinculada (fonte de verdade, onde ficam as edições manuais);
-- sem transação, vale a categoria da compra. Mantém o espelho quando a compra muda de categoria.
CREATE OR REPLACE FUNCTION public.sync_statement_item_category_from_purchase()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.category_id IS DISTINCT FROM OLD.category_id THEN
    UPDATE public.credit_card_statement_items si
       SET category_id = NEW.category_id
      FROM public.credit_card_installments i
     WHERE i.purchase_id = NEW.id AND si.installment_id = i.id AND si.legacy_transaction_id IS NULL;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_statement_item_category_from_purchase ON public.credit_card_purchases;
CREATE TRIGGER trg_statement_item_category_from_purchase
  AFTER UPDATE OF category_id ON public.credit_card_purchases
  FOR EACH ROW EXECUTE FUNCTION public.sync_statement_item_category_from_purchase();
REVOKE ALL ON FUNCTION public.sync_statement_item_category_from_purchase() FROM PUBLIC, anon, authenticated;

-- Edição de item de fatura: (a) a categoria escolhida fica gravada no item mesmo sem lançamento vinculado;
-- (b) trocar só a categoria é permitido em fatura paga/fechada (não muda valor, data nem tipo).
CREATE OR REPLACE FUNCTION public.update_credit_card_statement_item(p_item_id uuid, p_description text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_amount numeric DEFAULT NULL::numeric, p_occurred_at date DEFAULT NULL::date, p_item_kind text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_user uuid:=auth.uid(); v_item public.credit_card_statement_items%ROWTYPE;
        v_stmt public.credit_card_statements%ROWTYPE; v_kind text; v_amount numeric(14,2);
        v_desc text; v_recalc jsonb; v_category_only boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_item FROM public.credit_card_statement_items WHERE id=p_item_id AND user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_stmt FROM public.credit_card_statements WHERE id=v_item.statement_id AND user_id=v_user FOR UPDATE;

  v_desc := trim(coalesce(nullif(trim(coalesce(p_description,'')),''), v_item.description));
  IF length(v_desc)<1 THEN RAISE EXCEPTION 'description_required' USING ERRCODE='22023'; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.categories WHERE id=p_category_id AND (user_id=v_user OR user_id IS NULL) AND archived_at IS NULL
  ) THEN RAISE EXCEPTION 'category_not_found' USING ERRCODE='P0002'; END IF;
  v_kind := coalesce(nullif(trim(coalesce(p_item_kind,'')),''), v_item.item_kind);
  IF v_kind NOT IN ('purchase','installment','refund','interest','fee','payment','adjustment') THEN
    RAISE EXCEPTION 'invalid_item_kind' USING ERRCODE='22023';
  END IF;
  v_amount := round(coalesce(p_amount, v_item.amount),2);
  IF v_amount=0 THEN RAISE EXCEPTION 'amount_must_not_be_zero' USING ERRCODE='22023'; END IF;
  v_amount := CASE WHEN v_kind IN ('refund','payment') THEN -abs(v_amount) ELSE abs(v_amount) END;

  v_category_only := v_amount = v_item.amount AND v_kind = v_item.item_kind
                     AND coalesce(p_occurred_at, v_item.occurred_at) IS NOT DISTINCT FROM v_item.occurred_at;
  IF (v_stmt.status NOT IN ('draft','needs_review','open','overdue') OR v_stmt.paid_amount>0) AND NOT v_category_only THEN
    RAISE EXCEPTION 'statement_economic_fields_locked' USING ERRCODE='55000';
  END IF;

  UPDATE public.credit_card_statement_items
     SET description=v_desc, amount=v_amount,
         occurred_at=coalesce(p_occurred_at, occurred_at), item_kind=v_kind,
         category_id=coalesce(p_category_id, category_id)
   WHERE id=p_item_id;

  IF v_item.legacy_transaction_id IS NOT NULL THEN
    IF v_kind IN ('refund','payment') THEN
      DELETE FROM public.transactions WHERE id=v_item.legacy_transaction_id AND user_id=v_user;
      UPDATE public.credit_card_statement_items SET legacy_transaction_id=NULL WHERE id=p_item_id;
    ELSE
      UPDATE public.transactions
         SET description=v_desc,
             category_id=coalesce(p_category_id, category_id),
             category_source=CASE WHEN p_category_id IS NOT NULL THEN 'user' ELSE category_source END,
             amount=abs(v_amount),
             occurred_at=coalesce(p_occurred_at, occurred_at),
             type='expense'::public.transaction_type,
             user_edited_at=now(), updated_at=now()
       WHERE id=v_item.legacy_transaction_id AND user_id=v_user;
    END IF;
  ELSIF p_category_id IS NOT NULL AND v_item.installment_id IS NOT NULL THEN
    -- sem lançamento: a categoria vale para a compra (próximas parcelas herdam)
    UPDATE public.credit_card_purchases p SET category_id=p_category_id, updated_at=now()
      FROM public.credit_card_installments i WHERE i.id=v_item.installment_id AND p.id=i.purchase_id AND p.user_id=v_user;
  END IF;

  v_recalc := public.recalc_credit_card_statement(v_item.statement_id);
  RETURN jsonb_build_object('ok',true,'item_id',p_item_id) || v_recalc;
END $function$;
