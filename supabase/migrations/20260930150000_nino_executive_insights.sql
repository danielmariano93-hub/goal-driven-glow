-- nino_executive_insights.v1: leitura executiva (cache por usuário) e feedback.
create table if not exists public.nino_executive_insights (
  user_id uuid primary key references auth.users(id) on delete cascade,
  as_of date not null,
  payload jsonb not null,
  computed_at timestamptz not null default now()
);
alter table public.nino_executive_insights enable row level security;
drop policy if exists "own executive insights" on public.nino_executive_insights;
create policy "own executive insights" on public.nino_executive_insights
  for select using (auth.uid() = user_id);

create table if not exists public.nino_executive_insight_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  insight_key text not null,
  insight_kind text not null,
  feedback text not null check (feedback in ('useful', 'not_useful', 'dismiss', 'acted')),
  created_at timestamptz not null default now()
);
create index if not exists nino_executive_insight_feedback_user_idx
  on public.nino_executive_insight_feedback (user_id, created_at desc);
alter table public.nino_executive_insight_feedback enable row level security;
drop policy if exists "own executive feedback" on public.nino_executive_insight_feedback;
create policy "own executive feedback" on public.nino_executive_insight_feedback
  for select using (auth.uid() = user_id);
