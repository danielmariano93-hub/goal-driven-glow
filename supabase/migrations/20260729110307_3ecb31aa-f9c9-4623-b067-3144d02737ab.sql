CREATE OR REPLACE FUNCTION public.split_add_payment_v2(p_participant_id uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=auth.uid(); p record; se record; new_paid numeric; tx_id uuid; recipient record; fully boolean;
BEGIN
  SELECT * INTO p FROM public.shared_expense_participants WHERE id=p_participant_id AND owner_user_id=uid FOR UPDATE;
  IF p.id IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Pagamento inválido'; END IF;
  SELECT * INTO se FROM public.shared_expenses WHERE id=p.shared_expense_id FOR UPDATE;
  IF se.status='cancelled' THEN RAISE EXCEPTION 'Divisão cancelada'; END IF;
  new_paid:=least(p.amount_due,p.amount_paid+p_amount);
  IF new_paid<=p.amount_paid THEN RETURN; END IF;
  fully := new_paid >= p.amount_due;

  UPDATE public.shared_expense_participants
     SET amount_paid = new_paid,
         status = (CASE WHEN fully THEN 'paid' ELSE 'partial' END)::participant_status,
         paid_at = CASE WHEN fully THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p.id;

  IF se.reimbursement_account_id IS NOT NULL THEN
    INSERT INTO public.transactions(user_id,account_id,category_id,type,status,amount,occurred_at,description,notes,
      payment_method,movement_kind,shared_expense_id,split_transaction_role)
    VALUES(uid,se.reimbursement_account_id,NULL,'income','confirmed',new_paid-p.amount_paid,current_date,
      'Reembolso · '||se.title,'Recebido de '||p.name||' pela Divisão do Rolê','account','refund',se.id,'reimbursement')
    RETURNING id INTO tx_id;
  END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,participant_id,event_type,payload)
  VALUES(se.id,uid,p.id,'payment',jsonb_build_object('amount',new_paid-p.amount_paid,'total_paid',new_paid,'transaction_id',tx_id));

  IF fully THEN
    -- quem já pagou não deve mais receber cobrança
    UPDATE public.reminder_jobs
       SET status='skipped', updated_at=now()
     WHERE participant_id = p.id
       AND status='queued'
       AND kind IN ('reminder','due_soon','due_today','overdue');
  END IF;

  IF p.phone_e164 IS NOT NULL THEN PERFORM public.split_enqueue_message(se.id,p.id,'payment_confirmation',now()); END IF;

  IF NOT EXISTS(SELECT 1 FROM public.shared_expense_participants WHERE shared_expense_id=se.id AND amount_paid<amount_due) THEN
    UPDATE public.shared_expenses SET status='settled' WHERE id=se.id;
    FOR recipient IN SELECT id FROM public.shared_expense_participants
      WHERE shared_expense_id=se.id AND phone_e164 IS NOT NULL AND opt_out_at IS NULL LOOP
      PERFORM public.split_enqueue_message(se.id,recipient.id,'completed',now());
    END LOOP;
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.split_reverse_payment_v2(p_participant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid:=auth.uid(); p record; se record;
BEGIN
  SELECT * INTO p FROM public.shared_expense_participants WHERE id=p_participant_id AND owner_user_id=uid FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Participante não encontrado'; END IF;
  SELECT * INTO se FROM public.shared_expenses WHERE id=p.shared_expense_id FOR UPDATE;
  DELETE FROM public.transactions t WHERE t.user_id=uid AND t.shared_expense_id=se.id
    AND t.split_transaction_role='reimbursement'
    AND t.id IN (
      SELECT nullif(e.payload->>'transaction_id','')::uuid FROM public.shared_expense_events e
      WHERE e.shared_expense_id=se.id AND e.participant_id=p.id AND e.event_type='payment'
    );
  UPDATE public.shared_expense_participants
     SET amount_paid=0, status='pending'::participant_status, paid_at=NULL, updated_at=now()
   WHERE id=p.id;
  UPDATE public.shared_expenses SET status='active' WHERE id=se.id AND status='settled';
  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,participant_id,event_type,payload)
  VALUES(se.id,uid,p.id,'reverse_payment',jsonb_build_object('previous_amount',p.amount_paid));
END $function$;