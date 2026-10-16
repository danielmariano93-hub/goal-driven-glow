-- Mapa Financeiro, fase 2: dados que o usuário confirma e que o ledger não sabe (captura guiada, sempre com "não sei").

-- "Essencial" é por usuário (categorias globais não podem ser editadas): tri-estado = ausência de linha.
create table if not exists public.category_essential_flags (
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  essential boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, category_id)
);
alter table public.category_essential_flags enable row level security;
create policy "essential_flags_select_own" on public.category_essential_flags for select to authenticated using (user_id = (select auth.uid()));
create policy "essential_flags_insert_own" on public.category_essential_flags for insert to authenticated with check (user_id = (select auth.uid()));
create policy "essential_flags_update_own" on public.category_essential_flags for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Liquidez do investimento (quanto tempo para virar dinheiro).
alter table public.investments add column if not exists liquidity text
  check (liquidity in ('d0','d1','d30','longo','desconhecida'));

-- Tipo da dívida e período da taxa informada (taxas antigas ficam com período nulo = ambíguas, não entram no custo médio).
alter table public.debts add column if not exists kind text
  check (kind in ('cartao_rotativo','emprestimo_pessoal','financiamento','cheque_especial','informal','outro'));
alter table public.debts add column if not exists interest_rate_period text
  check (interest_rate_period in ('mes','ano'));
