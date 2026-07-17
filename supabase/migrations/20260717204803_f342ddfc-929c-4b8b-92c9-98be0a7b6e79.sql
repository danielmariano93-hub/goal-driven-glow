UPDATE public.document_imports
SET status = 'failed',
    error = 'timeout:aborted|cid=recovery-manual',
    updated_at = now()
WHERE status = 'processing'
  AND updated_at < now() - interval '5 minutes';