-- 1) Fix operator does not exist: text = text[] and extend patch to account/card/method
CREATE OR REPLACE FUNCTION public.transaction_update_direct(
  p_id uuid, p_expected_version integer, p_patch jsonb, p_scope text DEFAULT 'one'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare target record; affected_ids uuid[]; rc int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'unauthenticated'); end if;
  select * into target from public.transactions where id = p_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if target.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'error', 'conflict', 'current_version', target.version);
  end if;

  if p_scope = 'all' and target.purchase_group_id is not null then
    select array_agg(id) into affected_ids from public.transactions
      where user_id = auth.uid() and purchase_group_id = target.purchase_group_id;
  elsif p_scope = 'future' and target.purchase_group_id is not null then
    select array_agg(id) into affected_ids from public.transactions
      where user_id = auth.uid() and purchase_group_id = target.purchase_group_id
        and coalesce(installment_number, 1) >= coalesce(target.installment_number, 1);
  else
    affected_ids := ARRAY[target.id];
  end if;

  -- Basic method/account/card coherence validations when they are being patched
  if p_patch ? 'payment_method' then
    if (p_patch->>'payment_method') not in ('account','credit_card') then
      return jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
    end if;
    if (p_patch->>'payment_method') = 'credit_card'
       and nullif(coalesce(p_patch->>'credit_card_id', target.credit_card_id::text), '') is null then
      return jsonb_build_object('ok', false, 'error', 'credit_card_required');
    end if;
    if (p_patch->>'payment_method') = 'account'
       and nullif(coalesce(p_patch->>'account_id', target.account_id::text), '') is null then
      return jsonb_build_object('ok', false, 'error', 'account_required');
    end if;
  end if;

  update public.transactions t set
    description = case when p_patch ? 'description' then nullif(p_patch->>'description','') else t.description end,
    category_id = case when p_patch ? 'category_id' then nullif(p_patch->>'category_id','')::uuid else t.category_id end,
    amount      = case when p_patch ? 'amount' then (p_patch->>'amount')::numeric else t.amount end,
    occurred_at = case when p_patch ? 'occurred_at' then (p_patch->>'occurred_at')::date else t.occurred_at end,
    notes       = case when p_patch ? 'notes' then nullif(p_patch->>'notes','') else t.notes end,
    purchase_date = case when p_patch ? 'purchase_date' then nullif(p_patch->>'purchase_date','')::date else t.purchase_date end,
    competence_date = case when p_patch ? 'competence_date' then nullif(p_patch->>'competence_date','')::date else t.competence_date end,
    payment_method = case when p_patch ? 'payment_method' then p_patch->>'payment_method' else t.payment_method end,
    account_id = case
                   when p_patch ? 'account_id' then nullif(p_patch->>'account_id','')::uuid
                   when p_patch ? 'payment_method' and (p_patch->>'payment_method') = 'credit_card' then null
                   else t.account_id end,
    credit_card_id = case
                   when p_patch ? 'credit_card_id' then nullif(p_patch->>'credit_card_id','')::uuid
                   when p_patch ? 'payment_method' and (p_patch->>'payment_method') = 'account' then null
                   else t.credit_card_id end
  where t.id = any(affected_ids) and t.user_id = auth.uid();
  GET DIAGNOSTICS rc = ROW_COUNT;

  -- FIX: was `(evidence->>'transaction_id')::text = any((select array_agg(x::text) ...))`
  -- which Postgres reads as text = text[] because the subquery is scalar-of-array.
  if p_patch ? 'category_id' and nullif(p_patch->>'category_id','') is not null then
    update public.user_insights set status = 'dismissed'
     where user_id = auth.uid()
       and type = 'categorize_transaction'
       and status = 'active'
       and (evidence->>'transaction_id') in (
             select x::text from unnest(affected_ids) x
           );
  end if;

  return jsonb_build_object('ok', true, 'ids', to_jsonb(affected_ids), 'rows', rc, 'scope', p_scope);
end $function$;

-- 2) Ownership integrity for extracted_items
CREATE OR REPLACE FUNCTION public.validate_extracted_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare doc_user uuid; acc_user uuid; card_user uuid; cat_user uuid;
begin
  select user_id into doc_user from public.document_imports where id = new.document_id;
  if doc_user is null or doc_user <> new.user_id then
    raise exception 'extracted_item user_id must match document_imports.user_id';
  end if;
  if new.account_id is not null then
    select user_id into acc_user from public.accounts where id = new.account_id;
    if acc_user is null or acc_user <> new.user_id then
      raise exception 'account does not belong to user';
    end if;
  end if;
  if new.credit_card_id is not null then
    select user_id into card_user from public.credit_cards where id = new.credit_card_id;
    if card_user is null or card_user <> new.user_id then
      raise exception 'credit card does not belong to user';
    end if;
  end if;
  if new.category_id is not null then
    select user_id into cat_user from public.categories where id = new.category_id;
    if cat_user is not null and cat_user <> new.user_id then
      raise exception 'category does not belong to user';
    end if;
  end if;
  return new;
end $function$;

DROP TRIGGER IF EXISTS trg_validate_extracted_item ON public.extracted_items;
CREATE TRIGGER trg_validate_extracted_item
BEFORE INSERT OR UPDATE ON public.extracted_items
FOR EACH ROW EXECUTE FUNCTION public.validate_extracted_item();

-- 3) Dedup unique for document_imports by sha (only real hashes)
CREATE UNIQUE INDEX IF NOT EXISTS document_imports_user_sha_key
  ON public.document_imports (user_id, sha256)
  WHERE sha256 !~ '^pending:';
