-- Regra: Pix/transferência enviada a pessoa começa "a classificar" (external_transfer_out, neutra: não infla o gasto).
-- Quando a pessoa — ou o que o Nino aprendeu dela — dá uma categoria de consumo, o dinheiro que saiu para essa
-- categoria passa a CONTAR como gasto dela (movement_kind = 'transaction'): metas, relatórios e ritmo enxergam.
-- Sem categoria, continua neutro. Vale para toda origem (importação, WhatsApp, edição manual).
--
-- Promove no INSERT já categorizado ou quando a categoria MUDA. Editar só o tipo de movimento (ex.: reverter
-- para transferência) nunca é desfeito pelo gatilho, e linhas antigas de outros usuários não são tocadas em massa.
create or replace function public.tf_promote_categorized_transfer()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.type = 'expense'
     and new.movement_kind = 'external_transfer_out'
     and new.category_id is not null
     and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) then
    new.movement_kind := 'transaction';
  end if;
  return new;
end;
$$;

create or replace trigger transactions_01_promote_categorized_transfer
  before insert or update of category_id on public.transactions
  for each row execute function public.tf_promote_categorized_transfer();

-- Dados do usuário que levantou o caso (5 Pix de outubro categorizados como Lazer, R$ 291,00), aplicados à parte:
--   update public.transactions set movement_kind = 'transaction'
--    where user_id = '088920ce-1f5e-47d5-9e07-e2e4a63f9214' and type = 'expense'
--      and movement_kind = 'external_transfer_out' and category_id is not null;
