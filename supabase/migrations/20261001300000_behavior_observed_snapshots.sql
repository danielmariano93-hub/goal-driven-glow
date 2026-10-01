-- Histórico semanal da leitura "Nino observa". Antes a nota era calculada na
-- hora e nunca guardada, então a tela não conseguia mostrar evolução.
create table if not exists public.behavior_observed_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  overall_score numeric(4,1),
  coverage smallint not null default 0,
  confidence text not null default 'low' check (confidence in ('low','medium','high')),
  methodology_version text not null default 'behavior_observed.v2',
  dimensions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);
create index if not exists behavior_observed_snapshots_user_week_idx on public.behavior_observed_snapshots (user_id, week_start desc);
alter table public.behavior_observed_snapshots enable row level security;
create policy "snapshots_select_own" on public.behavior_observed_snapshots for select to authenticated using (user_id = (select auth.uid()));
create policy "snapshots_insert_own" on public.behavior_observed_snapshots for insert to authenticated with check (user_id = (select auth.uid()));
create policy "snapshots_update_own" on public.behavior_observed_snapshots for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
