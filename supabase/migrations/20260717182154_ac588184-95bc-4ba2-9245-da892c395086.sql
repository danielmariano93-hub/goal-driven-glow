
-- Extended columns for richer extraction pipeline
ALTER TABLE public.extracted_items
  ADD COLUMN IF NOT EXISTS raw_description text,
  ADD COLUMN IF NOT EXISTS normalized_description text,
  ADD COLUMN IF NOT EXISTS bank_reference text,
  ADD COLUMN IF NOT EXISTS dedupe_fingerprint text,
  ADD COLUMN IF NOT EXISTS duplicate_reason text,
  ADD COLUMN IF NOT EXISTS category_source text,
  ADD COLUMN IF NOT EXISTS category_confidence numeric;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS raw_description text,
  ADD COLUMN IF NOT EXISTS bank_reference text,
  ADD COLUMN IF NOT EXISTS dedupe_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_dedupe_fingerprint_idx
  ON public.transactions(user_id, dedupe_fingerprint)
  WHERE dedupe_fingerprint IS NOT NULL;

ALTER TABLE public.document_imports
  ADD COLUMN IF NOT EXISTS user_instructions text,
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS statement_opening_balance numeric,
  ADD COLUMN IF NOT EXISTS statement_closing_balance numeric,
  ADD COLUMN IF NOT EXISTS statement_balance_date date,
  ADD COLUMN IF NOT EXISTS statement_bank text,
  ADD COLUMN IF NOT EXISTS counters jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Audit log for import-level actions (rollback etc.)
CREATE TABLE IF NOT EXISTS public.document_import_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_id uuid NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.document_import_audit TO authenticated;
GRANT ALL ON public.document_import_audit TO service_role;

ALTER TABLE public.document_import_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own import audit" ON public.document_import_audit;
CREATE POLICY "Users read own import audit"
  ON public.document_import_audit
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS document_import_audit_doc_idx
  ON public.document_import_audit(document_id, created_at DESC);

-- Rollback function: removes only transactions originated from this document,
-- preserving user edits done afterwards.
CREATE OR REPLACE FUNCTION public.rollback_document_import(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_removed integer := 0;
  v_preserved integer := 0;
  v_doc_owner uuid;
  r record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT user_id INTO v_doc_owner
  FROM public.document_imports
  WHERE id = p_document_id;

  IF v_doc_owner IS NULL OR v_doc_owner <> v_uid THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  FOR r IN
    SELECT ei.id AS item_id, ei.transaction_id, ei.updated_at AS item_updated_at,
           t.id AS tx_id, t.updated_at AS tx_updated_at
    FROM public.extracted_items ei
    LEFT JOIN public.transactions t ON t.id = ei.transaction_id AND t.user_id = v_uid
    WHERE ei.document_id = p_document_id
      AND ei.user_id = v_uid
      AND ei.transaction_id IS NOT NULL
  LOOP
    IF r.tx_id IS NULL THEN
      -- transaction already deleted; just clear pointer
      UPDATE public.extracted_items SET transaction_id = NULL, status = 'rolled_back'
      WHERE id = r.item_id;
      CONTINUE;
    END IF;

    IF r.tx_updated_at IS NOT NULL AND r.item_updated_at IS NOT NULL
       AND r.tx_updated_at > r.item_updated_at + INTERVAL '5 minutes' THEN
      v_preserved := v_preserved + 1;
      CONTINUE;
    END IF;

    DELETE FROM public.transactions
      WHERE id = r.tx_id AND user_id = v_uid;
    v_removed := v_removed + 1;

    UPDATE public.extracted_items SET transaction_id = NULL, status = 'rolled_back'
    WHERE id = r.item_id;
  END LOOP;

  UPDATE public.document_imports
     SET status = 'rolled_back'
   WHERE id = p_document_id AND user_id = v_uid;

  INSERT INTO public.document_import_audit(user_id, document_id, action, payload)
  VALUES (v_uid, p_document_id, 'rollback',
          jsonb_build_object('removed', v_removed, 'preserved_edited', v_preserved));

  RETURN jsonb_build_object('ok', true, 'removed', v_removed, 'preserved_edited', v_preserved);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rollback_document_import(uuid) TO authenticated;
