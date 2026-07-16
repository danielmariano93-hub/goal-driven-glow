
CREATE OR REPLACE FUNCTION public.claim_reminder_jobs(p_limit int DEFAULT 10)
RETURNS SETOF public.reminder_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  cur_hour int;
BEGIN
  cur_hour := EXTRACT(hour FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int;
  -- Fora do horário útil (08–22 SP): não entrega nada
  IF cur_hour < 8 OR cur_hour >= 22 THEN
    RETURN;
  END IF;
  RETURN QUERY
    UPDATE public.reminder_jobs r
       SET status = 'processing'::reminder_status,
           attempts = coalesce(r.attempts, 0) + 1,
           lease_expires_at = now() + interval '2 minutes',
           updated_at = now()
     WHERE r.id IN (
       SELECT id FROM public.reminder_jobs
        WHERE (status = 'queued'::reminder_status
               OR (status = 'processing'::reminder_status AND lease_expires_at < now()))
          AND scheduled_for <= now()
          AND coalesce(attempts, 0) < 5
        ORDER BY scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
     )
     RETURNING r.*;
END $$;

REVOKE ALL ON FUNCTION public.claim_reminder_jobs(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reminder_jobs(int) TO service_role;
