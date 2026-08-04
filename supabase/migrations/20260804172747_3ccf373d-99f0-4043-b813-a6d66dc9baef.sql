-- Antecipação real + Participante com comprovante (anticipation_contract.v2 / split_receipt.v1)

-- 1) Mensagens recebidas: persistência de mídia, intenção e correlação
ALTER TABLE public.inbound_messages
  ADD COLUMN IF NOT EXISTS has_media boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS media_kind text,
  ADD COLUMN IF NOT EXISTS media_mime text,
  ADD COLUMN IF NOT EXISTS media_bytes bigint,
  ADD COLUMN IF NOT EXISTS media_storage_path text,
  ADD COLUMN IF NOT EXISTS media_error text,
  ADD COLUMN IF NOT EXISTS detected_intent text,
  ADD COLUMN IF NOT EXISTS participant_id uuid REFERENCES public.shared_expense_participants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS document_import_id uuid REFERENCES public.document_imports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS logical_dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS inbound_messages_logical_dedup_key_uidx
  ON public.inbound_messages (logical_dedup_key) WHERE logical_dedup_key IS NOT NULL;

-- 2) Novos estados do participante (comprovante enviado / aguardando dono)
ALTER TYPE public.participant_status ADD VALUE IF NOT EXISTS 'payment_reported';
ALTER TYPE public.participant_status ADD VALUE IF NOT EXISTS 'awaiting_owner_confirmation';

-- 3) Contexto conversacional do participante externo (não é usuário do app)
CREATE TABLE IF NOT EXISTS public.participant_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.shared_expense_participants(id) ON DELETE CASCADE,
  shared_expense_id uuid NOT NULL REFERENCES public.shared_expenses(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  phone_e164 text NOT NULL,
  last_intent text,
  last_message_at timestamptz,
  awaiting_receipt boolean NOT NULL DEFAULT false,
  awaiting_receipt_since timestamptz,
  receipt_count integer NOT NULL DEFAULT 0,
  last_receipt_at timestamptz,
  reported_amount numeric(14,2),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id)
);

GRANT SELECT ON public.participant_contexts TO authenticated;
GRANT ALL ON public.participant_contexts TO service_role;
ALTER TABLE public.participant_contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads participant contexts"
  ON public.participant_contexts FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE INDEX IF NOT EXISTS participant_contexts_phone_idx ON public.participant_contexts (phone_e164);
CREATE INDEX IF NOT EXISTS participant_contexts_owner_idx ON public.participant_contexts (owner_user_id);

CREATE TRIGGER participant_contexts_touch
  BEFORE UPDATE ON public.participant_contexts
  FOR EACH ROW EXECUTE FUNCTION public._touch_updated_at();

-- 4) Preferências granulares de antecipação
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS anticipation_max_per_week integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS anticipation_consent_at timestamptz;