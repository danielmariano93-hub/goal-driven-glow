CREATE OR REPLACE FUNCTION public.agent_execute_shared_expense_confirmation(p_confirmation_id uuid, p_source_message_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c public.pending_confirmations; p jsonb; new_id uuid; result jsonb;
BEGIN
  SELECT * INTO c FROM public.pending_confirmations WHERE id=p_confirmation_id FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  IF c.status='confirmed' AND c.result_snapshot IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'result',c.result_snapshot);
  END IF;
  IF c.status<>'pending' OR c.expires_at<now() OR c.kind<>'shared_expense' THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_or_expired');
  END IF;
  PERFORM set_config('request.jwt.claim.sub', c.user_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',c.user_id,'role','authenticated')::text, true);
  p := c.payload;
  SELECT public.split_create_v3(
    p->>'title', (p->>'total')::numeric, (p->>'occurred_at')::date,
    nullif(p->>'due_date','')::date, coalesce(p->>'split_mode','equal')::public.split_mode,
    coalesce((p->>'include_owner')::boolean,true), coalesce((p->>'reminder_enabled')::boolean,false),
    nullif(p->>'pix_key',''), coalesce(p->'participants','[]'::jsonb),
    nullif(p->>'owner_amount','')::numeric, nullif(p->>'source_account_id','')::uuid,
    nullif(p->>'source_credit_card_id','')::uuid, nullif(p->>'reimbursement_account_id','')::uuid,
    nullif(p->>'category_id','')::uuid, true,
    CASE WHEN p->'installments' IS NULL OR p->'installments' = 'null'::jsonb THEN NULL ELSE p->'installments' END
  ) INTO new_id;
  result := jsonb_build_object('kind','shared_expense','shared_expense_id',new_id,'title',p->>'title','total',p->>'total');
  UPDATE public.pending_confirmations SET status='confirmed',executed_at=now(),
    result_snapshot=result,confirmed_from_message_id=p_source_message_id WHERE id=c.id;
  RETURN jsonb_build_object('ok',true,'idempotent',false,'result',result);
END $function$;