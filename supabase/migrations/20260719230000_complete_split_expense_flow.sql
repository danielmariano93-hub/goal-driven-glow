-- Conclusão da Divisão do Rolê: vínculo financeiro, edição segura,
-- cancelamento auditável, convite inicial e status de entrega.

ALTER TABLE public.shared_expenses
  ADD COLUMN IF NOT EXISTS source_account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reimbursement_account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS shared_expense_id uuid REFERENCES public.shared_expenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS split_transaction_role text
    CHECK (split_transaction_role IN ('original_expense','reimbursement'));

CREATE UNIQUE INDEX IF NOT EXISTS transactions_split_original_uniq
  ON public.transactions(shared_expense_id)
  WHERE split_transaction_role = 'original_expense';
CREATE INDEX IF NOT EXISTS transactions_split_idx
  ON public.transactions(shared_expense_id)
  WHERE shared_expense_id IS NOT NULL;

ALTER TABLE public.reminder_jobs
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'reminder'
    CHECK (kind IN ('invite','reminder','due_soon','overdue','payment_confirmation','completed'));

CREATE UNIQUE INDEX IF NOT EXISTS split_jobs_idempotent_uniq
  ON public.reminder_jobs(shared_expense_id, participant_id, kind, scheduled_for);

-- A extensão pgcrypto fica no schema extensions neste projeto. A função usa
-- qualificação explícita, sem depender do search_path da sessão.
CREATE OR REPLACE FUNCTION public.split_token()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public, extensions AS $$
  SELECT encode(extensions.gen_random_bytes(16), 'hex')
$$;
REVOKE ALL ON FUNCTION public.split_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_token() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.split_assert_financial_source(
  p_user_id uuid, p_account_id uuid, p_card_id uuid, p_category_id uuid,
  p_reimbursement_account_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_account_id IS NOT NULL AND p_card_id IS NOT NULL THEN
    RAISE EXCEPTION 'Escolha uma conta ou um cartão, não os dois';
  END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id=p_account_id AND user_id=p_user_id AND active
  ) THEN RAISE EXCEPTION 'Conta inválida'; END IF;
  IF p_card_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.credit_cards WHERE id=p_card_id AND user_id=p_user_id AND active
  ) THEN RAISE EXCEPTION 'Cartão inválido'; END IF;
  IF p_reimbursement_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id=p_reimbursement_account_id AND user_id=p_user_id AND active
  ) THEN RAISE EXCEPTION 'Conta de recebimento inválida'; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories WHERE id=p_category_id
      AND type='expense' AND (user_id=p_user_id OR user_id IS NULL)
  ) THEN RAISE EXCEPTION 'Categoria inválida'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.split_enqueue_message(
  p_expense_id uuid, p_participant_id uuid, p_kind text, p_when timestamptz DEFAULT now()
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); job_id uuid; p record; se record;
BEGIN
  SELECT * INTO se FROM public.shared_expenses WHERE id=p_expense_id AND owner_user_id=uid;
  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;
  IF se.status IN ('cancelled','settled') AND p_kind NOT IN ('payment_confirmation','completed') THEN
    RAISE EXCEPTION 'Divisão encerrada';
  END IF;
  SELECT * INTO p FROM public.shared_expense_participants
   WHERE id=p_participant_id AND shared_expense_id=p_expense_id AND owner_user_id=uid;
  IF p.id IS NULL OR p.phone_e164 IS NULL OR p.opt_out_at IS NOT NULL THEN RETURN NULL; END IF;
  INSERT INTO public.reminder_jobs(owner_user_id,shared_expense_id,participant_id,scheduled_for,status,kind)
  VALUES(uid,p_expense_id,p_participant_id,date_trunc('second',p_when),'queued',p_kind)
  ON CONFLICT (shared_expense_id,participant_id,kind,scheduled_for) DO UPDATE
    SET updated_at=now()
  RETURNING id INTO job_id;
  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,participant_id,event_type,payload)
  VALUES(p_expense_id,uid,p_participant_id,'message_queued',jsonb_build_object('kind',p_kind,'job_id',job_id));
  RETURN job_id;
END $$;

CREATE OR REPLACE FUNCTION public.split_upsert_original_transaction(p_expense_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); se record; tx_id uuid; competence date;
BEGIN
  SELECT * INTO se FROM public.shared_expenses WHERE id=p_expense_id AND owner_user_id=uid FOR UPDATE;
  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;
  IF se.source_account_id IS NULL AND se.source_credit_card_id IS NULL THEN RETURN NULL; END IF;
  IF se.source_credit_card_id IS NOT NULL THEN
    SELECT public.credit_card_competence(closing_day,se.occurred_at) INTO competence
      FROM public.credit_cards WHERE id=se.source_credit_card_id;
  END IF;
  IF se.linked_transaction_id IS NULL THEN
    INSERT INTO public.transactions(user_id,account_id,category_id,type,status,amount,occurred_at,
      description,notes,payment_method,credit_card_id,purchase_date,competence_date,movement_kind,
      shared_expense_id,split_transaction_role)
    VALUES(uid,se.source_account_id,se.category_id,'expense','confirmed',se.total_amount,se.occurred_at,
      se.title,'Criado pela Divisão do Rolê',CASE WHEN se.source_credit_card_id IS NULL THEN 'account' ELSE 'credit_card' END,
      se.source_credit_card_id,CASE WHEN se.source_credit_card_id IS NOT NULL THEN se.occurred_at END,competence,
      'transaction',se.id,'original_expense') RETURNING id INTO tx_id;
    UPDATE public.shared_expenses SET linked_transaction_id=tx_id WHERE id=se.id;
  ELSE
    UPDATE public.transactions SET account_id=se.source_account_id,credit_card_id=se.source_credit_card_id,
      payment_method=CASE WHEN se.source_credit_card_id IS NULL THEN 'account' ELSE 'credit_card' END,
      category_id=se.category_id,amount=se.total_amount,occurred_at=se.occurred_at,
      purchase_date=CASE WHEN se.source_credit_card_id IS NOT NULL THEN se.occurred_at END,
      competence_date=competence,description=se.title,updated_at=now()
    WHERE id=se.linked_transaction_id AND user_id=uid;
    tx_id := se.linked_transaction_id;
  END IF;
  RETURN tx_id;
END $$;

CREATE OR REPLACE FUNCTION public.split_create_v2(
  p_title text, p_total numeric, p_occurred_at date, p_due_date date,
  p_split_mode public.split_mode, p_include_owner boolean, p_reminder_enabled boolean,
  p_pix_key text, p_participants jsonb, p_owner_amount numeric DEFAULT NULL,
  p_source_account_id uuid DEFAULT NULL, p_source_credit_card_id uuid DEFAULT NULL,
  p_reimbursement_account_id uuid DEFAULT NULL, p_category_id uuid DEFAULT NULL,
  p_register_transaction boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE uid uuid:=auth.uid(); new_id uuid; n int; total_cents bigint; base_cents bigint;
  remainder bigint; sum_cents bigint:=0; owner_cents bigint:=0; extra int; it jsonb; owner_name text;
  participant_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  IF p_total IS NULL OR p_total<=0 OR btrim(coalesce(p_title,''))='' THEN RAISE EXCEPTION 'Preencha título e valor'; END IF;
  PERFORM public.split_assert_financial_source(uid,p_source_account_id,p_source_credit_card_id,p_category_id,p_reimbursement_account_id);
  IF p_register_transaction AND p_source_account_id IS NULL AND p_source_credit_card_id IS NULL THEN
    RAISE EXCEPTION 'Escolha de onde saiu o pagamento';
  END IF;
  n:=jsonb_array_length(coalesce(p_participants,'[]'))+CASE WHEN p_include_owner THEN 1 ELSE 0 END;
  IF n<1 THEN RAISE EXCEPTION 'Inclua ao menos uma pessoa'; END IF;
  total_cents:=round(p_total*100)::bigint;
  IF p_split_mode='custom' THEN
    FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_participants,'[]')) LOOP
      sum_cents:=sum_cents+round(coalesce((it->>'amount_due')::numeric,0)*100)::bigint;
    END LOOP;
    owner_cents:=CASE WHEN p_include_owner THEN round(coalesce(p_owner_amount,0)*100)::bigint ELSE 0 END;
    IF sum_cents+owner_cents<>total_cents THEN RAISE EXCEPTION 'A soma das partes precisa ser igual ao total'; END IF;
  END IF;
  INSERT INTO public.shared_expenses(owner_user_id,title,total_amount,occurred_at,due_date,split_mode,
    reminder_enabled,status,pix_key,source_account_id,source_credit_card_id,reimbursement_account_id,category_id)
  VALUES(uid,btrim(p_title),p_total,coalesce(p_occurred_at,current_date),p_due_date,p_split_mode,
    coalesce(p_reminder_enabled,false),'active',nullif(btrim(coalesce(p_pix_key,'')),''),
    p_source_account_id,p_source_credit_card_id,p_reimbursement_account_id,p_category_id) RETURNING id INTO new_id;
  base_cents:=CASE WHEN p_split_mode='equal' THEN total_cents/n ELSE 0 END;
  remainder:=CASE WHEN p_split_mode='equal' THEN total_cents-base_cents*n ELSE 0 END;
  IF p_include_owner THEN
    SELECT coalesce(display_name,'Você') INTO owner_name FROM public.profiles WHERE id=uid;
    extra:=CASE WHEN remainder>0 THEN 1 ELSE 0 END; remainder:=greatest(remainder-1,0);
    INSERT INTO public.shared_expense_participants(shared_expense_id,owner_user_id,name,amount_due,status,amount_paid,paid_at)
    VALUES(new_id,uid,coalesce(owner_name,'Você'),
      CASE WHEN p_split_mode='equal' THEN (base_cents+extra)::numeric/100 ELSE owner_cents::numeric/100 END,
      'paid',CASE WHEN p_split_mode='equal' THEN (base_cents+extra)::numeric/100 ELSE owner_cents::numeric/100 END,now());
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_participants,'[]')) LOOP
    extra:=CASE WHEN remainder>0 THEN 1 ELSE 0 END; remainder:=greatest(remainder-1,0);
    INSERT INTO public.shared_expense_participants(shared_expense_id,owner_user_id,name,phone_e164,phone_masked,
      amount_due,opt_out_token)
    VALUES(new_id,uid,btrim(coalesce(it->>'name','Participante')),nullif(it->>'phone_e164',''),
      CASE WHEN nullif(it->>'phone_e164','') IS NOT NULL THEN regexp_replace(it->>'phone_e164','^(\+\d{2})\d+(\d{4})$','\1****\2') END,
      CASE WHEN p_split_mode='equal' THEN (base_cents+extra)::numeric/100 ELSE coalesce((it->>'amount_due')::numeric,0) END,
      public.split_token()) RETURNING id INTO participant_id;
    IF nullif(it->>'phone_e164','') IS NOT NULL THEN
      PERFORM public.split_enqueue_message(new_id,participant_id,'invite',now());
    END IF;
  END LOOP;
  IF p_register_transaction THEN PERFORM public.split_upsert_original_transaction(new_id); END IF;
  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,event_type,payload)
  VALUES(new_id,uid,'created',jsonb_build_object('total',p_total,'mode',p_split_mode,'transaction_registered',p_register_transaction));
  RETURN new_id;
END $$;

-- Edição substitui apenas participantes ainda sem pagamento. Participantes com
-- pagamento ficam protegidos e não podem ter valor reduzido abaixo do recebido.
CREATE OR REPLACE FUNCTION public.split_update(
  p_id uuid, p_title text, p_total numeric, p_occurred_at date, p_due_date date,
  p_split_mode public.split_mode, p_reminder_enabled boolean, p_pix_key text,
  p_participants jsonb, p_source_account_id uuid, p_source_credit_card_id uuid,
  p_reimbursement_account_id uuid, p_category_id uuid, p_register_transaction boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid:=auth.uid(); se record; it jsonb; pid uuid; due numeric; sum_due numeric:=0;
BEGIN
  SELECT * INTO se FROM public.shared_expenses WHERE id=p_id AND owner_user_id=uid FOR UPDATE;
  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;
  IF se.status='cancelled' THEN RAISE EXCEPTION 'Divisão cancelada'; END IF;
  PERFORM public.split_assert_financial_source(uid,p_source_account_id,p_source_credit_card_id,p_category_id,p_reimbursement_account_id);
  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_participants,'[]')) LOOP
    pid:=nullif(it->>'id','')::uuid; due:=coalesce((it->>'amount_due')::numeric,0);
    IF due<0 THEN RAISE EXCEPTION 'Valor individual inválido'; END IF;
    IF pid IS NOT NULL AND EXISTS(SELECT 1 FROM public.shared_expense_participants WHERE id=pid AND amount_paid>due) THEN
      RAISE EXCEPTION 'Uma parte não pode ficar menor que o valor já recebido';
    END IF;
    sum_due:=sum_due+due;
  END LOOP;
  IF round(sum_due*100)<>round(p_total*100) THEN RAISE EXCEPTION 'A soma das partes precisa ser igual ao total'; END IF;
  IF EXISTS(SELECT 1 FROM public.shared_expense_participants x WHERE x.shared_expense_id=p_id AND x.amount_paid>0
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_participants,'[]')) j WHERE nullif(j->>'id','')::uuid=x.id)) THEN
    RAISE EXCEPTION 'Não é possível remover alguém que já pagou';
  END IF;
  UPDATE public.shared_expenses SET title=btrim(p_title),total_amount=p_total,occurred_at=p_occurred_at,
    due_date=p_due_date,split_mode=p_split_mode,reminder_enabled=p_reminder_enabled,
    pix_key=nullif(btrim(coalesce(p_pix_key,'')),''),source_account_id=p_source_account_id,
    source_credit_card_id=p_source_credit_card_id,reimbursement_account_id=p_reimbursement_account_id,
    category_id=p_category_id WHERE id=p_id;
  DELETE FROM public.shared_expense_participants x WHERE x.shared_expense_id=p_id AND x.amount_paid=0
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_participants,'[]')) j WHERE nullif(j->>'id','')::uuid=x.id);
  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_participants,'[]')) LOOP
    pid:=nullif(it->>'id','')::uuid; due:=coalesce((it->>'amount_due')::numeric,0);
    IF pid IS NULL THEN
      INSERT INTO public.shared_expense_participants(shared_expense_id,owner_user_id,name,phone_e164,phone_masked,amount_due,opt_out_token)
      VALUES(p_id,uid,btrim(it->>'name'),nullif(it->>'phone_e164',''),
        CASE WHEN nullif(it->>'phone_e164','') IS NOT NULL THEN regexp_replace(it->>'phone_e164','^(\+\d{2})\d+(\d{4})$','\1****\2') END,
        due,public.split_token()) RETURNING id INTO pid;
      IF nullif(it->>'phone_e164','') IS NOT NULL THEN PERFORM public.split_enqueue_message(p_id,pid,'invite',now()); END IF;
    ELSE
      UPDATE public.shared_expense_participants SET name=btrim(it->>'name'),phone_e164=nullif(it->>'phone_e164',''),
        phone_masked=CASE WHEN nullif(it->>'phone_e164','') IS NOT NULL THEN regexp_replace(it->>'phone_e164','^(\+\d{2})\d+(\d{4})$','\1****\2') END,
        amount_due=due,status=CASE WHEN amount_paid>=due THEN 'paid' WHEN amount_paid>0 THEN 'partial' ELSE 'pending' END
      WHERE id=pid AND shared_expense_id=p_id;
    END IF;
  END LOOP;
  IF p_register_transaction THEN
    IF p_source_account_id IS NULL AND p_source_credit_card_id IS NULL THEN RAISE EXCEPTION 'Escolha de onde saiu o pagamento'; END IF;
    PERFORM public.split_upsert_original_transaction(p_id);
  ELSIF se.linked_transaction_id IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.shared_expense_participants WHERE shared_expense_id=p_id AND phone_e164 IS NOT NULL AND amount_paid>0) THEN
      RAISE EXCEPTION 'Não remova o gasto depois de receber pagamentos; cancele a divisão preservando o histórico';
    END IF;
    UPDATE public.shared_expenses SET linked_transaction_id=NULL WHERE id=p_id;
    DELETE FROM public.transactions WHERE id=se.linked_transaction_id AND user_id=uid AND split_transaction_role='original_expense';
  END IF;
  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,event_type,payload)
  VALUES(p_id,uid,'updated',jsonb_build_object('previous_total',se.total_amount,'new_total',p_total));
END $$;

CREATE OR REPLACE FUNCTION public.split_cancel(p_id uuid, p_reason text DEFAULT NULL, p_remove_transaction boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid:=auth.uid(); se record; received numeric;
BEGIN
  SELECT * INTO se FROM public.shared_expenses WHERE id=p_id AND owner_user_id=uid FOR UPDATE;
  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;
  SELECT coalesce(sum(amount_paid),0) INTO received FROM public.shared_expense_participants
   WHERE shared_expense_id=p_id AND phone_e164 IS NOT NULL;
  IF p_remove_transaction AND received>0 THEN RAISE EXCEPTION 'Há pagamentos recebidos; mantenha o lançamento para preservar o histórico'; END IF;
  UPDATE public.shared_expenses SET status='cancelled',cancelled_at=now(),cancellation_reason=nullif(btrim(coalesce(p_reason,'')),'') WHERE id=p_id;
  UPDATE public.reminder_jobs SET status='skipped',last_error='split_cancelled',lease_expires_at=NULL
   WHERE shared_expense_id=p_id AND status IN ('queued','processing');
  IF p_remove_transaction AND se.linked_transaction_id IS NOT NULL THEN
    UPDATE public.shared_expenses SET linked_transaction_id=NULL WHERE id=p_id;
    DELETE FROM public.transactions WHERE id=se.linked_transaction_id AND user_id=uid AND split_transaction_role='original_expense';
  END IF;
  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,event_type,payload)
  VALUES(p_id,uid,'cancelled',jsonb_build_object('reason',p_reason,'transaction_removed',p_remove_transaction));
END $$;

CREATE OR REPLACE FUNCTION public.split_add_payment_v2(p_participant_id uuid,p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid:=auth.uid(); p record; se record; new_paid numeric; tx_id uuid; recipient record;
BEGIN
  SELECT * INTO p FROM public.shared_expense_participants WHERE id=p_participant_id AND owner_user_id=uid FOR UPDATE;
  IF p.id IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'Pagamento inválido'; END IF;
  SELECT * INTO se FROM public.shared_expenses WHERE id=p.shared_expense_id FOR UPDATE;
  IF se.status='cancelled' THEN RAISE EXCEPTION 'Divisão cancelada'; END IF;
  new_paid:=least(p.amount_due,p.amount_paid+p_amount);
  IF new_paid<=p.amount_paid THEN RETURN; END IF;
  UPDATE public.shared_expense_participants SET amount_paid=new_paid,
    status=CASE WHEN new_paid>=amount_due THEN 'paid' ELSE 'partial' END,
    paid_at=CASE WHEN new_paid>=amount_due THEN now() ELSE NULL END WHERE id=p.id;
  IF se.reimbursement_account_id IS NOT NULL THEN
    INSERT INTO public.transactions(user_id,account_id,category_id,type,status,amount,occurred_at,description,notes,
      payment_method,movement_kind,shared_expense_id,split_transaction_role)
    VALUES(uid,se.reimbursement_account_id,NULL,'income','confirmed',new_paid-p.amount_paid,current_date,
      'Reembolso · '||se.title,'Recebido de '||p.name||' pela Divisão do Rolê','account','refund',se.id,'reimbursement')
    RETURNING id INTO tx_id;
  END IF;
  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,participant_id,event_type,payload)
  VALUES(se.id,uid,p.id,'payment',jsonb_build_object('amount',new_paid-p.amount_paid,'total_paid',new_paid,'transaction_id',tx_id));
  IF p.phone_e164 IS NOT NULL THEN PERFORM public.split_enqueue_message(se.id,p.id,'payment_confirmation',now()); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.shared_expense_participants WHERE shared_expense_id=se.id AND amount_paid<amount_due) THEN
    UPDATE public.shared_expenses SET status='settled' WHERE id=se.id;
    FOR recipient IN SELECT id FROM public.shared_expense_participants
      WHERE shared_expense_id=se.id AND phone_e164 IS NOT NULL AND opt_out_at IS NULL LOOP
      PERFORM public.split_enqueue_message(se.id,recipient.id,'completed',now());
    END LOOP;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.split_reverse_payment_v2(p_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  UPDATE public.shared_expense_participants SET amount_paid=0,status='pending',paid_at=NULL WHERE id=p.id;
  UPDATE public.shared_expenses SET status='active' WHERE id=se.id AND status='settled';
  INSERT INTO public.shared_expense_events(shared_expense_id,owner_user_id,participant_id,event_type,payload)
  VALUES(se.id,uid,p.id,'reverse_payment',jsonb_build_object('previous_amount',p.amount_paid));
END $$;

CREATE OR REPLACE FUNCTION public.split_summary()
RETURNS TABLE(total_received numeric,total_pending numeric,pending_people bigint,active_splits bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(p.amount_paid) FILTER (WHERE p.phone_e164 IS NOT NULL),0),
         coalesce(sum(greatest(p.amount_due-p.amount_paid,0)) FILTER (WHERE p.phone_e164 IS NOT NULL),0),
         count(*) FILTER (WHERE p.phone_e164 IS NOT NULL AND p.amount_paid<p.amount_due),
         count(DISTINCT s.id) FILTER (WHERE s.status='active')
  FROM public.shared_expenses s JOIN public.shared_expense_participants p ON p.shared_expense_id=s.id
  WHERE s.owner_user_id=auth.uid() AND s.status<>'cancelled'
$$;

CREATE OR REPLACE FUNCTION public.split_message_status(p_id uuid)
RETURNS TABLE(participant_id uuid,job_id uuid,kind text,job_status text,outbound_status text,last_error text,updated_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (j.participant_id) j.participant_id,j.id,j.kind,j.status::text,o.status::text,
    coalesce(o.last_error,j.last_error),greatest(j.updated_at,coalesce(o.updated_at,j.updated_at))
  FROM public.reminder_jobs j JOIN public.shared_expenses s ON s.id=j.shared_expense_id
  LEFT JOIN public.outbound_messages o ON o.id=j.outbound_message_id
  WHERE j.shared_expense_id=p_id AND s.owner_user_id=auth.uid()
  ORDER BY j.participant_id,j.updated_at DESC
$$;

REVOKE ALL ON FUNCTION public.split_assert_financial_source(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.split_upsert_original_transaction(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.split_create_v2(text,numeric,date,date,public.split_mode,boolean,boolean,text,jsonb,numeric,uuid,uuid,uuid,uuid,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.split_update(uuid,text,numeric,date,date,public.split_mode,boolean,text,jsonb,uuid,uuid,uuid,uuid,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.split_cancel(uuid,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.split_add_payment_v2(uuid,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.split_reverse_payment_v2(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.split_summary() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.split_message_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.split_create_v2(text,numeric,date,date,public.split_mode,boolean,boolean,text,jsonb,numeric,uuid,uuid,uuid,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_update(uuid,text,numeric,date,date,public.split_mode,boolean,text,jsonb,uuid,uuid,uuid,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_cancel(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_add_payment_v2(uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_reverse_payment_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_enqueue_message(uuid,uuid,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_message_status(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
