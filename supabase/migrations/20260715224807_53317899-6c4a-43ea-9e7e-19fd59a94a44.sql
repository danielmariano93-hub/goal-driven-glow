
-- Roles enum + user_roles
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

create policy "user_roles_select_own" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid());

-- has_role SECURITY DEFINER
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  onboarding_completed_at timestamptz,
  timezone text not null default 'America/Sao_Paulo',
  currency text not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- income frequency enum + user_financial_settings
create type public.income_frequency as enum ('mensal', 'quinzenal', 'semanal', 'variavel');

create table public.user_financial_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  approximate_monthly_income numeric(14,2),
  income_frequency public.income_frequency,
  income_day smallint check (income_day between 1 and 31),
  timezone text not null default 'America/Sao_Paulo',
  currency text not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.user_financial_settings to authenticated;
grant all on public.user_financial_settings to service_role;

alter table public.user_financial_settings enable row level security;

create policy "ufs_select_own" on public.user_financial_settings
  for select to authenticated
  using (user_id = auth.uid());

create policy "ufs_insert_own" on public.user_financial_settings
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "ufs_update_own" on public.user_financial_settings
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- updated_at trigger fn
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger ufs_set_updated_at
  before update on public.user_financial_settings
  for each row execute function public.set_updated_at();

-- Auto-create profile + default 'user' role on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
