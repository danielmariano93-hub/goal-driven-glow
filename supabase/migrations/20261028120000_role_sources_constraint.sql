-- A restrição antiga exigia EXATAMENTE uma origem conta/cartão na linha do rolê, o que impede
-- rolês financiados só por dívida. Passa a aceitar no máximo uma.
alter table public.shared_expenses drop constraint if exists shared_expenses_exactly_one_financial_source;
alter table public.shared_expenses add constraint shared_expenses_at_most_one_financial_source
  check ((((source_account_id is not null))::integer + ((source_credit_card_id is not null))::integer) <= 1) not valid;

-- A conta/cartão ficam SEMPRE nas colunas antigas; se o gasto vira lançamento ou não é decidido
-- pela tabela de origens (register_transaction).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.split_set_sources(uuid,jsonb)'::regprocedure);
  d := replace(d, 'WHEN ledger_kind = ''account'' AND ledger_reg THEN ledger_ref', 'WHEN ledger_kind = ''account'' THEN ledger_ref');
  d := replace(d, 'WHEN ledger_kind = ''credit_card'' AND ledger_reg THEN ledger_ref', 'WHEN ledger_kind = ''credit_card'' THEN ledger_ref');
  if d like '%ledger_kind = ''account'' AND ledger_reg%' or d like '%ledger_kind = ''credit_card'' AND ledger_reg%' then
    raise exception 'patch_not_applied: split_set_sources';
  end if;
  execute d;
end $$;
