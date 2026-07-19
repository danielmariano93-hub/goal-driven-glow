
-- =========================================================
-- doc-pipeline-v2: fundação para fragmentos persistidos,
-- contexto de origem, descrições em camadas, aliases e
-- reprocessamento seguro. Totalmente idempotente.
-- =========================================================

-- 1) document_imports: contexto de origem + período do extrato
ALTER TABLE public.document_imports
  ADD COLUMN IF NOT EXISTS source_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_context_method text,
  ADD COLUMN IF NOT EXISTS source_context_confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS source_context_reason text,
  ADD COLUMN IF NOT EXISTS statement_period_start date,
  ADD COLUMN IF NOT EXISTS statement_period_end date;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='document_imports_source_context_method_check') THEN
    ALTER TABLE public.document_imports
      ADD CONSTRAINT document_imports_source_context_method_check
      CHECK (source_context_method IS NULL OR source_context_method IN
        ('user_selected','statement_bank','guidance','single_account','none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='document_imports_source_context_exclusive_check') THEN
    ALTER TABLE public.document_imports
      ADD CONSTRAINT document_imports_source_context_exclusive_check
      CHECK (source_account_id IS NULL OR source_credit_card_id IS NULL);
  END IF;
END $$;

-- 2) document_fragments: persistência durável de fragmentos
CREATE TABLE IF NOT EXISTS public.document_fragments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.document_imports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fragment_index int NOT NULL,
  total_fragments int NOT NULL,
  page_start int NOT NULL,
  page_end int NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','skipped')),
  attempts int NOT NULL DEFAULT 0,
  heartbeat_at timestamptz,
  items_found int NOT NULL DEFAULT 0,
  duplicates_found int NOT NULL DEFAULT 0,
  error text,
  error_code text,
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  extraction_ms int NOT NULL DEFAULT 0,
  partial boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id, fragment_index)
);

GRANT SELECT ON public.document_fragments TO authenticated;
GRANT ALL ON public.document_fragments TO service_role;

ALTER TABLE public.document_fragments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own document fragments" ON public.document_fragments;
CREATE POLICY "Users read own document fragments" ON public.document_fragments
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS document_fragments_doc_idx
  ON public.document_fragments(document_id, fragment_index);
CREATE INDEX IF NOT EXISTS document_fragments_pending_idx
  ON public.document_fragments(document_id) WHERE status IN ('pending','failed','processing');

DROP TRIGGER IF EXISTS trg_document_fragments_updated_at ON public.document_fragments;
CREATE TRIGGER trg_document_fragments_updated_at
  BEFORE UPDATE ON public.document_fragments
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- 3) Descrições em camadas
ALTER TABLE public.extracted_items
  ADD COLUMN IF NOT EXISTS bank_description text,
  ADD COLUMN IF NOT EXISTS friendly_description text;
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS bank_description text,
  ADD COLUMN IF NOT EXISTS friendly_description text;

UPDATE public.extracted_items
  SET bank_description = COALESCE(bank_description, raw_description),
      friendly_description = COALESCE(friendly_description, description)
  WHERE bank_description IS NULL OR friendly_description IS NULL;
UPDATE public.transactions
  SET bank_description = COALESCE(bank_description, raw_description),
      friendly_description = COALESCE(friendly_description, description)
  WHERE bank_description IS NULL OR friendly_description IS NULL;

-- 4) merchant_aliases
CREATE TABLE IF NOT EXISTS public.merchant_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alias_key text NOT NULL,
  friendly_name text NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  learned_from text NOT NULL DEFAULT 'manual'
    CHECK (learned_from IN ('manual','confirmation')),
  hits int NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, alias_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.merchant_aliases TO authenticated;
GRANT ALL ON public.merchant_aliases TO service_role;

ALTER TABLE public.merchant_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own merchant aliases" ON public.merchant_aliases;
CREATE POLICY "Users manage own merchant aliases" ON public.merchant_aliases
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS merchant_aliases_user_key_idx
  ON public.merchant_aliases(user_id, alias_key);

DROP TRIGGER IF EXISTS trg_merchant_aliases_updated_at ON public.merchant_aliases;
CREATE TRIGGER trg_merchant_aliases_updated_at
  BEFORE UPDATE ON public.merchant_aliases
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- 5) Limite configurável de itens por documento
ALTER TABLE public.user_financial_settings
  ADD COLUMN IF NOT EXISTS doc_max_items int NOT NULL DEFAULT 240;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_financial_settings_doc_max_items_check') THEN
    ALTER TABLE public.user_financial_settings
      ADD CONSTRAINT user_financial_settings_doc_max_items_check
      CHECK (doc_max_items BETWEEN 40 AND 800);
  END IF;
END $$;

-- 6) RPC: reprocess_rejected_items
CREATE OR REPLACE FUNCTION public.reprocess_rejected_items(
  p_document_id uuid,
  p_reason_codes text[] DEFAULT ARRAY['invalid_movement_kind','invalid_payment_method','empty_description','invalid_date']
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_doc public.document_imports%ROWTYPE;
  v_recovered int := 0;
  v_skipped int := 0;
  r record;
  v_fallback_date date;
  v_new_date date;
  v_new_mk text;
  v_new_pm text;
  v_next_idx int;
  v_desc text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_doc FROM public.document_imports WHERE id=p_document_id AND user_id=v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found'; END IF;

  v_fallback_date := COALESCE(v_doc.statement_period_end, v_doc.statement_balance_date, current_date);
  SELECT COALESCE(MAX(idx),-1)+1 INTO v_next_idx
    FROM public.extracted_items WHERE document_id=p_document_id;

  FOR r IN
    SELECT * FROM public.document_item_rejections
     WHERE document_id=p_document_id AND user_id=v_uid AND reason_code = ANY(p_reason_codes)
  LOOP
    v_desc := COALESCE(NULLIF(trim(coalesce((r.raw_payload->>'description')::text,'')), ''), '(sem descrição)');
    v_new_mk := CASE WHEN r.reason_code='invalid_movement_kind' THEN 'transaction'
                     ELSE COALESCE(NULLIF(r.raw_payload->>'movement_kind',''),'transaction') END;
    IF v_new_mk NOT IN ('transaction','refund','internal_transfer','investment_application','investment_redemption') THEN
      v_new_mk := 'transaction';
    END IF;
    v_new_pm := NULLIF(r.raw_payload->>'payment_method','');
    IF v_new_pm IS NOT NULL AND v_new_pm NOT IN ('account','credit_card') THEN v_new_pm := NULL; END IF;
    BEGIN
      v_new_date := (r.raw_payload->>'occurred_at')::date;
    EXCEPTION WHEN OTHERS THEN v_new_date := NULL; END;
    IF v_new_date IS NULL OR v_new_date > current_date + interval '1 day' THEN
      v_new_date := v_fallback_date;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.extracted_items
       WHERE document_id=p_document_id AND user_id=v_uid
         AND type=COALESCE(r.raw_payload->>'type','expense')
         AND occurred_at=v_new_date
         AND amount=COALESCE((r.raw_payload->>'amount')::numeric,0)
         AND lower(coalesce(description,''))=lower(v_desc)
    ) THEN
      v_skipped := v_skipped + 1;
      DELETE FROM public.document_item_rejections WHERE id=r.id;
      CONTINUE;
    END IF;

    INSERT INTO public.extracted_items(
      user_id, document_id, idx, type, description, raw_description, bank_description, friendly_description,
      amount, occurred_at, payment_method, movement_kind, status, confidence, source_span
    ) VALUES (
      v_uid, p_document_id, v_next_idx,
      COALESCE(r.raw_payload->>'type','expense'),
      v_desc, v_desc, v_desc, v_desc,
      COALESCE((r.raw_payload->>'amount')::numeric,0),
      v_new_date, v_new_pm, v_new_mk, 'needs_review',
      '{"recovered":0.6}'::jsonb, r.raw_payload->'source_span'
    );
    v_next_idx := v_next_idx + 1;
    v_recovered := v_recovered + 1;
    DELETE FROM public.document_item_rejections WHERE id=r.id;
  END LOOP;

  INSERT INTO public.document_import_audit(user_id, document_id, action, payload)
  VALUES (v_uid, p_document_id, 'reprocess_rejected',
    jsonb_build_object('recovered', v_recovered, 'skipped_duplicates', v_skipped, 'reasons', p_reason_codes));

  IF v_recovered > 0 AND v_doc.status IN ('failed','rolled_back') THEN
    UPDATE public.document_imports SET status='needs_review', error=NULL, updated_at=now()
      WHERE id=p_document_id AND user_id=v_uid;
  END IF;

  RETURN jsonb_build_object('ok',true,'recovered',v_recovered,'skipped_duplicates',v_skipped);
END $$;

-- 7) Reafirma GRANTs das RPCs cliente
GRANT EXECUTE ON FUNCTION public.reprocess_rejected_items(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reprocess_rejected_items(uuid, text[]) TO service_role;

DO $$
DECLARE r record; sig text;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'confirm_document_import','cancel_document_import',
      'reconcile_document_balance','rollback_document_import'
    )
  LOOP
    sig := format('public.%I(%s)', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;
