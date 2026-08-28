ALTER TABLE public.ai_runtime_circuit
  ADD COLUMN IF NOT EXISTS probe_after timestamptz,
  ADD COLUMN IF NOT EXISTS resumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS probe_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.pending_audio_transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid,
  inbound_message_id uuid,
  to_phone text NOT NULL,
  provider_message_id text,
  mime_type text NOT NULL,
  audio_base64 text NOT NULL,
  bytes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  reason text,
  locked_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '12 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_audio_provider_msg_uidx
  ON public.pending_audio_transcriptions (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pending_audio_status_idx
  ON public.pending_audio_transcriptions (status, created_at);

GRANT ALL ON public.pending_audio_transcriptions TO service_role;
ALTER TABLE public.pending_audio_transcriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_audio_service_only" ON public.pending_audio_transcriptions;
CREATE POLICY "pending_audio_service_only"
  ON public.pending_audio_transcriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);