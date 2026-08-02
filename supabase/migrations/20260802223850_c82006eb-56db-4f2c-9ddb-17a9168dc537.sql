-- Identidade documental dos lançamentos importados (import_item.v2)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source_document_id uuid,
  ADD COLUMN IF NOT EXISTS source_line_index integer,
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE INDEX IF NOT EXISTS idx_transactions_source_line
  ON public.transactions(user_id, source_document_id, source_line_index)
  WHERE source_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_external_id
  ON public.transactions(user_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_posted_at
  ON public.transactions(user_id, account_id, posted_at);

-- Backfill a partir de import_source_id = 'document:<uuid>:<idx>'
UPDATE public.transactions t
   SET source_document_id = split_part(t.import_source_id, ':', 2)::uuid,
       source_line_index  = NULLIF(split_part(t.import_source_id, ':', 3), '')::int
 WHERE t.import_source_id LIKE 'document:%'
   AND t.source_document_id IS NULL
   AND split_part(t.import_source_id, ':', 2) ~ '^[0-9a-fA-F-]{36}$'
   AND split_part(t.import_source_id, ':', 3) ~ '^[0-9]+$';

-- Propaga identidade documental e data bancária real na criação do lançamento
CREATE OR REPLACE FUNCTION public.tf_transactions_source_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc uuid;
  v_idx int;
  v_posted date;
  v_posted_src text;
  v_ext text;
BEGIN
  IF NEW.source_document_id IS NULL
     AND NEW.import_source_id LIKE 'document:%'
     AND split_part(NEW.import_source_id, ':', 2) ~ '^[0-9a-fA-F-]{36}$'
     AND split_part(NEW.import_source_id, ':', 3) ~ '^[0-9]+$' THEN
    v_doc := split_part(NEW.import_source_id, ':', 2)::uuid;
    v_idx := split_part(NEW.import_source_id, ':', 3)::int;
    NEW.source_document_id := v_doc;
    NEW.source_line_index := v_idx;
  ELSE
    v_doc := NEW.source_document_id;
    v_idx := NEW.source_line_index;
  END IF;

  IF v_doc IS NOT NULL AND v_idx IS NOT NULL THEN
    SELECT x.posted_at, x.posted_at_source, x.external_id
      INTO v_posted, v_posted_src, v_ext
      FROM public.extracted_items x
     WHERE x.document_id = v_doc
       AND coalesce(x.source_line_index, x.idx) = v_idx
     LIMIT 1;
    IF NEW.posted_at IS NULL AND v_posted IS NOT NULL THEN
      NEW.posted_at := v_posted;
      NEW.posted_at_source := coalesce(v_posted_src, 'statement');
    END IF;
    IF NEW.external_id IS NULL THEN
      NEW.external_id := coalesce(v_ext, 'doc:' || v_doc::text || ':' || v_idx::text);
    END IF;
  END IF;

  -- Data bancária provisória: nunca deixa nulo em movimento de conta.
  IF NEW.posted_at IS NULL AND NEW.account_id IS NOT NULL AND NEW.credit_card_id IS NULL THEN
    NEW.posted_at := NEW.occurred_at;
    NEW.posted_at_source := coalesce(NEW.posted_at_source, 'inferred');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_source_identity ON public.transactions;
CREATE TRIGGER trg_transactions_source_identity
  BEFORE INSERT OR UPDATE OF import_source_id, source_document_id, source_line_index
  ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.tf_transactions_source_identity();