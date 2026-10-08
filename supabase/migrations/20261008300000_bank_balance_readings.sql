-- Última leitura do saldo do banco (Open Finance) por conta do Nino, ao lado do saldo que o Nino calculou
-- naquele instante. Serve de PROVA: a Home só menciona isso, de forma discreta, quando há diferença.
create table if not exists public.bank_balance_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  bank_balance numeric not null,
  nino_balance numeric not null,
  source text not null default 'open_finance',
  read_at timestamptz not null default now(),
  unique (user_id, account_id)
);

alter table public.bank_balance_readings enable row level security;
create policy "bank_balance_readings_select_own" on public.bank_balance_readings for select to authenticated using (user_id = auth.uid());
revoke all on public.bank_balance_readings from anon, public;
grant select on public.bank_balance_readings to authenticated;
-- Escrita só pela Edge Function (service role).
