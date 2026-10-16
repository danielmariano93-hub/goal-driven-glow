-- Mapa Financeiro — fundações (fase 1). Acesso por flag, leituras persistidas e agendador de perguntas.
-- Especificação: docs/mapa-financeiro-especificacao-tecnica.md (seções 4.2 e 10).

-- Flag única do Mapa: só quem está aqui vê a nova experiência (substitui a divergência por canal do habits_v2_enabled).
create table if not exists public.mapa_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.mapa_access enable row level security;
create policy "mapa_access_select_own" on public.mapa_access for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.mapa_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from public.mapa_access where user_id = auth.uid()), false)
$$;
revoke all on function public.mapa_enabled() from public;
grant execute on function public.mapa_enabled() to authenticated;

-- Leituras por indicador (semanal e mensal). Gravadas por job com service_role; o dono só lê.
create table if not exists public.map_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  as_of date not null,
  period_kind text not null check (period_kind in ('semanal','mensal')),
  indicator_id text not null,
  value numeric,
  unit text not null,
  status text not null check (status in ('ok','atencao','critico','sem_dados')),
  confidence text not null check (confidence in ('alta','moderada','insuficiente')),
  data jsonb not null default '{}'::jsonb,
  formula_version text not null,
  contract_version text not null default 'mapa_financeiro.v1',
  created_at timestamptz not null default now(),
  unique (user_id, as_of, period_kind, indicator_id)
);
create index if not exists map_readings_user_indicator_idx on public.map_readings (user_id, indicator_id, as_of desc);
alter table public.map_readings enable row level security;
create policy "map_readings_select_own" on public.map_readings for select to authenticated using (user_id = (select auth.uid()));

-- Agendador de perguntas (orçamento de atenção). O dono lê e responde; criação por job ou pelo próprio app.
create table if not exists public.map_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('cfpb','estimativa_mensal','planejado_vs_hora','taxa_divida','essencial_categoria','liquidez_investimento')),
  due_at timestamptz not null default now(),
  asked_at timestamptz,
  answered_at timestamptz,
  skipped_at timestamptz,
  channel text check (channel in ('app','whatsapp')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists map_questions_user_due_idx on public.map_questions (user_id, due_at desc);
alter table public.map_questions enable row level security;
create policy "map_questions_select_own" on public.map_questions for select to authenticated using (user_id = (select auth.uid()));
create policy "map_questions_insert_own" on public.map_questions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "map_questions_update_own" on public.map_questions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Piloto: só a conta do dono do produto.
insert into public.mapa_access (user_id, enabled) values ('088920ce-1f5e-47d5-9e07-e2e4a63f9214', true) on conflict (user_id) do nothing;
