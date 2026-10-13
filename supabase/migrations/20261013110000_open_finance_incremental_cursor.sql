-- Open Finance incremental: cada conta vinculada lembra até que dia já foi extraída para revisão.
-- A próxima extração começa dali (com pequena sobreposição), em vez de reler o mês inteiro.
alter table public.bank_account_links
  add column if not exists extracted_through date;

comment on column public.bank_account_links.extracted_through is
  'Último dia (data local) coberto por uma extração enviada para revisão. Só avança após o lote ser gravado.';

create index if not exists idx_extracted_items_user_bank_reference
  on public.extracted_items (user_id, bank_reference)
  where bank_reference is not null;
