-- P1 — Vínculo de estorno por identidade econômica. Sem vínculo, o estorno
-- abate uma categoria genérica e a leitura por categoria mente.
CREATE OR REPLACE FUNCTION public.link_document_refunds(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_refund record;
  v_original uuid;
  v_method text;
  v_confidence numeric(4,3);
  v_candidates int;
  v_linked int := 0;
  v_ambiguous int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.document_imports WHERE id = p_document_id AND user_id = v_user
  ) THEN RAISE EXCEPTION 'document_not_found' USING ERRCODE = 'P0002'; END IF;

  FOR v_refund IN
    SELECT t.*
      FROM public.transactions t
     WHERE t.user_id = v_user
       AND t.source_document_id = p_document_id
       AND t.type = 'income'
       AND coalesce(t.movement_kind, 'transaction') = 'refund'
       AND t.refund_of_transaction_id IS NULL
       AND coalesce(t.status::text, 'confirmed') = 'confirmed'
     ORDER BY coalesce(t.posted_at, t.occurred_at)
  LOOP
    v_original := NULL;
    v_method := NULL;
    v_confidence := NULL;

    -- 1) Identidade econômica forte: mesma referência bancária / id externo.
    IF coalesce(v_refund.reverses_external_id, '') <> '' THEN
      SELECT o.id INTO v_original
        FROM public.transactions o
       WHERE o.user_id = v_user
         AND o.type = 'expense'
         AND coalesce(o.status::text, 'confirmed') = 'confirmed'
         AND (o.external_id = v_refund.reverses_external_id
              OR o.bank_reference = v_refund.reverses_external_id)
       ORDER BY coalesce(o.posted_at, o.occurred_at) DESC
       LIMIT 1;
      IF v_original IS NOT NULL THEN
        v_method := 'bank_reference';
        v_confidence := 1.0;
      END IF;
    END IF;

    -- 2) Valor idêntico, mesmo instrumento, até 60 dias antes, ainda não estornado.
    IF v_original IS NULL THEN
      SELECT count(*) INTO v_candidates
        FROM public.transactions o
       WHERE o.user_id = v_user
         AND o.type = 'expense'
         AND coalesce(o.status::text, 'confirmed') = 'confirmed'
         AND round(o.amount, 2) = round(v_refund.amount, 2)
         AND coalesce(o.account_id::text, '') = coalesce(v_refund.account_id::text, '')
         AND coalesce(o.credit_card_id::text, '') = coalesce(v_refund.credit_card_id::text, '')
         AND coalesce(o.posted_at, o.occurred_at)
             BETWEEN coalesce(v_refund.posted_at, v_refund.occurred_at) - 60
                 AND coalesce(v_refund.posted_at, v_refund.occurred_at)
         AND NOT EXISTS (
           SELECT 1 FROM public.transactions r
            WHERE r.user_id = v_user AND r.refund_of_transaction_id = o.id
              AND coalesce(r.status::text, 'confirmed') <> 'superseded'
         );

      IF v_candidates = 1 THEN
        SELECT o.id INTO v_original
          FROM public.transactions o
         WHERE o.user_id = v_user
           AND o.type = 'expense'
           AND coalesce(o.status::text, 'confirmed') = 'confirmed'
           AND round(o.amount, 2) = round(v_refund.amount, 2)
           AND coalesce(o.account_id::text, '') = coalesce(v_refund.account_id::text, '')
           AND coalesce(o.credit_card_id::text, '') = coalesce(v_refund.credit_card_id::text, '')
           AND coalesce(o.posted_at, o.occurred_at)
               BETWEEN coalesce(v_refund.posted_at, v_refund.occurred_at) - 60
                   AND coalesce(v_refund.posted_at, v_refund.occurred_at)
           AND NOT EXISTS (
             SELECT 1 FROM public.transactions r
              WHERE r.user_id = v_user AND r.refund_of_transaction_id = o.id
                AND coalesce(r.status::text, 'confirmed') <> 'superseded'
           )
         LIMIT 1;
        v_method := 'amount_window';
        v_confidence := 0.8;
      ELSIF v_candidates > 1 THEN
        -- Ambíguo por natureza (gasto recorrente de mesmo valor): não adivinha.
        v_ambiguous := v_ambiguous + 1;
      END IF;
    END IF;

    IF v_original IS NOT NULL THEN
      UPDATE public.transactions
         SET refund_of_transaction_id = v_original,
             refund_link_method = v_method,
             refund_link_confidence = v_confidence,
             updated_at = now()
       WHERE id = v_refund.id AND user_id = v_user;
      v_linked := v_linked + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'contract', 'refund_link.v1',
    'linked', v_linked,
    'ambiguous', v_ambiguous
  );
END $$;

REVOKE ALL ON FUNCTION public.link_document_refunds(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_document_refunds(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';