-- Hábitos v2: liberação controlada por usuário (mesmo padrão de open_finance_access).
create table if not exists public.habits_v2_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text
);
alter table public.habits_v2_access enable row level security;
create policy "habits_v2_access_select_own" on public.habits_v2_access for select to authenticated using (user_id = auth.uid());
revoke all on public.habits_v2_access from anon, public;
grant select on public.habits_v2_access to authenticated;

create or replace function public.habits_v2_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.habits_v2_access where user_id = auth.uid());
$$;
revoke all on function public.habits_v2_enabled() from public, anon;
grant execute on function public.habits_v2_enabled() to authenticated, service_role;
