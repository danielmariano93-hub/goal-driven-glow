-- Questionário de bem-estar financeiro (escala CFPB, 10 itens), respondido a cada 15 dias no app.
create table if not exists public.financial_wellbeing_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  answered_at timestamptz not null default now(),
  scale_version text not null default 'cfpb_fwb10.v1',
  age_band text not null default '18-61' check (age_band in ('18-61','62+')),
  -- índice da opção marcada (0-4) em cada item, na ordem dos 10 itens
  options smallint[] not null check (array_length(options,1) = 10),
  total smallint not null check (total between 0 and 40),
  score smallint not null check (score between 0 and 100)
);
create index if not exists financial_wellbeing_responses_user_idx on public.financial_wellbeing_responses (user_id, answered_at desc);
alter table public.financial_wellbeing_responses enable row level security;
create policy "fwb_owner_select" on public.financial_wellbeing_responses for select using (user_id = auth.uid());
create policy "fwb_owner_insert" on public.financial_wellbeing_responses for insert with check (user_id = auth.uid());
