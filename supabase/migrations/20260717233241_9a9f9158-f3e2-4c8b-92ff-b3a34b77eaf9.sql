-- 1) Rejections table (quarantine of invalid extracted rows)
CREATE TABLE IF NOT EXISTS public.document_item_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.document_imports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_index INTEGER,
  reason_code TEXT NOT NULL,
  reason_field TEXT,
  reason_message TEXT,
  offending_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  description_excerpt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_item_rejections TO authenticated;
GRANT ALL ON public.document_item_rejections TO service_role;

ALTER TABLE public.document_item_rejections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='document_item_rejections' AND policyname='own document_item_rejections'
  ) THEN
    CREATE POLICY "own document_item_rejections"
      ON public.document_item_rejections FOR SELECT
      TO authenticated USING (auth.uid() = user_id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS document_item_rejections_doc_idx
  ON public.document_item_rejections(document_id, created_at DESC);

-- 2) Idempotently add 'partial' to document_imports.status check
DO $$
DECLARE
  cur TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO cur
  FROM pg_constraint
  WHERE conname='document_imports_status_check' AND conrelid='public.document_imports'::regclass;
  IF cur IS NULL OR position('''partial''' in cur) = 0 THEN
    IF cur IS NOT NULL THEN
      ALTER TABLE public.document_imports DROP CONSTRAINT document_imports_status_check;
    END IF;
    ALTER TABLE public.document_imports
      ADD CONSTRAINT document_imports_status_check
      CHECK (status = ANY (ARRAY[
        'uploaded','processing','needs_review','partial',
        'confirmed','partially_confirmed','failed','expired','canceled','rolled_back'
      ]));
  END IF;
END$$;
