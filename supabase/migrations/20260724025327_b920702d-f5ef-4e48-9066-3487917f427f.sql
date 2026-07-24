
-- === B. ACK semântico em outbound_messages ===
ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS accepted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at  timestamptz,
  ADD COLUMN IF NOT EXISTS read_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_ack_at   timestamptz,
  ADD COLUMN IF NOT EXISTS retry_count   integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS outbound_messages_ack_watchdog_idx
  ON public.outbound_messages(status, sent_at)
  WHERE status IN ('sent','processing');

-- === C. Idempotência ===
CREATE INDEX IF NOT EXISTS idempotency_keys_scope_key_idx
  ON public.idempotency_keys(scope, key);

-- === D. Fase do backfill ===
ALTER TABLE public.financial_backfill_checkpoints
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'baseline'
    CHECK (phase IN ('baseline','backfill','dual_read','cutover'));

-- === H. Diff canônico visível para admin ===
DROP POLICY IF EXISTS "admins read financial diffs" ON public.financial_metric_diffs;
CREATE POLICY "admins read financial diffs" ON public.financial_metric_diffs
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

ALTER TABLE public.financial_backfill_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_metric_diffs ENABLE ROW LEVEL SECURITY;

-- === Helper: transição de ACK monotônica ===
CREATE OR REPLACE FUNCTION public.apply_outbound_ack(
  p_provider_message_id text,
  p_ack text
) RETURNS TABLE(id uuid, new_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.outbound_messages%ROWTYPE;
  v_rank_cur int;
  v_rank_new int;
  v_ack text := lower(coalesce(p_ack,''));
BEGIN
  IF v_ack NOT IN ('sent','delivered','read') THEN
    RETURN;
  END IF;
  SELECT * INTO v_row FROM public.outbound_messages
   WHERE provider_message_id = p_provider_message_id
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_rank_cur := CASE v_row.status::text
                  WHEN 'queued' THEN 0
                  WHEN 'processing' THEN 0
                  WHEN 'sent' THEN 1
                  WHEN 'delivered' THEN 2
                  WHEN 'read' THEN 3
                  ELSE -1 END;
  v_rank_new := CASE v_ack
                  WHEN 'sent' THEN 1
                  WHEN 'delivered' THEN 2
                  WHEN 'read' THEN 3 END;

  IF v_rank_new > v_rank_cur THEN
    UPDATE public.outbound_messages
       SET status       = v_ack::msg_status,
           last_ack_at  = now(),
           sent_at      = COALESCE(sent_at, CASE WHEN v_ack IN ('sent','delivered','read') THEN now() END),
           delivered_at = COALESCE(delivered_at, CASE WHEN v_ack IN ('delivered','read') THEN now() END),
           read_at      = COALESCE(read_at, CASE WHEN v_ack = 'read' THEN now() END),
           updated_at   = now()
     WHERE id = v_row.id;
    RETURN QUERY SELECT v_row.id, v_ack;
  ELSIF v_rank_new = v_rank_cur THEN
    UPDATE public.outbound_messages SET last_ack_at = now() WHERE id = v_row.id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.apply_outbound_ack(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_outbound_ack(text,text) TO service_role;
