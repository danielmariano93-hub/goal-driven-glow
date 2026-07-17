CREATE TABLE IF NOT EXISTS public.provider_inbound_drops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  reason text NOT NULL,
  event text,
  session text,
  jid_domains text[] NOT NULL DEFAULT '{}',
  has_alt boolean NOT NULL DEFAULT false,
  has_key boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_inbound_drops_occurred_idx ON public.provider_inbound_drops (occurred_at DESC);
GRANT SELECT ON public.provider_inbound_drops TO authenticated;
GRANT ALL ON public.provider_inbound_drops TO service_role;
ALTER TABLE public.provider_inbound_drops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read provider_inbound_drops" ON public.provider_inbound_drops;
CREATE POLICY "admins read provider_inbound_drops" ON public.provider_inbound_drops FOR SELECT TO authenticated USING (public.is_current_user_admin());