ALTER TABLE public.document_imports ADD COLUMN IF NOT EXISTS reading_coverage jsonb;

ALTER TABLE public.user_financial_settings ADD COLUMN IF NOT EXISTS doc_max_items integer;

SELECT cron.unschedule('documents-cleanup-6h');
SELECT cron.schedule('documents-cleanup-2m', '*/2 * * * *', $$SELECT public.documents_cleanup_tick()$$);