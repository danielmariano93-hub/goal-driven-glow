-- As parcelas enviadas pelo app são indexadas pela posição do integrante no
-- payload. A versão anterior resolvia a posição por `ORDER BY created_at, id`
-- entre os integrantes com telefone; como todos nascem na mesma transação, o
-- desempate por `id` (uuid aleatório) embaralhava as datas entre as pessoas.
-- Agora a posição aponta para o payload e a pessoa é resolvida pelo telefone.
CREATE OR REPLACE FUNCTION public.split_create_v3(
  p_title text, p_total numeric, p_occurred_at date, p_due_date date,
  p_split_mode split_mode, p_include_owner boolean, p_reminder_enabled boolean,
  p_pix_key text, p_participants jsonb, p_owner_amount numeric,
  p_source_account_id uuid, p_source_credit_card_id uuid,
  p_reimbursement_account_id uuid, p_category_id uuid,
  p_register_transaction boolean, p_installments jsonb DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  uid uuid := auth.uid();
  mapped jsonb := '{}'::jsonb;
  it jsonb;
  part record;
  v_phone text;
BEGIN
  new_id := public.split_create_v2(
    p_title, p_total, p_occurred_at, p_due_date, p_split_mode, p_include_owner,
    p_reminder_enabled, p_pix_key, p_participants, p_owner_amount,
    p_source_account_id, p_source_credit_card_id, p_reimbursement_account_id,
    p_category_id, p_register_transaction);

  IF p_installments IS NOT NULL AND jsonb_typeof(p_installments) = 'array' THEN
    -- p_installments: [{ "participant_index": 0, "rows": [{amount, due_date}, ...] }]
    FOR it IN SELECT * FROM jsonb_array_elements(p_installments) LOOP
      v_phone := nullif(p_participants -> coalesce((it->>'participant_index')::int, 0) ->> 'phone_e164', '');
      IF v_phone IS NULL THEN CONTINUE; END IF;
      SELECT * INTO part FROM public.shared_expense_participants
       WHERE shared_expense_id = new_id AND owner_user_id = uid AND phone_e164 = v_phone
       LIMIT 1;
      IF part.id IS NOT NULL THEN
        mapped := mapped || jsonb_build_object(part.id::text, it->'rows');
      END IF;
    END LOOP;
  END IF;

  PERFORM public.split_apply_installments(new_id, mapped);
  RETURN new_id;
END;
$$;
