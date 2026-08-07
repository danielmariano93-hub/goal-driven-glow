-- Meu Nino Reliability / Behavioral Truth v9
-- Observabilidade sanitizada do data plane WhatsApp + health contract.
-- A matemática da verdade comportamental vive no código compartilhado; esta
-- migration não cria uma fórmula concorrente no banco.
BEGIN;

-- Deployment guard: o agente V9 foi auditado contra category_type={income,expense}.
-- Se o schema não tiver os dois tipos fundamentais, é mais seguro abortar a
-- migration do que publicar um agente que falhará somente em runtime.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
     WHERE t.typname='category_type' AND e.enumlabel='income'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
     WHERE t.typname='category_type' AND e.enumlabel='expense'
  ) THEN
    RAISE EXCEPTION 'nino_v9_category_type_contract_mismatch';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.whatsapp_pipeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL CHECK (stage IN (
    'webhook_received','webhook_dropped','provider_session','inbound_persisted',
    'agent_started','agent_completed','outbound_queued','provider_sent',
    'ack_received','failed'
  )),
  ok boolean NOT NULL DEFAULT true,
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  inbound_message_id uuid NULL REFERENCES public.inbound_messages(id) ON DELETE SET NULL,
  outbound_message_id uuid NULL REFERENCES public.outbound_messages(id) ON DELETE SET NULL,
  agent_run_id uuid NULL REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  provider_message_hash text NULL,
  session text NULL,
  error_code text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_pipeline_events_occurred_idx
  ON public.whatsapp_pipeline_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_pipeline_events_user_idx
  ON public.whatsapp_pipeline_events(user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_pipeline_events_inbound_idx
  ON public.whatsapp_pipeline_events(inbound_message_id, occurred_at)
  WHERE inbound_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_pipeline_events_outbound_idx
  ON public.whatsapp_pipeline_events(outbound_message_id, occurred_at)
  WHERE outbound_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_pipeline_events_failed_idx
  ON public.whatsapp_pipeline_events(occurred_at DESC)
  WHERE ok = false OR stage = 'failed';

ALTER TABLE public.whatsapp_pipeline_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_pipeline_events FROM anon, authenticated;
GRANT ALL ON TABLE public.whatsapp_pipeline_events TO service_role;

COMMENT ON TABLE public.whatsapp_pipeline_events IS
  'Sanitized WAHA data-plane telemetry. Never stores message bodies, phone numbers, URLs or secrets.';

-- Health do canal do PRÓPRIO usuário. Vínculo ativo não equivale mais a canal
-- saudável: a função distingue vínculo, provedor e round-trip real.
CREATE OR REPLACE FUNCTION public.my_whatsapp_channel_health_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_linked boolean := false;
  v_last_inbound timestamptz;
  v_last_outbound timestamptz;
  v_last_ack timestamptz;
  v_last_failure timestamptz;
  v_last_provider_health timestamptz;
  v_provider_ok boolean;
  v_outbound_status text;
  v_state text := 'unlinked';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated', 'contract', 'whatsapp_channel_health.v1');
  END IF;

  SELECT phone_e164 INTO v_phone
    FROM public.whatsapp_links
   WHERE user_id = v_uid AND status::text = 'active'
   ORDER BY updated_at DESC
   LIMIT 1;
  v_linked := v_phone IS NOT NULL;

  IF NOT v_linked THEN
    RETURN jsonb_build_object(
      'ok', true, 'linked', false, 'state', 'unlinked',
      'provider_ok', null, 'last_inbound_at', null, 'last_outbound_at', null,
      'last_ack_at', null, 'last_failure_at', null,
      'contract', 'whatsapp_channel_health.v1'
    );
  END IF;

  SELECT received_at INTO v_last_inbound
    FROM public.inbound_messages
   WHERE from_phone = v_phone
   ORDER BY received_at DESC
   LIMIT 1;

  SELECT created_at, status::text, COALESCE(read_at, delivered_at, last_ack_at)
    INTO v_last_outbound, v_outbound_status, v_last_ack
    FROM public.outbound_messages
   WHERE user_id = v_uid AND COALESCE(channel, 'whatsapp') = 'whatsapp'
   ORDER BY created_at DESC
   LIMIT 1;

  SELECT occurred_at INTO v_last_failure
    FROM public.whatsapp_pipeline_events
   WHERE user_id = v_uid AND (ok = false OR stage = 'failed')
   ORDER BY occurred_at DESC
   LIMIT 1;

  SELECT ok, occurred_at INTO v_provider_ok, v_last_provider_health
    FROM public.provider_health_events
   WHERE provider::text = 'waha'
   ORDER BY occurred_at DESC
   LIMIT 1;

  -- Ordem importa: provider explicitamente DOWN é P0, mesmo que haja ACK antigo.
  IF v_provider_ok = false
     AND v_last_provider_health IS NOT NULL
     AND v_last_provider_health > now() - interval '15 minutes' THEN
    v_state := 'broken';
  ELSIF v_last_inbound IS NOT NULL
     AND v_last_inbound < now() - interval '5 minutes'
     AND (v_last_outbound IS NULL OR v_last_outbound < v_last_inbound) THEN
    v_state := 'degraded';
  ELSIF v_last_inbound IS NOT NULL
     AND v_last_outbound IS NOT NULL
     AND v_last_outbound >= v_last_inbound
     AND v_last_inbound > now() - interval '7 days'
     AND v_outbound_status IN ('sent','accepted','delivered','read') THEN
    v_state := 'verified';
  ELSIF v_last_failure IS NOT NULL
     AND v_last_failure > now() - interval '15 minutes'
     AND (v_last_outbound IS NULL OR v_last_failure > v_last_outbound) THEN
    v_state := 'degraded';
  ELSE
    v_state := 'linked_unverified';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'linked', true,
    'state', v_state,
    'provider_ok', v_provider_ok,
    'last_inbound_at', v_last_inbound,
    'last_outbound_at', v_last_outbound,
    'last_ack_at', v_last_ack,
    'last_failure_at', v_last_failure,
    'contract', 'whatsapp_channel_health.v1'
  );
END $$;

REVOKE ALL ON FUNCTION public.my_whatsapp_channel_health_v1() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_whatsapp_channel_health_v1() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
