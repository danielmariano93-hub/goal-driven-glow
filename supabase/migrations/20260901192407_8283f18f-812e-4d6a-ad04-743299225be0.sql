CREATE OR REPLACE FUNCTION public.nino_tx_behavioral_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_kind text := coalesce(NEW.movement_kind, 'transaction');
  v_event text;
BEGIN
  IF NEW.status <> 'confirmed' THEN RETURN NEW; END IF;
  IF NEW.settles_card_id IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.type = 'income' THEN
    v_event := 'MONEY_IN';
  ELSIF NEW.type = 'expense' AND v_kind = 'transaction' AND NEW.transfer_group_id IS NULL THEN
    v_event := 'LARGE_SPEND';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.nino_mark_behavioral_event(
    NEW.user_id, v_event,
    (NEW.occurred_at::timestamp AT TIME ZONE 'America/Sao_Paulo'),
    NEW.id, 'transactions', NEW.amount,
    jsonb_build_object(
      'type', NEW.type,
      'movement_kind', v_kind,
      'transfer_group_id', NEW.transfer_group_id,
      'category_id', NEW.category_id,
      'credit_card_id', NEW.credit_card_id,
      'account_id', NEW.account_id,
      'origin', NEW.origin,
      'description', left(coalesce(NEW.description, ''), 120),
      'occurred_at', NEW.occurred_at,
      'posted_at', NEW.posted_at
    )
  );
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.nino_tx_behavioral_event() FROM PUBLIC, anon, authenticated;