-- Mapa Financeiro, fase 4: respostas às recomendações (supressão), cache da narrativa e acesso de escrita das leituras.

-- A pessoa responde a uma recomendação (aceitou, recusou, ajudou, não ajudou). Alimenta a supressão do E11.
create table if not exists public.map_recommendation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rec_id text not null check (char_length(rec_id) between 3 and 80),
  event text not null check (event in ('shown','accepted','dismissed','useful','not_useful')),
  created_at timestamptz not null default now()
);
create index if not exists map_recommendation_events_user_idx on public.map_recommendation_events (user_id, created_at desc);
alter table public.map_recommendation_events enable row level security;
create policy "map_rec_events_select_own" on public.map_recommendation_events for select to authenticated using (user_id = (select auth.uid()));
create policy "map_rec_events_insert_own" on public.map_recommendation_events for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.map_recommendation_events from anon, public;
grant select, insert on public.map_recommendation_events to authenticated;
grant all on public.map_recommendation_events to service_role;

-- Cache da narrativa por hash da evidência (só o servidor lê e escreve).
create table if not exists public.map_narratives (
  user_id uuid not null references auth.users(id) on delete cascade,
  evidence_hash text not null check (char_length(evidence_hash) between 6 and 64),
  prompt_version text not null,
  title text not null,
  body text not null,
  question text,
  source text not null check (source in ('llm','template')),
  created_at timestamptz not null default now(),
  primary key (user_id, evidence_hash, prompt_version)
);
alter table public.map_narratives enable row level security;
revoke all on public.map_narratives from anon, authenticated, public;
grant all on public.map_narratives to service_role;

-- Leituras: o servidor grava (service_role); o dono só lê (política já existente).
grant select on public.map_readings to authenticated;
grant all on public.map_readings to service_role;
