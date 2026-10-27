-- split_update_v3 sem mapa de parcelas (p_installments nulo) refazia TODAS as parcelas como "à vista"
-- (split_apply_installments com mapa vazio), apagando o parcelamento e os lembretes de cada parcela.
-- Agora, sem mapa, as parcelas existentes são preservadas quando todas as pessoas já têm parcelas
-- que somam a própria parte. Com mapa, o comportamento é o de sempre.
create or replace function public.split_update_v3(p_id uuid, p_title text, p_total numeric, p_occurred_at date, p_due_date date, p_split_mode split_mode, p_reminder_enabled boolean, p_pix_key text, p_participants jsonb, p_source_account_id uuid, p_source_credit_card_id uuid, p_reimbursement_account_id uuid, p_category_id uuid, p_register_transaction boolean, p_installments jsonb DEFAULT NULL::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  uid uuid := auth.uid();
  mapped jsonb := '{}'::jsonb;
  v_consistent boolean;
BEGIN
  PERFORM public.split_update(
    p_id, p_title, p_total, p_occurred_at, p_due_date, p_split_mode,
    p_reminder_enabled, p_pix_key, p_participants, p_source_account_id,
    p_source_credit_card_id, p_reimbursement_account_id, p_category_id,
    p_register_transaction);

  IF p_installments IS NOT NULL AND jsonb_typeof(p_installments) = 'object' THEN
    mapped := p_installments; -- { "<participant_id>": [{amount, due_date}] }
  ELSE
    SELECT NOT EXISTS (
      SELECT 1 FROM public.shared_expense_participants p
       WHERE p.shared_expense_id = p_id AND p.owner_user_id = uid
         AND coalesce((SELECT sum(i.amount) FROM public.shared_expense_installments i
                        WHERE i.participant_id = p.id AND i.status <> 'cancelled'), -1) <> coalesce(p.amount_due, 0)
    ) INTO v_consistent;
    IF v_consistent THEN
      RETURN;
    END IF;
  END IF;

  PERFORM public.split_apply_installments(p_id, mapped);

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
  VALUES (p_id, uid, 'installments_updated', jsonb_build_object('participants', mapped));
END;
$function$;
