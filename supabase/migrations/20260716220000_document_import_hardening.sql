-- Final hardening for document ingestion. Incremental and data-preserving.

UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[]
WHERE id = 'documents';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extracted_items_account_id_fkey') THEN
    ALTER TABLE public.extracted_items
      ADD CONSTRAINT extracted_items_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extracted_items_credit_card_id_fkey') THEN
    ALTER TABLE public.extracted_items
      ADD CONSTRAINT extracted_items_credit_card_id_fkey
      FOREIGN KEY (credit_card_id) REFERENCES public.credit_cards(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extracted_items_category_id_fkey') THEN
    ALTER TABLE public.extracted_items
      ADD CONSTRAINT extracted_items_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extracted_items_duplicate_of_fkey') THEN
    ALTER TABLE public.extracted_items
      ADD CONSTRAINT extracted_items_duplicate_of_fkey
      FOREIGN KEY (duplicate_of) REFERENCES public.transactions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Admin-only aggregate. Raw document errors and user data are deliberately omitted.
CREATE OR REPLACE FUNCTION public.admin_document_metrics(p_days integer DEFAULT 30)
RETURNS TABLE (
  total bigint,
  succeeded bigint,
  failed bigint,
  pending bigint,
  success_rate numeric,
  tokens_in bigint,
  tokens_out bigint,
  avg_latency_ms numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE d.status IN ('confirmed','partially_confirmed'))::bigint,
    count(*) FILTER (WHERE d.status = 'failed')::bigint,
    count(*) FILTER (WHERE d.status IN ('uploaded','processing','needs_review'))::bigint,
    CASE WHEN count(*) = 0 THEN 0
      ELSE round(100.0 * count(*) FILTER (WHERE d.status IN ('confirmed','partially_confirmed')) / count(*), 1)
    END,
    coalesce(sum(d.tokens_in), 0)::bigint,
    coalesce(sum(d.tokens_out), 0)::bigint,
    round(coalesce(avg(d.extraction_ms), 0), 0)
  FROM public.document_imports d
  WHERE d.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_document_metrics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_document_metrics(integer) TO authenticated, service_role;
