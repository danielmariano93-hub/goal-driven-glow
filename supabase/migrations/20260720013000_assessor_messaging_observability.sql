-- Assessor + mensageria: recuperação de imports, cancelamento atômico e
-- observabilidade administrativa. Idempotente e seguro para dados existentes.

ALTER TABLE public.outbound_messages
  ADD COLUMN IF NOT EXISTS context_type text,
  ADD COLUMN IF NOT EXISTS context_id uuid,
  ADD COLUMN IF NOT EXISTS participant_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS outbound_messages_context_idx
  ON public.outbound_messages(context_type, context_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outbound_messages_created_idx
  ON public.outbound_messages(created_at DESC);

ALTER TABLE public.document_processing_events
  DROP CONSTRAINT IF EXISTS document_processing_events_event_type_check;
ALTER TABLE public.document_processing_events
  ADD CONSTRAINT document_processing_events_event_type_check CHECK (event_type IN (
    'document_received','processing_started','fragment_completed','items_quarantined',
    'review_ready','partial_result_available','processing_completed','processing_failed',
    'import_canceled'
  ));

-- Remove apenas nomes legados impostos pelo produto. Nomes personalizados pelo
-- founder são preservados; vazio significa conversar sem se apresentar por nome.
UPDATE public.agent_prompt_versions
   SET structured_config = jsonb_set(coalesce(structured_config, '{}'::jsonb), '{name}', '""'::jsonb, true),
       updated_at = now()
 WHERE coalesce(structured_config->>'name','') IN ('Lucas','Assistente NoControle','Assistente NoControle.ia');

CREATE OR REPLACE FUNCTION public.agent_compile_prompt(p_cfg jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  agent_name text := nullif(trim(coalesce(p_cfg->>'name', '')), '');
  objective text := coalesce(p_cfg->>'objective', '');
  tone text := coalesce(p_cfg->>'tone', 'humano e claro');
  formality text := coalesce(p_cfg->>'formality', 'informal e respeitoso');
  emoji_style text := coalesce(p_cfg->>'emoji_style', 'moderado');
  address_style text := coalesce(p_cfg->>'address_style', 'você');
  welcome text := coalesce(p_cfg->>'welcome', '');
  fallback text := coalesce(p_cfg->>'fallback', '');
  do_list text; dont_list text;
  proactive boolean := coalesce((p_cfg->>'proactive')::boolean, false);
BEGIN
  SELECT string_agg('- ' || value, E'\n') INTO do_list
    FROM jsonb_array_elements_text(coalesce(p_cfg->'do','[]'::jsonb));
  SELECT string_agg('- ' || value, E'\n') INTO dont_list
    FROM jsonb_array_elements_text(coalesce(p_cfg->'dont','[]'::jsonb));
  RETURN
    CASE WHEN agent_name IS NULL
      THEN E'Você é o assessor financeiro digital do NoControle. Não atribua um nome a si mesmo.\n\n'
      ELSE 'Você é ' || agent_name || E', assessor financeiro digital do NoControle.\n\n' END ||
    'Objetivo: ' || objective || E'\n' ||
    'Tom de voz: ' || tone || E'\n' ||
    'Formalidade: ' || formality || E'\n' ||
    'Emojis: ' || emoji_style || E'\n' ||
    'Trate a pessoa por: ' || address_style || E'\n\n' ||
    'O que deve fazer:' || E'\n' || coalesce(do_list, '- Seja claro, acolhedor e acionável.') || E'\n\n' ||
    'O que nunca deve fazer:' || E'\n' || coalesce(dont_list, '- Não invente informações.') || E'\n\n' ||
    'Boas-vindas: ' || welcome || E'\n' ||
    'Quando não entender: ' || fallback || E'\n' ||
    'Proatividade: ' || CASE WHEN proactive THEN 'sugira próximos passos úteis.' ELSE 'responda sem insistência.' END || E'\n\n' ||
    E'REGRAS OBRIGATÓRIAS:\n- Nunca invente valores, saldos, datas ou identidades.\n' ||
    E'- Confirme antes de gravar qualquer alteração financeira.\n' ||
    E'- Nunca exponha credenciais, dados de outro usuário ou detalhes técnicos.\n' ||
    E'- Respeite a LGPD e responda sem julgamento.';
END $$;

-- Recompila versões para que a configuração ampliada tenha efeito também no
-- chat do app e no WhatsApp, não somente nas mensagens da divisão.
UPDATE public.agent_prompt_versions
   SET system_prompt = public.agent_compile_prompt(structured_config), updated_at = now()
 WHERE status IN ('active','draft');

-- Recupera documentos afetados pelo bug de escopo dos contadores: os itens
-- já foram persistidos e devem aparecer para revisão, não como upload falho.
UPDATE public.document_imports d
   SET status = 'partial',
       error = NULL,
       counters = coalesce(d.counters, '{}'::jsonb) || jsonb_build_object(
         'recovered_after_counter_scope_fix', true,
         'recovered_at', now()
       ),
       updated_at = now()
 WHERE d.status = 'failed'
   AND d.error ILIKE '%batchDupStrong is not defined%'
   AND EXISTS (
     SELECT 1 FROM public.extracted_items i
      WHERE i.document_id = d.id
        AND i.user_id = d.user_id
        AND i.status IN ('needs_review','duplicate_suspect')
   );

-- Itens filhos de imports já cancelados nunca podem reaparecer para aprovação.
UPDATE public.extracted_items i
   SET status = 'ignored', updated_at = now()
  FROM public.document_imports d
 WHERE d.id = i.document_id
   AND d.status IN ('canceled','expired')
   AND i.status IN ('needs_review','duplicate_suspect','failed','rejected')
   AND i.transaction_id IS NULL;

CREATE OR REPLACE FUNCTION public.cancel_document_import(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_old_status text;
  v_discarded integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_old_status
    FROM public.document_imports
   WHERE id = p_document_id AND user_id = v_user
   FOR UPDATE;

  IF v_old_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_old_status IN ('confirmed','rolled_back') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_registered_use_rollback');
  END IF;
  IF v_old_status = 'canceled' THEN
    RETURN jsonb_build_object('ok', true, 'already_canceled', true, 'discarded_items', 0);
  END IF;

  UPDATE public.extracted_items
     SET status = 'ignored', updated_at = now()
   WHERE document_id = p_document_id
     AND user_id = v_user
     AND transaction_id IS NULL
     AND status IN ('needs_review','duplicate_suspect','failed','rejected');
  GET DIAGNOSTICS v_discarded = ROW_COUNT;

  UPDATE public.document_fragments
     SET status = CASE WHEN status IN ('completed','skipped') THEN status ELSE 'skipped' END,
         error_code = CASE WHEN status IN ('completed','skipped') THEN error_code ELSE 'user_canceled' END,
         updated_at = now()
   WHERE document_id = p_document_id AND user_id = v_user;

  UPDATE public.document_imports
     SET status = 'canceled', next_attempt_at = NULL, error = NULL, updated_at = now(),
         counters = coalesce(counters, '{}'::jsonb) || jsonb_build_object(
           'canceled_at', now(), 'discarded_items', v_discarded
         )
   WHERE id = p_document_id AND user_id = v_user;

  INSERT INTO public.document_import_audit(user_id, document_id, action, payload)
  VALUES (v_user, p_document_id, 'cancel', jsonb_build_object(
    'previous_status', v_old_status, 'discarded_items', v_discarded
  ));
  INSERT INTO public.document_processing_events(
    document_id, user_id, event_type, stage, items_found, user_message, metadata
  ) VALUES (
    p_document_id, v_user, 'import_canceled', 'terminal', v_discarded,
    'Importação cancelada. Os itens pendentes foram descartados.',
    jsonb_build_object('previous_status', v_old_status, 'discarded_items', v_discarded)
  );

  RETURN jsonb_build_object('ok', true, 'discarded_items', v_discarded);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_document_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_document_import(uuid) TO authenticated, service_role;

-- Backfill de contexto das mensagens de Divisão do Rolê já existentes.
UPDATE public.outbound_messages o
   SET context_type = 'shared_expense',
       context_id = j.shared_expense_id,
       participant_id = j.participant_id,
       metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object(
         'job_id', j.id, 'origin', 'split_reminder'
       )
  FROM public.reminder_jobs j
 WHERE j.outbound_message_id = o.id
   AND (o.context_id IS NULL OR o.context_type IS NULL);

-- Cada transição vira histórico, inclusive tentativas e falhas. O trigger não
-- substitui os ACKs do provedor; ele garante que nenhuma mudança local suma.
CREATE OR REPLACE FUNCTION public.audit_outbound_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR new.status IS DISTINCT FROM old.status THEN
    INSERT INTO public.message_delivery_events(
      outbound_id, provider_message_id, status, occurred_at, payload_hash
    ) VALUES (
      new.id, new.provider_message_id, new.status, now(),
      md5(coalesce(new.last_error, '') || ':' || coalesce(new.attempts, 0)::text)
    );
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS outbound_messages_audit_status ON public.outbound_messages;
CREATE TRIGGER outbound_messages_audit_status
AFTER INSERT OR UPDATE OF status ON public.outbound_messages
FOR EACH ROW EXECUTE FUNCTION public.audit_outbound_status_change();

-- API administrativa única: evita dar SELECT amplo no front e mascara PII.
CREATE OR REPLACE FUNCTION public.admin_message_activity(
  p_from timestamptz DEFAULT now() - interval '7 days',
  p_to timestamptz DEFAULT now(),
  p_status text DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT o.id, o.created_at, o.updated_at, o.sent_at, o.status::text,
             o.channel, o.kind, o.attempts, o.last_error,
             o.provider_message_id, o.context_type, o.context_id,
             o.participant_id,
             CASE WHEN length(o.to_phone) >= 4
                  THEN '***' || right(o.to_phone, 4) ELSE '***' END AS recipient,
             left(regexp_replace(o.body, E'[\\n\\r]+', ' ', 'g'), 160) AS preview,
             o.metadata
        FROM public.outbound_messages o
       WHERE o.created_at >= coalesce(p_from, now() - interval '7 days')
         AND o.created_at <= coalesce(p_to, now())
         AND (p_status IS NULL OR o.status::text = p_status)
         AND (p_kind IS NULL OR o.kind = p_kind)
       ORDER BY o.created_at DESC
       LIMIT greatest(1, least(coalesce(p_limit,100),500))
       OFFSET greatest(0, coalesce(p_offset,0))
    ) x;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_message_activity(timestamptz,timestamptz,text,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_message_activity(timestamptz,timestamptz,text,text,integer,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_message_metrics(
  p_from timestamptz DEFAULT now() - interval '24 hours',
  p_to timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'total', count(*),
    'queued', count(*) FILTER (WHERE status IN ('queued','processing')),
    'sent', count(*) FILTER (WHERE status = 'sent'),
    'delivered', count(*) FILTER (WHERE status IN ('delivered','read')),
    'failed', count(*) FILTER (WHERE status IN ('failed','dead')),
    'split', count(*) FILTER (WHERE context_type = 'shared_expense' OR kind LIKE 'split_%')
  ) INTO result
  FROM public.outbound_messages
  WHERE created_at BETWEEN coalesce(p_from, now() - interval '24 hours') AND coalesce(p_to, now());
  RETURN coalesce(result, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_message_metrics(timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_message_metrics(timestamptz,timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_conversation_activity(
  p_from timestamptz DEFAULT now() - interval '7 days',
  p_to timestamptz DEFAULT now(),
  p_limit integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO result
    FROM (
      SELECT m.id, m.created_at, m.direction::text, c.source,
             CASE WHEN c.phone_e164 IS NOT NULL AND length(c.phone_e164) >= 4
                  THEN '***' || right(c.phone_e164,4) ELSE NULL END AS contact,
             left(regexp_replace(m.body_masked, E'[\\n\\r]+', ' ', 'g'), 240) AS preview
        FROM public.conversation_messages m
        JOIN public.conversations c ON c.id = m.conversation_id
       WHERE m.created_at BETWEEN coalesce(p_from, now()-interval '7 days') AND coalesce(p_to,now())
       ORDER BY m.created_at DESC
       LIMIT greatest(1, least(coalesce(p_limit,100),500))
    ) x;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_conversation_activity(timestamptz,timestamptz,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_conversation_activity(timestamptz,timestamptz,integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
