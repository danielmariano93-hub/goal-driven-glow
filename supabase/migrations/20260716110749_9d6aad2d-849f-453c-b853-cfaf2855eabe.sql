
-- 1. credit_cards
CREATE TABLE public.credit_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  brand text,
  last_four text,
  total_limit numeric(14,2) NOT NULL DEFAULT 0,
  closing_day smallint NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day smallint NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  color text,
  statement_goal numeric(14,2),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_cards TO authenticated;
GRANT ALL ON public.credit_cards TO service_role;

ALTER TABLE public.credit_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_cards_all_own" ON public.credit_cards
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX credit_cards_user_idx ON public.credit_cards(user_id) WHERE active;

CREATE TRIGGER credit_cards_updated
  BEFORE UPDATE ON public.credit_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. transactions: payment method + credit card fields
-- account_id continua NOT NULL (compatibilidade). Para cartão, usamos uma "conta virtual"?
-- Alternativa: relaxar NOT NULL do account_id só quando cartão.
ALTER TABLE public.transactions
  ADD COLUMN payment_method text NOT NULL DEFAULT 'account'
    CHECK (payment_method IN ('account','credit_card')),
  ADD COLUMN credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE RESTRICT,
  ADD COLUMN installment_number int CHECK (installment_number IS NULL OR installment_number BETWEEN 1 AND 48),
  ADD COLUMN installments_total int CHECK (installments_total IS NULL OR installments_total BETWEEN 1 AND 48),
  ADD COLUMN purchase_date date,
  ADD COLUMN competence_date date;

CREATE INDEX transactions_credit_card_idx
  ON public.transactions(credit_card_id, competence_date)
  WHERE credit_card_id IS NOT NULL;

-- Permitir account_id NULL quando for cartão
ALTER TABLE public.transactions ALTER COLUMN account_id DROP NOT NULL;

-- Atualizar trigger validate_transaction para respeitar payment_method
CREATE OR REPLACE FUNCTION public.validate_transaction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare acc_user uuid; cat_user uuid; card_user uuid;
begin
  if new.payment_method = 'credit_card' then
    if new.credit_card_id is null then raise exception 'credit_card_id required when payment_method=credit_card'; end if;
    select user_id into card_user from public.credit_cards where id = new.credit_card_id;
    if card_user is null or card_user <> new.user_id then raise exception 'credit card does not belong to user'; end if;
    if new.type = 'transfer' then raise exception 'transfers cannot use credit_card'; end if;
    if new.type = 'income' then raise exception 'income cannot be on credit_card'; end if;
    -- account_id pode ser null quando cartão
  else
    if new.account_id is null then raise exception 'account_id required'; end if;
    select user_id into acc_user from public.accounts where id = new.account_id;
    if acc_user is null or acc_user <> new.user_id then raise exception 'account does not belong to user'; end if;
  end if;
  if new.category_id is not null then
    select user_id into cat_user from public.categories where id = new.category_id;
    if cat_user is not null and cat_user <> new.user_id then raise exception 'category does not belong to user'; end if;
  end if;
  if new.type = 'transfer' then
    if new.category_id is not null then raise exception 'transfer must not have a category'; end if;
    if new.transfer_group_id is null then raise exception 'transfer must have a transfer_group_id'; end if;
    if new.direction is null then raise exception 'transfer must have a direction'; end if;
  end if;
  return new;
end $function$;

-- 3. conversations.source
ALTER TABLE public.conversations
  ADD COLUMN source text NOT NULL DEFAULT 'whatsapp'
    CHECK (source IN ('whatsapp','app'));

-- phone_e164 NOT NULL — relaxar para app
ALTER TABLE public.conversations ALTER COLUMN phone_e164 DROP NOT NULL;

CREATE INDEX conv_user_source_idx ON public.conversations(user_id, source, last_message_at DESC);

-- 4. Função helper para calcular competência do cartão
CREATE OR REPLACE FUNCTION public.credit_card_competence(p_closing_day int, p_purchase date)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN EXTRACT(day FROM p_purchase)::int <= p_closing_day
      THEN date_trunc('month', p_purchase)::date
    ELSE (date_trunc('month', p_purchase) + interval '1 month')::date
  END
$$;
