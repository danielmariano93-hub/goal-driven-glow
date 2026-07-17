-- Conciliação bancária, movimentos internos e reparo auditável de importações.

ALTER TABLE public.extracted_items
  ADD COLUMN IF NOT EXISTS movement_kind text NOT NULL DEFAULT 'transaction'
  CHECK (movement_kind IN ('transaction','refund','internal_transfer','investment_application','investment_redemption'));

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS normalized_description text,
  ADD COLUMN IF NOT EXISTS movement_kind text NOT NULL DEFAULT 'transaction'
  CHECK (movement_kind IN ('transaction','refund','internal_transfer','investment_application','investment_redemption'));

-- Fingerprint sem referência bancária é pista, não identidade: duas compras iguais
-- no mesmo dia são possíveis. A unicidade anterior bloqueava casos legítimos.
DROP INDEX IF EXISTS public.transactions_user_dedupe_fingerprint_idx;
CREATE INDEX IF NOT EXISTS transactions_user_dedupe_fingerprint_idx
  ON public.transactions(user_id, dedupe_fingerprint)
  WHERE dedupe_fingerprint IS NOT NULL;

ALTER TABLE public.document_imports DROP CONSTRAINT IF EXISTS document_imports_status_check;
ALTER TABLE public.document_imports ADD CONSTRAINT document_imports_status_check
  CHECK (status IN ('uploaded','processing','needs_review','confirmed','partially_confirmed','failed','expired','canceled','rolled_back'));
ALTER TABLE public.extracted_items DROP CONSTRAINT IF EXISTS extracted_items_status_check;
ALTER TABLE public.extracted_items ADD CONSTRAINT extracted_items_status_check
  CHECK (status IN ('needs_review','ignored','confirmed','duplicate_suspect','rejected','failed','rolled_back'));

CREATE TABLE IF NOT EXISTS public.account_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  balance_date date NOT NULL,
  balance numeric(14,2) NOT NULL,
  source text NOT NULL DEFAULT 'statement' CHECK (source IN ('statement','manual','open_finance')),
  source_document_id uuid REFERENCES public.document_imports(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','superseded','canceled')),
  reconciliation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, balance_date, source_document_id)
);

ALTER TABLE public.account_balance_snapshots ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.account_balance_snapshots TO authenticated;
GRANT ALL ON public.account_balance_snapshots TO service_role;
DROP POLICY IF EXISTS "Users manage own balance snapshots" ON public.account_balance_snapshots;
CREATE POLICY "Users manage own balance snapshots" ON public.account_balance_snapshots
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS account_balance_snapshots_latest_idx
  ON public.account_balance_snapshots(user_id, account_id, balance_date DESC)
  WHERE status = 'confirmed';

-- Mantém os metadados enriquecidos ao confirmar um item, inclusive quando a
-- RPC instalada em um ambiente ainda é uma versão anterior.
CREATE OR REPLACE FUNCTION public.fill_import_transaction_metadata()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_doc uuid; v_idx int; v_item public.extracted_items%ROWTYPE;
BEGIN
  IF NEW.import_source_id IS NULL OR NEW.import_source_id !~ '^document:[0-9a-f-]+:[0-9]+$' THEN RETURN NEW; END IF;
  v_doc := split_part(NEW.import_source_id,':',2)::uuid;
  v_idx := split_part(NEW.import_source_id,':',3)::int;
  SELECT * INTO v_item FROM public.extracted_items
    WHERE document_id=v_doc AND idx=v_idx AND user_id=NEW.user_id;
  IF FOUND THEN
    NEW.raw_description:=coalesce(NEW.raw_description,v_item.raw_description);
    NEW.normalized_description:=coalesce(v_item.normalized_description,NEW.description);
    NEW.bank_reference:=coalesce(NEW.bank_reference,v_item.bank_reference);
    NEW.dedupe_fingerprint:=coalesce(NEW.dedupe_fingerprint,v_item.dedupe_fingerprint);
    NEW.movement_kind:=coalesce(v_item.movement_kind,'transaction');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fill_import_transaction_metadata ON public.transactions;
CREATE TRIGGER trg_fill_import_transaction_metadata BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fill_import_transaction_metadata();

CREATE OR REPLACE FUNCTION public.reconcile_document_balance(p_document_id uuid, p_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_doc public.document_imports%ROWTYPE;
  v_income numeric := 0; v_expense numeric := 0; v_calculated numeric; v_difference numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_doc FROM public.document_imports WHERE id=p_document_id AND user_id=v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found'; END IF;
  IF v_doc.statement_closing_balance IS NULL OR v_doc.statement_balance_date IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','statement_balance_missing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id=p_account_id AND user_id=v_uid) THEN
    RETURN jsonb_build_object('ok',false,'error','account_not_found');
  END IF;

  SELECT coalesce(sum(amount) FILTER (WHERE type='income'),0),
         coalesce(sum(amount) FILTER (WHERE type='expense'),0)
    INTO v_income,v_expense
    FROM public.extracted_items WHERE document_id=p_document_id AND user_id=v_uid
      AND status NOT IN ('ignored','rejected','duplicate_suspect','failed','rolled_back');
  v_calculated := coalesce(v_doc.statement_opening_balance,0)+v_income-v_expense;
  v_difference := v_doc.statement_closing_balance-v_calculated;

  INSERT INTO public.account_balance_snapshots(user_id,account_id,balance_date,balance,source,source_document_id,reconciliation)
  VALUES (v_uid,p_account_id,v_doc.statement_balance_date,v_doc.statement_closing_balance,'statement',p_document_id,
    jsonb_build_object('opening',v_doc.statement_opening_balance,'income',v_income,'expense',v_expense,
      'calculated_closing',v_calculated,'bank_closing',v_doc.statement_closing_balance,'difference',v_difference))
  ON CONFLICT (account_id,balance_date,source_document_id) DO UPDATE
    SET balance=excluded.balance,reconciliation=excluded.reconciliation,status='confirmed',updated_at=now();

  INSERT INTO public.document_import_audit(user_id,document_id,action,payload)
  VALUES(v_uid,p_document_id,'reconcile_balance',jsonb_build_object('account_id',p_account_id,'difference',v_difference));
  RETURN jsonb_build_object('ok',true,'bank_closing',v_doc.statement_closing_balance,
    'calculated_closing',v_calculated,'difference',v_difference);
END $$;
GRANT EXECUTE ON FUNCTION public.reconcile_document_balance(uuid,uuid) TO authenticated;

-- Corrige a função anterior: preserva transações editadas e permite repetir o
-- rollback sem apagar nada além do que foi criado por este documento.
CREATE OR REPLACE FUNCTION public.rollback_document_import(p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_removed int:=0; v_preserved int:=0; r record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM document_imports WHERE id=p_document_id AND user_id=v_uid) THEN
    RAISE EXCEPTION 'document_not_found';
  END IF;
  FOR r IN SELECT ei.id item_id,ei.transaction_id,ei.updated_at item_updated_at,t.updated_at tx_updated_at
    FROM extracted_items ei LEFT JOIN transactions t ON t.id=ei.transaction_id AND t.user_id=v_uid
    WHERE ei.document_id=p_document_id AND ei.user_id=v_uid AND ei.transaction_id IS NOT NULL
  LOOP
    IF r.tx_updated_at IS NOT NULL AND r.item_updated_at IS NOT NULL
       AND r.tx_updated_at > r.item_updated_at + interval '5 minutes' THEN
      v_preserved:=v_preserved+1; CONTINUE;
    END IF;
    DELETE FROM transactions WHERE id=r.transaction_id AND user_id=v_uid;
    UPDATE extracted_items SET transaction_id=NULL,status='rolled_back' WHERE id=r.item_id;
    v_removed:=v_removed+1;
  END LOOP;
  UPDATE account_balance_snapshots SET status='canceled',updated_at=now()
    WHERE source_document_id=p_document_id AND user_id=v_uid;
  UPDATE document_imports SET status='rolled_back',updated_at=now() WHERE id=p_document_id AND user_id=v_uid;
  INSERT INTO document_import_audit(user_id,document_id,action,payload)
    VALUES(v_uid,p_document_id,'rollback',jsonb_build_object('removed',v_removed,'preserved_edited',v_preserved));
  RETURN jsonb_build_object('ok',true,'removed',v_removed,'preserved_edited',v_preserved);
END $$;
GRANT EXECUTE ON FUNCTION public.rollback_document_import(uuid) TO authenticated;
