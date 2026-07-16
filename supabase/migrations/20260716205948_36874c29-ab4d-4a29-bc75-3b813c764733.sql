
-- =====================================================
-- Ingestão multimodal: document_imports + extracted_items + RPC
-- =====================================================

-- 1) document_imports
CREATE TABLE public.document_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('app','whatsapp')),
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL,
  document_kind text CHECK (document_kind IS NULL OR document_kind IN ('receipt','invoice','statement','list','non_financial','illegible','unknown')),
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','processing','needs_review','confirmed','partially_confirmed','failed','expired','canceled')),
  model text,
  tokens_in integer,
  tokens_out integer,
  cost_usd_micros bigint,
  raw_text text,
  error text,
  conversation_id uuid,
  message_id uuid,
  external_message_id text,
  extraction_ms integer,
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, sha256)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_imports TO authenticated;
GRANT ALL ON public.document_imports TO service_role;

ALTER TABLE public.document_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own document_imports"
  ON public.document_imports FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_document_imports_user ON public.document_imports(user_id, created_at DESC);
CREATE INDEX idx_document_imports_status ON public.document_imports(status);
CREATE INDEX idx_document_imports_conv ON public.document_imports(conversation_id) WHERE conversation_id IS NOT NULL;

-- 2) extracted_items
CREATE TABLE public.extracted_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.document_imports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  idx integer NOT NULL,
  status text NOT NULL DEFAULT 'needs_review'
    CHECK (status IN ('needs_review','ignored','confirmed','duplicate_suspect','rejected','failed')),
  type text NOT NULL CHECK (type IN ('income','expense')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  occurred_at date NOT NULL,
  description text,
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('account','credit_card')),
  account_hint text,
  card_hint text,
  account_id uuid,
  credit_card_id uuid,
  category_id uuid,
  category_hint text,
  installments_total integer CHECK (installments_total IS NULL OR (installments_total >= 1 AND installments_total <= 48)),
  installment_number integer CHECK (installment_number IS NULL OR (installment_number >= 1 AND installment_number <= 48)),
  purchase_date date,
  competence_date date,
  confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_of uuid,
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  source_span jsonb,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, idx)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.extracted_items TO authenticated;
GRANT ALL ON public.extracted_items TO service_role;

ALTER TABLE public.extracted_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own extracted_items"
  ON public.extracted_items FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_extracted_items_doc ON public.extracted_items(document_id, idx);
CREATE INDEX idx_extracted_items_user ON public.extracted_items(user_id, created_at DESC);
CREATE INDEX idx_extracted_items_status ON public.extracted_items(status);

-- 3) updated_at trigger reuse
CREATE TRIGGER document_imports_updated_at
  BEFORE UPDATE ON public.document_imports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER extracted_items_updated_at
  BEFORE UPDATE ON public.extracted_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) RPC confirm_document_import: idempotente, selecao parcial, purchase_group_id
CREATE OR REPLACE FUNCTION public.confirm_document_import(
  p_document_id uuid,
  p_item_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- purchase_group_id shared per (installments_total, card, purchase_date) inside the doc
  FOR v_item IN
    SELECT * FROM public.extracted_items
     WHERE document_id = p_document_id
       AND user_id = v_user
       AND id = ANY(p_item_ids)
     ORDER BY idx ASC
     FOR UPDATE
  LOOP
    -- idempotency: skip already-confirmed items
    IF v_item.transaction_id IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('item_id', v_item.id, 'reason', 'already_confirmed', 'transaction_id', v_item.transaction_id);
      CONTINUE;
    END IF;

    IF v_item.status = 'ignored' OR v_item.status = 'rejected' THEN
      v_skipped := v_skipped || jsonb_build_object('item_id', v_item.id, 'reason', 'status_'||v_item.status);
      CONTINUE;
    END IF;

    -- payment_method consistency check
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
      -- default to account only if account_id present
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

    -- purchase_group_id: reuse per document+card+purchase_date+installments_total (parcelas)
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
        payment_method, installment_number, installments_total,
        purchase_date, competence_date, purchase_group_id,
        origin, import_source_id
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
        v_item.payment_method,
        v_item.installment_number,
        v_item.installments_total,
        v_item.purchase_date,
        v_item.competence_date,
        v_group_id,
        'import'::txn_origin,
        'document:'||p_document_id::text||':'||v_item.idx::text
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

  -- Update doc status
  IF v_created_count = 0 THEN
    -- keep needs_review if some items still pending
    IF EXISTS (SELECT 1 FROM public.extracted_items WHERE document_id = p_document_id AND status IN ('needs_review','duplicate_suspect') AND transaction_id IS NULL) THEN
      NULL;
    END IF;
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
$$;

GRANT EXECUTE ON FUNCTION public.confirm_document_import(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_document_import(uuid, uuid[]) TO service_role;

-- 5) cancel helper (server-only via edge; client can also call)
CREATE OR REPLACE FUNCTION public.cancel_document_import(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.document_imports
     SET status = 'canceled'
   WHERE id = p_document_id AND user_id = v_user
     AND status IN ('uploaded','processing','needs_review','partially_confirmed','failed');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_terminal');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_document_import(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_document_import(uuid) TO service_role;

-- 6) Storage RLS on storage.objects (bucket 'documents')
-- Users can only touch objects under their own uid prefix.
DROP POLICY IF EXISTS "documents_own_read" ON storage.objects;
DROP POLICY IF EXISTS "documents_own_insert" ON storage.objects;
DROP POLICY IF EXISTS "documents_own_update" ON storage.objects;
DROP POLICY IF EXISTS "documents_own_delete" ON storage.objects;

CREATE POLICY "documents_own_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "documents_own_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "documents_own_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "documents_own_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
