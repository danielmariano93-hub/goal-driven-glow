-- "Agora não" nas sugestões de contas que se repetem: lembra a dispensa por usuário.
create table if not exists public.recurring_suggestion_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.recurring_suggestion_dismissals enable row level security;
create policy "dismissals_select_own" on public.recurring_suggestion_dismissals for select to authenticated using (user_id = auth.uid());
create policy "dismissals_insert_own" on public.recurring_suggestion_dismissals for insert to authenticated with check (user_id = auth.uid());
grant select, insert on public.recurring_suggestion_dismissals to authenticated;
