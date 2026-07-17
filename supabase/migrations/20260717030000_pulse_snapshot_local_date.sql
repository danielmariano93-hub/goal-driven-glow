-- Stable per-user local day for Pulse snapshots. This replaces the previous
-- fixed America/Sao_Paulo expression index without deleting historical data.
ALTER TABLE public.pulse_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_date date;

UPDATE public.pulse_snapshots
SET snapshot_date = (computed_at AT TIME ZONE 'America/Sao_Paulo')::date
WHERE snapshot_date IS NULL;

ALTER TABLE public.pulse_snapshots
  ALTER COLUMN snapshot_date SET NOT NULL;

DROP INDEX IF EXISTS public.pulse_snapshots_one_per_day;
CREATE UNIQUE INDEX IF NOT EXISTS pulse_snapshots_user_local_day
  ON public.pulse_snapshots (user_id, snapshot_date);
