create table if not exists public.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.agent_runs(id) on delete cascade,
  user_id uuid not null,
  conversation_id uuid,
  channel text,
  intent text,
  policy_decision text,
  planned_steps jsonb not null default '[]'::jsonb,
  tool_calls jsonb not null default '[]'::jsonb,
  validations jsonb not null default '[]'::jsonb,
  fallback_used boolean not null default false,
  error text,
  duration_ms integer,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

grant select on public.agent_decisions to authenticated;
grant all on public.agent_decisions to service_role;

alter table public.agent_decisions enable row level security;

create policy "users read own decisions"
on public.agent_decisions
for select
to authenticated
using (auth.uid() = user_id);

create index if not exists idx_agent_decisions_run     on public.agent_decisions(run_id);
create index if not exists idx_agent_decisions_user_at on public.agent_decisions(user_id, created_at desc);
create index if not exists idx_agent_decisions_channel on public.agent_decisions(channel, created_at desc);