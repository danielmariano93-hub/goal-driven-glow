CREATE TABLE IF NOT EXISTS public.whatsapp_lid_map (
  lid text PRIMARY KEY,
  phone_e164 text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.whatsapp_lid_map TO service_role;

ALTER TABLE public.whatsapp_lid_map ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.provider_inbound_drops ADD COLUMN IF NOT EXISTS lid_masked text;