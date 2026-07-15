
-- ============ enums ============
create type public.account_type as enum ('checking','savings','cash','investment','other');
create type public.category_type as enum ('income','expense');
create type public.transaction_type as enum ('income','expense','transfer');
create type public.transaction_status as enum ('confirmed','planned');
create type public.goal_status as enum ('active','paused','completed');
create type public.debt_status as enum ('active','settled','defaulted');
create type public.recurring_frequency as enum ('daily','weekly','monthly','yearly');
create type public.user_challenge_status as enum ('joined','completed','abandoned');
create type public.import_batch_status as enum ('pending','completed','failed');

-- shared updated_at trigger fn already exists as public.set_updated_at

-- ============ accounts ============
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type public.account_type not null default 'checking',
  institution text,
  opening_balance numeric(14,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.accounts to authenticated;
grant all on public.accounts to service_role;
alter table public.accounts enable row level security;
create policy "accounts_all_own" on public.accounts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index accounts_user_idx on public.accounts(user_id) where active;
create trigger accounts_updated before update on public.accounts for each row execute function public.set_updated_at();

-- ============ categories ============
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  type public.category_type not null,
  color text,
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_slug_scope unique (user_id, slug)
);
create unique index categories_global_slug on public.categories (slug) where user_id is null;
grant select, insert, update, delete on public.categories to authenticated;
grant all on public.categories to service_role;
alter table public.categories enable row level security;
create policy "categories_select_own_or_global" on public.categories for select to authenticated using (user_id = auth.uid() or user_id is null);
create policy "categories_insert_own" on public.categories for insert to authenticated with check (user_id = auth.uid());
create policy "categories_update_own" on public.categories for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "categories_delete_own" on public.categories for delete to authenticated using (user_id = auth.uid());
create trigger categories_updated before update on public.categories for each row execute function public.set_updated_at();

-- ============ transactions ============
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  category_id uuid references public.categories(id) on delete set null,
  type public.transaction_type not null,
  status public.transaction_status not null default 'confirmed',
  amount numeric(14,2) not null check (amount > 0),
  occurred_at date not null,
  description text,
  notes text,
  emotional_trigger text,
  transfer_group_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.transactions to authenticated;
grant all on public.transactions to service_role;
alter table public.transactions enable row level security;
create policy "transactions_all_own" on public.transactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index transactions_user_date_idx on public.transactions(user_id, occurred_at desc);
create index transactions_account_idx on public.transactions(account_id);
create index transactions_transfer_group_idx on public.transactions(transfer_group_id) where transfer_group_id is not null;
create trigger transactions_updated before update on public.transactions for each row execute function public.set_updated_at();

-- transaction validation trigger
create or replace function public.validate_transaction()
returns trigger language plpgsql set search_path = public as $$
declare
  acc_user uuid;
  cat_user uuid;
begin
  select user_id into acc_user from public.accounts where id = new.account_id;
  if acc_user is null or acc_user <> new.user_id then
    raise exception 'account does not belong to user';
  end if;
  if new.category_id is not null then
    select user_id into cat_user from public.categories where id = new.category_id;
    if cat_user is not null and cat_user <> new.user_id then
      raise exception 'category does not belong to user';
    end if;
  end if;
  if new.type = 'transfer' then
    if new.category_id is not null then
      raise exception 'transfer must not have a category';
    end if;
    if new.transfer_group_id is null then
      raise exception 'transfer must have a transfer_group_id';
    end if;
  end if;
  return new;
end $$;
create trigger transactions_validate before insert or update on public.transactions for each row execute function public.validate_transaction();

-- ============ goals ============
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null check (target_amount > 0),
  target_date date,
  priority smallint not null default 3 check (priority between 1 and 5),
  status public.goal_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.goals to authenticated;
grant all on public.goals to service_role;
alter table public.goals enable row level security;
create policy "goals_all_own" on public.goals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index goals_user_idx on public.goals(user_id);
create trigger goals_updated before update on public.goals for each row execute function public.set_updated_at();

-- ============ goal_contributions ============
create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  occurred_at date not null,
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.goal_contributions to authenticated;
grant all on public.goal_contributions to service_role;
alter table public.goal_contributions enable row level security;
create policy "gc_all_own" on public.goal_contributions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index gc_goal_idx on public.goal_contributions(goal_id);

-- ============ investments ============
create table public.investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null,
  institution text,
  invested_amount numeric(14,2) not null default 0 check (invested_amount >= 0),
  current_value numeric(14,2) not null default 0 check (current_value >= 0),
  reference_date date not null default (now() at time zone 'America/Sao_Paulo')::date,
  goal_id uuid references public.goals(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.investments to authenticated;
grant all on public.investments to service_role;
alter table public.investments enable row level security;
create policy "investments_all_own" on public.investments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index investments_user_idx on public.investments(user_id);
create trigger investments_updated before update on public.investments for each row execute function public.set_updated_at();

-- ============ debts ============
create table public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  creditor text,
  original_amount numeric(14,2) not null check (original_amount > 0),
  outstanding_balance numeric(14,2) not null check (outstanding_balance >= 0),
  installment_amount numeric(14,2) check (installment_amount is null or installment_amount >= 0),
  due_day smallint check (due_day is null or (due_day between 1 and 31)),
  interest_rate_pct numeric(8,4),
  status public.debt_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint debts_outstanding_leq_original check (outstanding_balance <= original_amount)
);
grant select, insert, update, delete on public.debts to authenticated;
grant all on public.debts to service_role;
alter table public.debts enable row level security;
create policy "debts_all_own" on public.debts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index debts_user_idx on public.debts(user_id);
create trigger debts_updated before update on public.debts for each row execute function public.set_updated_at();

-- ============ recurring_entries ============
create table public.recurring_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type public.category_type not null,
  amount numeric(14,2) not null check (amount > 0),
  frequency public.recurring_frequency not null default 'monthly',
  next_due_date date not null,
  account_id uuid references public.accounts(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.recurring_entries to authenticated;
grant all on public.recurring_entries to service_role;
alter table public.recurring_entries enable row level security;
create policy "recurring_all_own" on public.recurring_entries for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index recurring_user_next_idx on public.recurring_entries(user_id, next_due_date);
create trigger recurring_updated before update on public.recurring_entries for each row execute function public.set_updated_at();

-- ============ emotional_checkins ============
create table public.emotional_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  mood smallint not null check (mood between 1 and 5),
  trigger_label text,
  notes text,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.emotional_checkins to authenticated;
grant all on public.emotional_checkins to service_role;
alter table public.emotional_checkins enable row level security;
create policy "emo_all_own" on public.emotional_checkins for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index emo_user_date_idx on public.emotional_checkins(user_id, occurred_at desc);

-- ============ challenges (global) ============
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  duration_days integer not null default 30,
  created_at timestamptz not null default now()
);
grant select on public.challenges to authenticated;
grant all on public.challenges to service_role;
alter table public.challenges enable row level security;
create policy "challenges_select_all" on public.challenges for select to authenticated using (true);

-- ============ user_challenges ============
create table public.user_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  status public.user_challenge_status not null default 'joined',
  progress smallint not null default 0 check (progress between 0 and 100),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, challenge_id)
);
grant select, insert, update, delete on public.user_challenges to authenticated;
grant all on public.user_challenges to service_role;
alter table public.user_challenges enable row level security;
create policy "uc_all_own" on public.user_challenges for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ import_batches / import_rows ============
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  status public.import_batch_status not null default 'pending',
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  failed_rows integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
grant select, insert, update on public.import_batches to authenticated;
grant all on public.import_batches to service_role;
alter table public.import_batches enable row level security;
create policy "ib_all_own" on public.import_batches for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  row_index integer not null,
  payload jsonb not null,
  error text,
  imported boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.import_rows to authenticated;
grant all on public.import_rows to service_role;
alter table public.import_rows enable row level security;
create policy "ir_all_own" on public.import_rows for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============ RPCs ============

-- ensure_profile: recreate profile if missing
create or replace function public.ensure_profile()
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (uid, 'user') on conflict (user_id, role) do nothing;
end $$;
revoke execute on function public.ensure_profile() from public, anon;
grant execute on function public.ensure_profile() to authenticated;

-- complete_onboarding: atomic profile + settings
create or replace function public.complete_onboarding(
  p_display_name text,
  p_income numeric,
  p_frequency public.income_frequency,
  p_income_day smallint
) returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_display_name is null or length(btrim(p_display_name)) = 0 or length(p_display_name) > 80 then
    raise exception 'invalid display_name';
  end if;
  if p_income is not null and p_income < 0 then raise exception 'invalid income'; end if;
  if p_income_day is not null and (p_income_day < 1 or p_income_day > 31) then raise exception 'invalid income_day'; end if;

  update public.profiles
    set display_name = btrim(p_display_name),
        onboarding_completed_at = now(),
        timezone = 'America/Sao_Paulo',
        currency = 'BRL'
    where id = uid;

  insert into public.user_financial_settings (user_id, approximate_monthly_income, income_frequency, income_day, timezone, currency)
    values (uid, p_income, coalesce(p_frequency,'mensal'), p_income_day, 'America/Sao_Paulo', 'BRL')
    on conflict (user_id) do update set
      approximate_monthly_income = excluded.approximate_monthly_income,
      income_frequency = excluded.income_frequency,
      income_day = excluded.income_day,
      updated_at = now();
end $$;
revoke execute on function public.complete_onboarding(text, numeric, public.income_frequency, smallint) from public, anon;
grant execute on function public.complete_onboarding(text, numeric, public.income_frequency, smallint) to authenticated;

-- create_transfer: atomic two legs
create or replace function public.create_transfer(
  p_from_account uuid,
  p_to_account uuid,
  p_amount numeric,
  p_occurred_at date,
  p_description text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  tg uuid := gen_random_uuid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_from_account = p_to_account then raise exception 'accounts must differ'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;
  if not exists (select 1 from public.accounts where id = p_from_account and user_id = uid) then
    raise exception 'invalid source account';
  end if;
  if not exists (select 1 from public.accounts where id = p_to_account and user_id = uid) then
    raise exception 'invalid destination account';
  end if;

  insert into public.transactions (user_id, account_id, type, status, amount, occurred_at, description, transfer_group_id)
    values (uid, p_from_account, 'transfer', 'confirmed', p_amount, coalesce(p_occurred_at, current_date), p_description, tg);
  insert into public.transactions (user_id, account_id, type, status, amount, occurred_at, description, transfer_group_id)
    values (uid, p_to_account, 'transfer', 'confirmed', p_amount, coalesce(p_occurred_at, current_date), p_description, tg);
  return tg;
end $$;
revoke execute on function public.create_transfer(uuid, uuid, numeric, date, text) from public, anon;
grant execute on function public.create_transfer(uuid, uuid, numeric, date, text) to authenticated;

-- is_current_user_admin
create or replace function public.is_current_user_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;
revoke execute on function public.is_current_user_admin() from public, anon;
grant execute on function public.is_current_user_admin() to authenticated;

-- admin_dashboard_stats
create or replace function public.admin_dashboard_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'new_users_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'new_users_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'onboarded_users', (select count(*) from public.profiles where onboarding_completed_at is not null),
    'total_transactions', (select count(*) from public.transactions),
    'total_accounts', (select count(*) from public.accounts),
    'total_goals', (select count(*) from public.goals),
    'total_investments', (select count(*) from public.investments),
    'total_debts', (select count(*) from public.debts)
  ) into result;
  return result;
end $$;
revoke execute on function public.admin_dashboard_stats() from public, anon;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- ============ seed global categories ============
insert into public.categories (user_id, slug, name, type, color, icon) values
  (null,'salario','Salário','income','#16A37A','wallet'),
  (null,'renda-extra','Renda Extra','income','#22C55E','plus-circle'),
  (null,'investimentos-rendimento','Rendimento de Investimentos','income','#0EA5E9','trending-up'),
  (null,'presente','Presente Recebido','income','#EAB308','gift'),
  (null,'alimentacao','Alimentação','expense','#F97316','utensils'),
  (null,'mercado','Mercado','expense','#F59E0B','shopping-cart'),
  (null,'moradia','Moradia','expense','#8B5CF6','home'),
  (null,'transporte','Transporte','expense','#3B82F6','car'),
  (null,'saude','Saúde','expense','#EF4444','heart'),
  (null,'lazer','Lazer','expense','#EC4899','film'),
  (null,'educacao','Educação','expense','#14B8A6','book-open'),
  (null,'assinaturas','Assinaturas','expense','#6366F1','repeat'),
  (null,'vestuario','Vestuário','expense','#DB2777','shirt'),
  (null,'pets','Pets','expense','#A855F7','paw-print'),
  (null,'impostos','Impostos e Taxas','expense','#64748B','landmark'),
  (null,'servicos','Serviços','expense','#0891B2','wrench'),
  (null,'presentes','Presentes','expense','#DC4C64','gift'),
  (null,'outros','Outros','expense','#6F687D','more-horizontal')
on conflict do nothing;

-- ============ seed challenges ============
insert into public.challenges (slug, title, description, duration_days) values
  ('semana-sem-delivery','Semana sem delivery','Cozinhe em casa por 7 dias e reduza gastos com aplicativos.',7),
  ('30-dias-registrando','30 dias registrando tudo','Registre todas as suas receitas e despesas por 30 dias.',30),
  ('poupanca-1por-dia','1% por dia na meta','Aporte pelo menos 1% da sua meta diariamente por 30 dias.',30)
on conflict (slug) do nothing;
