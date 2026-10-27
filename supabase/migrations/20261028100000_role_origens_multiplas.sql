-- Rolê com várias origens (dívida, cartão, conta) e rateio dos recebimentos.
-- A "amarra" (de onde saiu cada parte do valor) é informação do DONO: fica numa tabela
-- só dele; o participante só enxerga a própria parte e as datas.

create table if not exists public.shared_expense_sources (
  id uuid primary key default gen_random_uuid(),
  shared_expense_id uuid not null references public.shared_expenses(id) on delete cascade,
  owner_user_id uuid not null,
  kind text not null check (kind in ('debt', 'credit_card', 'account')),
  debt_id uuid,
  credit_card_id uuid,
  account_id uuid,
  amount numeric(14,2) not null check (amount > 0),
  -- true: o gasto desta origem vira lançamento do rolê; false: já entra (ou vai entrar) pela fatura/extrato.
  register_transaction boolean not null default true,
  installments int check (installments between 1 and 48),
  first_due date,
  created_at timestamptz not null default now(),
  check ((kind = 'debt' and debt_id is not null) or (kind = 'credit_card' and credit_card_id is not null) or (kind = 'account' and account_id is not null))
);
create index if not exists idx_shared_expense_sources_expense on public.shared_expense_sources(shared_expense_id);
alter table public.shared_expense_sources enable row level security;
revoke all on public.shared_expense_sources from anon, authenticated;
grant select on public.shared_expense_sources to authenticated;
grant all on public.shared_expense_sources to service_role;
drop policy if exists "owner reads sources" on public.shared_expense_sources;
create policy "owner reads sources" on public.shared_expense_sources
  for select to authenticated using (owner_user_id = auth.uid());

alter table public.shared_expense_payments add column if not exists secondary_transaction_id uuid;

-- Fração do rolê que corresponde a gasto LANÇADO no app (origens conta/cartão com lançamento).
-- Sem origens cadastradas (rolês antigos) = 1: comportamento anterior preservado.
create or replace function public.split_ledger_share(p_expense_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.shared_expense_sources s where s.shared_expense_id = p_expense_id) then 1::numeric
    else coalesce((select sum(s.amount) from public.shared_expense_sources s
                    where s.shared_expense_id = p_expense_id and s.kind in ('account', 'credit_card') and s.register_transaction), 0)
         / nullif((select se.total_amount from public.shared_expenses se where se.id = p_expense_id), 0)
  end
$$;
revoke all on function public.split_ledger_share(uuid) from public, anon, authenticated;
grant execute on function public.split_ledger_share(uuid) to service_role;

-- O lançamento original passa a valer só a parte da origem lançada (não o total do rolê).
create or replace function public.split_upsert_original_transaction(p_expense_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  uid uuid := auth.uid();
  se record;
  src record;
  tx_id uuid;
  competence date;
  v_amount numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  SELECT * INTO se FROM public.shared_expenses WHERE id = p_expense_id AND owner_user_id = uid FOR UPDATE;
  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;

  v_amount := se.total_amount;
  SELECT s.amount, s.register_transaction INTO src
    FROM public.shared_expense_sources s
   WHERE s.shared_expense_id = se.id AND s.kind IN ('account', 'credit_card') LIMIT 1;
  IF FOUND THEN
    IF NOT src.register_transaction THEN RETURN NULL; END IF;
    v_amount := src.amount;
  END IF;

  IF se.source_account_id IS NULL AND se.source_credit_card_id IS NULL THEN RETURN NULL; END IF;

  IF se.source_credit_card_id IS NOT NULL THEN
    SELECT public.credit_card_competence(closing_day, se.occurred_at) INTO competence
      FROM public.credit_cards WHERE id = se.source_credit_card_id AND user_id = uid;
  END IF;

  SELECT t.id INTO tx_id FROM public.transactions t
   WHERE t.user_id = uid AND t.split_transaction_role = 'original_expense'
     AND (t.id = se.linked_transaction_id OR t.shared_expense_id = se.id)
   ORDER BY CASE WHEN t.id = se.linked_transaction_id THEN 0 ELSE 1 END
   LIMIT 1 FOR UPDATE;

  IF tx_id IS NULL THEN
    INSERT INTO public.transactions(
      user_id, account_id, category_id, type, status, amount, occurred_at,
      description, notes, payment_method, credit_card_id, purchase_date,
      competence_date, movement_kind, shared_expense_id, split_transaction_role
    ) VALUES (
      uid, se.source_account_id, se.category_id, 'expense', 'confirmed', v_amount, se.occurred_at,
      se.title, 'Criado pela Divisão do Rolê',
      CASE WHEN se.source_credit_card_id IS NULL THEN 'account' ELSE 'credit_card' END,
      se.source_credit_card_id,
      CASE WHEN se.source_credit_card_id IS NOT NULL THEN se.occurred_at END,
      competence, 'transaction', se.id, 'original_expense'
    ) RETURNING id INTO tx_id;
  ELSE
    UPDATE public.transactions
       SET account_id = se.source_account_id,
           credit_card_id = se.source_credit_card_id,
           payment_method = CASE WHEN se.source_credit_card_id IS NULL THEN 'account' ELSE 'credit_card' END,
           category_id = se.category_id,
           amount = v_amount,
           occurred_at = se.occurred_at,
           purchase_date = CASE WHEN se.source_credit_card_id IS NOT NULL THEN se.occurred_at END,
           competence_date = competence,
           description = se.title,
           notes = 'Criado pela Divisão do Rolê',
           movement_kind = 'transaction',
           shared_expense_id = se.id,
           split_transaction_role = 'original_expense',
           updated_at = now()
     WHERE id = tx_id AND user_id = uid;
  END IF;

  UPDATE public.shared_expenses SET linked_transaction_id = tx_id, updated_at = now()
   WHERE id = se.id AND linked_transaction_id IS DISTINCT FROM tx_id;
  RETURN tx_id;
END
$$;

-- Recebimento de parcela: a parte que cobre gasto lançado vira REEMBOLSO (abate o gasto);
-- a parte que cobre origem não lançada (ex.: dívida) entra no caixa como transferência recebida,
-- sem virar renda e sem abater gasto que nunca foi lançado.
create or replace function public.split_add_installment_payment(p_installment_id uuid, p_amount numeric, p_paid_at timestamptz default now(), p_reference text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  uid uuid := auth.uid();
  inst record; se record; part record;
  v_balance numeric; v_apply numeric; tx_id uuid; tx2_id uuid; pay_id uuid;
  v_share numeric; v_ledger numeric; v_other numeric;
  recipient record; v_all_paid boolean;
  v_date date;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  SELECT * INTO inst FROM public.shared_expense_installments
   WHERE id = p_installment_id AND owner_user_id = uid FOR UPDATE;
  IF inst.id IS NULL THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  IF inst.status = 'cancelled' THEN RAISE EXCEPTION 'Parcela cancelada'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Informe um valor válido'; END IF;

  SELECT * INTO se FROM public.shared_expenses WHERE id = inst.shared_expense_id FOR UPDATE;
  IF se.status = 'cancelled' THEN RAISE EXCEPTION 'Divisão cancelada'; END IF;
  SELECT * INTO part FROM public.shared_expense_participants WHERE id = inst.participant_id;

  v_balance := greatest(inst.amount - inst.paid_amount, 0);
  IF v_balance <= 0 THEN RAISE EXCEPTION 'Esta parcela já está quitada'; END IF;
  v_apply := least(p_amount, v_balance);
  v_date := (p_paid_at AT TIME ZONE 'America/Sao_Paulo')::date;

  IF se.reimbursement_account_id IS NOT NULL THEN
    v_share := coalesce(public.split_ledger_share(se.id), 1);
    v_ledger := round(v_apply * v_share, 2);
    v_other := v_apply - v_ledger;
    IF v_ledger > 0 THEN
      INSERT INTO public.transactions(user_id, account_id, category_id, type, status, amount, occurred_at,
        description, notes, payment_method, movement_kind, shared_expense_id, split_transaction_role)
      VALUES (uid, se.reimbursement_account_id, NULL, 'income', 'confirmed', v_ledger, v_date,
        'Reembolso · ' || se.title,
        format('Recebido de %s — parcela %s/%s da Divisão do Rolê', part.name, inst.installment_number, inst.total_installments),
        'account', 'refund', se.id, 'reimbursement')
      RETURNING id INTO tx_id;
    END IF;
    IF v_other > 0 THEN
      INSERT INTO public.transactions(user_id, account_id, category_id, type, status, amount, occurred_at,
        description, notes, payment_method, movement_kind, shared_expense_id, split_transaction_role)
      VALUES (uid, se.reimbursement_account_id, NULL, 'income', 'confirmed', v_other, v_date,
        'Recebimento · ' || se.title,
        format('Recebido de %s — parcela %s/%s da Divisão do Rolê', part.name, inst.installment_number, inst.total_installments),
        'account', 'external_transfer_in', se.id, 'reimbursement')
      RETURNING id INTO tx2_id;
    END IF;
    IF tx_id IS NULL THEN tx_id := tx2_id; tx2_id := NULL; END IF;
  END IF;

  INSERT INTO public.shared_expense_payments(
    shared_expense_id, installment_id, participant_id, owner_user_id, amount, paid_at, transaction_id, secondary_transaction_id, reference)
  VALUES (se.id, inst.id, inst.participant_id, uid, v_apply, coalesce(p_paid_at, now()), tx_id, tx2_id, p_reference)
  RETURNING id INTO pay_id;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, participant_id, event_type, payload)
  VALUES (se.id, uid, inst.participant_id,
    CASE WHEN v_apply >= v_balance THEN 'installment_paid' ELSE 'installment_partial_payment' END,
    jsonb_build_object('installment_id', inst.id, 'installment_number', inst.installment_number,
      'amount', v_apply, 'balance_after', v_balance - v_apply, 'payment_id', pay_id, 'transaction_id', tx_id));

  IF v_apply >= v_balance THEN
    UPDATE public.reminder_jobs
       SET status = 'skipped', cancel_reason = 'already_paid', last_error = 'already_paid',
           lease_expires_at = NULL, updated_at = now()
     WHERE installment_id = inst.id
       AND status IN ('queued','processing')
       AND kind IN ('reminder','due_soon','due_today','overdue');
  END IF;

  IF part.phone_e164 IS NOT NULL THEN
    PERFORM public.split_enqueue_installment_message(se.id, inst.participant_id, inst.id, 'payment_confirmation', now());
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.shared_expense_installments
     WHERE shared_expense_id = se.id AND status IN ('pending','partial')) INTO v_all_paid;

  IF v_all_paid THEN
    FOR recipient IN SELECT id FROM public.shared_expense_participants
      WHERE shared_expense_id = se.id AND phone_e164 IS NOT NULL AND opt_out_at IS NULL LOOP
      PERFORM public.split_enqueue_message(se.id, recipient.id, 'completed', now());
    END LOOP;
  END IF;

  RETURN jsonb_build_object('payment_id', pay_id, 'applied', v_apply,
    'balance', v_balance - v_apply, 'transaction_id', tx_id, 'settled', v_all_paid);
END;
$$;

create or replace function public.split_reverse_installment_payment(p_payment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
DECLARE uid uuid := auth.uid(); pay record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  SELECT * INTO pay FROM public.shared_expense_payments
   WHERE id = p_payment_id AND owner_user_id = uid FOR UPDATE;
  IF pay.id IS NULL THEN RAISE EXCEPTION 'Recebimento não encontrado'; END IF;
  IF pay.reversed_at IS NOT NULL THEN RETURN; END IF;

  UPDATE public.shared_expense_payments
     SET reversed_at = now(), reversal_reason = p_reason
   WHERE id = pay.id;

  IF pay.transaction_id IS NOT NULL THEN
    DELETE FROM public.transactions WHERE id = pay.transaction_id AND user_id = uid;
  END IF;
  IF pay.secondary_transaction_id IS NOT NULL THEN
    DELETE FROM public.transactions WHERE id = pay.secondary_transaction_id AND user_id = uid;
  END IF;

  UPDATE public.shared_expenses SET status = 'active'::split_status
   WHERE id = pay.shared_expense_id AND status = 'settled'::split_status;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, participant_id, event_type, payload)
  VALUES (pay.shared_expense_id, uid, pay.participant_id, 'reverse_payment',
    jsonb_build_object('payment_id', pay.id, 'amount', pay.amount, 'reason', p_reason));
END;
$$;

-- Define as origens do rolê (lista com valor por origem). Só o dono. A soma precisa fechar com o total.
create or replace function public.split_set_sources(p_expense_id uuid, p_sources jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  uid uuid := auth.uid();
  se record; it jsonb; k text; amt numeric; sum_cents bigint := 0;
  ledger_n int := 0; ledger_kind text; ledger_ref uuid; ledger_reg boolean := false;
  tx record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada'; END IF;
  SELECT * INTO se FROM public.shared_expenses WHERE id = p_expense_id AND owner_user_id = uid FOR UPDATE;
  IF se.id IS NULL THEN RAISE EXCEPTION 'Divisão não encontrada'; END IF;

  IF p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array' OR jsonb_array_length(p_sources) = 0 THEN
    DELETE FROM public.shared_expense_sources WHERE shared_expense_id = p_expense_id;
    RETURN jsonb_build_object('ok', true, 'sources', 0);
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_sources) LOOP
    k := it->>'kind';
    amt := (it->>'amount')::numeric;
    IF k NOT IN ('debt', 'credit_card', 'account') THEN RAISE EXCEPTION 'Origem inválida'; END IF;
    IF amt IS NULL OR amt <= 0 THEN RAISE EXCEPTION 'Informe o valor de cada origem'; END IF;
    IF k = 'debt' AND NOT EXISTS (SELECT 1 FROM public.debts d WHERE d.id = (it->>'ref_id')::uuid AND d.user_id = uid) THEN
      RAISE EXCEPTION 'Dívida inválida'; END IF;
    IF k = 'credit_card' AND NOT EXISTS (SELECT 1 FROM public.credit_cards c WHERE c.id = (it->>'ref_id')::uuid AND c.user_id = uid AND c.active) THEN
      RAISE EXCEPTION 'Cartão inválido'; END IF;
    IF k = 'account' AND NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = (it->>'ref_id')::uuid AND a.user_id = uid AND a.active) THEN
      RAISE EXCEPTION 'Conta inválida'; END IF;
    IF k IN ('credit_card', 'account') THEN
      ledger_n := ledger_n + 1;
      ledger_kind := k; ledger_ref := (it->>'ref_id')::uuid;
      ledger_reg := coalesce((it->>'register_transaction')::boolean, true);
    END IF;
    sum_cents := sum_cents + round(amt * 100)::bigint;
  END LOOP;
  IF ledger_n > 1 THEN RAISE EXCEPTION 'Use no máximo um cartão ou conta por rolê (podem ser várias dívidas)'; END IF;
  IF sum_cents <> round(se.total_amount * 100)::bigint THEN
    RAISE EXCEPTION 'A soma das origens precisa ser igual ao total do rolê';
  END IF;

  DELETE FROM public.shared_expense_sources WHERE shared_expense_id = p_expense_id;
  FOR it IN SELECT * FROM jsonb_array_elements(p_sources) LOOP
    k := it->>'kind';
    INSERT INTO public.shared_expense_sources(shared_expense_id, owner_user_id, kind, debt_id, credit_card_id, account_id,
      amount, register_transaction, installments, first_due)
    VALUES (p_expense_id, uid, k,
      CASE WHEN k = 'debt' THEN (it->>'ref_id')::uuid END,
      CASE WHEN k = 'credit_card' THEN (it->>'ref_id')::uuid END,
      CASE WHEN k = 'account' THEN (it->>'ref_id')::uuid END,
      round((it->>'amount')::numeric, 2),
      CASE WHEN k = 'debt' THEN false ELSE coalesce((it->>'register_transaction')::boolean, true) END,
      nullif(it->>'installments', '')::int,
      nullif(it->>'first_due', '')::date);
  END LOOP;

  UPDATE public.shared_expenses
     SET source_account_id = CASE WHEN ledger_kind = 'account' AND ledger_reg THEN ledger_ref END,
         source_credit_card_id = CASE WHEN ledger_kind = 'credit_card' AND ledger_reg THEN ledger_ref END,
         updated_at = now()
   WHERE id = p_expense_id;

  IF ledger_n = 1 AND ledger_reg THEN
    PERFORM public.split_upsert_original_transaction(p_expense_id);
  ELSE
    -- Nada a lançar: desvincula e remove o lançamento antigo sem cancelar o rolê
    -- (apagar o lançamento original cancelaria a divisão pelo gatilho de sincronização).
    FOR tx IN SELECT t.id FROM public.transactions t
               WHERE t.user_id = uid AND t.split_transaction_role = 'original_expense'
                 AND (t.id = se.linked_transaction_id OR t.shared_expense_id = se.id) LOOP
      UPDATE public.transactions SET shared_expense_id = NULL, split_transaction_role = NULL WHERE id = tx.id;
      DELETE FROM public.transactions WHERE id = tx.id AND user_id = uid;
    END LOOP;
    UPDATE public.shared_expenses SET linked_transaction_id = NULL, updated_at = now() WHERE id = p_expense_id;
  END IF;

  INSERT INTO public.shared_expense_events(shared_expense_id, owner_user_id, event_type, payload)
  VALUES (p_expense_id, uid, 'updated', jsonb_build_object('sources', jsonb_array_length(p_sources)));
  RETURN jsonb_build_object('ok', true, 'sources', jsonb_array_length(p_sources));
END;
$$;
revoke all on function public.split_set_sources(uuid, jsonb) from public, anon;
grant execute on function public.split_set_sources(uuid, jsonb) to authenticated;

-- Criação sem lançamento (ex.: o valor veio de uma dívida) não exige conta/cartão.
-- (split_update já aceita isso quando p_register_transaction = false.)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.split_create_v2(text,numeric,date,date,split_mode,boolean,boolean,text,jsonb,numeric,uuid,uuid,uuid,uuid,boolean)'::regprocedure);
  d := replace(d, 'IF p_source_account_id IS NULL AND p_source_credit_card_id IS NULL THEN',
                  'IF coalesce(p_register_transaction, true) AND p_source_account_id IS NULL AND p_source_credit_card_id IS NULL THEN');
  if d not like '%IF coalesce(p_register_transaction, true) AND p_source_account_id IS NULL%' then raise exception 'patch_not_applied: split_create_v2'; end if;
  execute d;
end $$;
