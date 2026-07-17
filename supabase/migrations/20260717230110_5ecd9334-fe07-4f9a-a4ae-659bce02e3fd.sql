-- Document ingestion durability: attempt_count, next_attempt_at, source, provider_message_id.
-- Progress events for panel and WhatsApp. Idempotent.

ALTER TABLE public.document_imports
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS document_imports_provider_message_uniq
  ON public.document_imports(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS document_imports_processing_updated_idx
  ON public.document_imports(status, updated_at)
  WHERE status = 'processing';

CREATE TABLE IF NOT EXISTS public.document_processing_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.document_imports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'document_received','processing_started','fragment_completed',
    'items_quarantined','review_ready','processing_completed','processing_failed'
  )),
  stage TEXT,
  progress_current INT,
  progress_total INT,
  items_found INT,
  items_valid INT,
  items_rejected INT,
  error_code TEXT,
  user_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_processing_events TO authenticated;
GRANT ALL ON public.document_processing_events TO service_role;

ALTER TABLE public.document_processing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own events" ON public.document_processing_events;
CREATE POLICY "Users read own events" ON public.document_processing_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS document_processing_events_doc_idx
  ON public.document_processing_events(document_id, created_at DESC);