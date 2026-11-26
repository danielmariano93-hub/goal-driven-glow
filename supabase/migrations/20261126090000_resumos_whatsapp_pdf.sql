-- Nino Insights: resumos financeiros em PDF pelo WhatsApp (semanal e mensal).
-- Tudo desligado por padrão: a flag por usuário `use_whatsapp_pdf_summaries` controla geração automática,
-- pedidos pelo WhatsApp e a troca do texto atual pelo PDF. Nada é enviado até a flag ser ligada.

-- 1) Flag por usuário.
ALTER TABLE public.financial_feature_flags
  ADD COLUMN IF NOT EXISTS use_whatsapp_pdf_summaries boolean NOT NULL DEFAULT false;

-- 2) Consentimento por tipo (origem e data do opt-in) e horário próprio dos resumos.
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS weekly_summary_opt_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS weekly_summary_opt_in_origin text,
  ADD COLUMN IF NOT EXISTS monthly_summary_opt_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS monthly_summary_opt_in_origin text,
  ADD COLUMN IF NOT EXISTS summary_hour smallint NOT NULL DEFAULT 8 CHECK (summary_hour BETWEEN 6 AND 22);

-- 3) Entregas dos resumos (um registro por usuário + tipo + período + canal).
CREATE TABLE IF NOT EXISTS public.financial_summary_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary_type text NOT NULL CHECK (summary_type IN ('weekly', 'monthly')),
  period_start date NOT NULL,
  period_end_exclusive date NOT NULL,
  as_of date NOT NULL,
  is_partial boolean NOT NULL DEFAULT false,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'none')),
  origin text NOT NULL CHECK (origin IN ('schedule', 'on_demand', 'resend', 'preview')),
  request_id text,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'generating', 'validated', 'sending', 'accepted', 'delivered',
    'failed_retryable', 'failed_final', 'unknown', 'cancelled')),
  storage_path text,
  size_bytes integer,
  file_sha256 text,
  template_version text,
  data_version text,
  outbound_message_id uuid,
  recipient_hint text,
  attempt_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_details text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX IF NOT EXISTS financial_summary_deliveries_user_idx ON public.financial_summary_deliveries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS financial_summary_deliveries_status_idx ON public.financial_summary_deliveries (status, updated_at);
CREATE INDEX IF NOT EXISTS financial_summary_deliveries_expiry_idx ON public.financial_summary_deliveries (expires_at) WHERE storage_path IS NOT NULL;

ALTER TABLE public.financial_summary_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "summary deliveries owner read" ON public.financial_summary_deliveries;
CREATE POLICY "summary deliveries owner read" ON public.financial_summary_deliveries
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Escrita só pelo service role (funções do servidor).

-- 4) Armazenamento privado dos PDFs (sem acesso público; link assinado curto na hora do envio).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('financial-summaries', 'financial-summaries', false, 1048576, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 1048576, allowed_mime_types = ARRAY['application/pdf'];

-- 5) Estado da entrega acompanha a confirmação do WhatsApp (accepted → delivered).
CREATE OR REPLACE FUNCTION public.sync_summary_delivery_from_outbound()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.context_type IS DISTINCT FROM 'financial_summary' OR NEW.context_id IS NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.financial_summary_deliveries d
     SET status = CASE
           WHEN NEW.delivered_at IS NOT NULL OR NEW.read_at IS NOT NULL OR NEW.status::text IN ('delivered', 'read') THEN 'delivered'
           WHEN NEW.status::text = 'dead' THEN 'failed_final'
           WHEN NEW.status::text = 'sent' THEN 'accepted'
           WHEN NEW.status::text = 'failed' OR (NEW.status::text = 'queued' AND NEW.last_error IS NOT NULL) THEN 'failed_retryable'
           ELSE d.status END,
         attempt_count = GREATEST(d.attempt_count, COALESCE(NEW.attempts, 0)),
         error_code = CASE WHEN NEW.status::text IN ('dead') OR (NEW.status::text = 'queued' AND NEW.last_error IS NOT NULL) THEN left(NEW.last_error, 120) ELSE d.error_code END,
         updated_at = now()
   WHERE d.id = NEW.context_id
     AND d.status NOT IN ('delivered', 'cancelled');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_summary_delivery ON public.outbound_messages;
CREATE TRIGGER trg_sync_summary_delivery
  AFTER UPDATE OF status, delivered_at, read_at, last_error, attempts ON public.outbound_messages
  FOR EACH ROW WHEN (NEW.context_type = 'financial_summary')
  EXECUTE FUNCTION public.sync_summary_delivery_from_outbound();

REVOKE ALL ON FUNCTION public.sync_summary_delivery_from_outbound() FROM PUBLIC, anon, authenticated;
-- Retenção de 30 dias: o despachante (`financial-summaries-dispatch`) apaga os PDFs vencidos pela API de armazenamento.

-- 6) Despacho de hora em hora: a função decide, pelo fuso e horário de cada usuário com a flag ligada,
-- se é segunda (semanal) ou dia 2 (mensal) na hora escolhida. Sem flag ligada, não faz nada.
CREATE OR REPLACE FUNCTION public.financial_summaries_dispatch_tick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'vault' AS $function$
DECLARE secret_value text; request_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.financial_feature_flags WHERE use_whatsapp_pdf_summaries) THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO secret_value FROM vault.decrypted_secrets
   WHERE name IN ('INTERNAL_CRON_SECRET','meunino_cron_secret','nocontrole_cron_secret')
   ORDER BY CASE name WHEN 'INTERNAL_CRON_SECRET' THEN 0 WHEN 'meunino_cron_secret' THEN 1 ELSE 2 END, created_at DESC LIMIT 1;
  IF nullif(secret_value, '') IS NULL THEN RAISE EXCEPTION 'cron_secret_missing'; END IF;
  SELECT net.http_post(
    url := 'https://amjanjlvsatubxdreyep.supabase.co/functions/v1/financial-summaries-dispatch',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', secret_value),
    body := jsonb_build_object('mode','cron')
  ) INTO request_id;
  RETURN request_id;
END $function$;
REVOKE ALL ON FUNCTION public.financial_summaries_dispatch_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_summaries_dispatch_tick() TO service_role;

DO $$ BEGIN
  PERFORM cron.unschedule('financial-summaries-dispatch-hourly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'financial-summaries-dispatch-hourly');
  PERFORM cron.schedule('financial-summaries-dispatch-hourly', '2 * * * *', 'select public.financial_summaries_dispatch_tick();');
END $$;
