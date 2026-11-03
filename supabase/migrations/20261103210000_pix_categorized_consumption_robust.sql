-- Pix/transferência enviada a pessoa com categoria de CONSUMO conta como gasto (`pix_consumption.v2`).
--
-- Contexto: a regra "categorizou, conta" já existia (20261008600000), mas não valia para o que chega por
-- documento importado: `trg_fill_import_transaction_metadata` (BEFORE INSERT, dispara depois de
-- `transactions_01_promote…` por ordem alfabética) reescreve `movement_kind` com o valor do item extraído e desfaz
-- a promoção. Resultado: Pix categorizados (por você ou pelo que o Nino aprendeu de você) continuavam neutros.
--
-- O que muda:
--  1. A promoção roda POR ÚLTIMO (`trg_zz_…`), depois de qualquer outro gatilho que mexa em `movement_kind`.
--  2. Só promove categoria de consumo. Dívida/empréstimo, divisão de rolê/reembolso, fatura, aplicação/investimento e
--     transferência continuam neutros (pagamento de dívida é passivo; divisão é a receber; não são gasto).
--  3. `promoted_from_transfer` lembra que a linha nasceu como transferência: se a categoria deixar de ser de consumo
--     (ou ficar vazia), ela volta a ser transferência neutra. Corrigir a categoria corrige o resultado.
--  4. Editar só o tipo do movimento (ex.: marcar como transferência) continua sem ser desfeito pelo gatilho.
--
-- Linhas antigas de outros usuários não são tocadas em massa. Backfill do dono (aplicado à parte):
--   update public.transactions set movement_kind = 'transaction', promoted_from_transfer = true
--    where user_id = '088920ce-1f5e-47d5-9e07-e2e4a63f9214' and type = 'expense' and movement_kind = 'external_transfer_out'
--      and public.category_is_consumption(category_id);

alter table public.transactions
  add column if not exists promoted_from_transfer boolean not null default false;

comment on column public.transactions.promoted_from_transfer is
  'true = nasceu como transferência externa e foi promovida a gasto por ter categoria de consumo (pix_consumption.v2).';

-- Categoria de consumo: despesa que não é dívida, divisão/reembolso, fatura, aplicação nem transferência.
create or replace function public.category_is_consumption(p_category_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce((
    select c.type::text = 'expense'
       and (coalesce(c.name, '') || ' ' || coalesce(c.slug, ''))
           !~* '(aplica[cç]|investiment|poupan|d[ií]vida|empr[eé]stimo|financiament|divis[aã]o|reembols|fatura|transfer[eê]ncia)'
      from public.categories c
     where c.id = p_category_id
  ), false)
$$;

create or replace function public.tf_promote_categorized_transfer()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.type is distinct from 'expense' then
    return new;
  end if;

  if new.category_id is not null and public.category_is_consumption(new.category_id) then
    -- Promove no INSERT já categorizado ou quando a categoria MUDA.
    if new.movement_kind = 'external_transfer_out'
       and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) then
      new.movement_kind := 'transaction';
      new.promoted_from_transfer := true;
    end if;
  elsif tg_op = 'UPDATE'
        and new.promoted_from_transfer
        and new.movement_kind = 'transaction'
        and new.category_id is distinct from old.category_id then
    -- A categoria deixou de ser de consumo (ou foi limpa): volta a ser transferência neutra.
    new.movement_kind := 'external_transfer_out';
    new.promoted_from_transfer := false;
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_01_promote_categorized_transfer on public.transactions;
drop trigger if exists trg_zz_promote_categorized_transfer on public.transactions;
create trigger trg_zz_promote_categorized_transfer
  before insert or update of category_id on public.transactions
  for each row execute function public.tf_promote_categorized_transfer();
