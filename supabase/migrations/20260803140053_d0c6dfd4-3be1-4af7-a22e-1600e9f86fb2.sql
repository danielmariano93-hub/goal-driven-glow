ALTER TABLE public.pending_proactive_suggestions DROP CONSTRAINT IF EXISTS pps_status_chk;
ALTER TABLE public.pending_proactive_suggestions
  ADD CONSTRAINT pps_status_chk CHECK (status = ANY (ARRAY[
    'pending'::text,'dispatched'::text,'dismissed'::text,'expired'::text,
    'deferred'::text,'awaiting_approval'::text]));