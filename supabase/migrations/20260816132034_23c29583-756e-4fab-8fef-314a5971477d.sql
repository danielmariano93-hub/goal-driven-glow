create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Billing plans catalog
create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text not null default 'BRL',
  billing_interval text not null default 'free' check (billing_interval in ('free','month','year')),
  trial_days integer not null default 0 check (trial_days >= 0),
  highlights text[] not null default '{}',
  features jsonb not null default '{}'::jsonb,
  apple_product_id text,
  google_product_id text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.billing_plans to anon;
grant select on public.billing_plans to authenticated;
grant all on public.billing_plans to service_role;

alter table public.billing_plans enable row level security;

drop policy if exists "billing_plans_public_read" on public.billing_plans;
create policy "billing_plans_public_read" on public.billing_plans
  for select to anon, authenticated using (is_active = true);

drop policy if exists "billing_plans_admin_manage" on public.billing_plans;
create policy "billing_plans_admin_manage" on public.billing_plans
  for all to authenticated using (public.is_current_user_admin()) with check (public.is_current_user_admin());

-- Subscriptions per user
create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  status text not null default 'active' check (status in ('active','trialing','past_due','canceled','expired')),
  source text not null default 'manual' check (source in ('free','app_store','play_store','web','manual')),
  store_transaction_id text,
  original_transaction_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  last_verified_at timestamptz,
  raw_receipt jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_subscriptions_original_tx_idx
  on public.user_subscriptions (source, original_transaction_id)
  where original_transaction_id is not null;
create index if not exists user_subscriptions_user_idx on public.user_subscriptions (user_id, status);

grant select on public.user_subscriptions to authenticated;
grant all on public.user_subscriptions to service_role;

alter table public.user_subscriptions enable row level security;

drop policy if exists "user_subscriptions_own_read" on public.user_subscriptions;
create policy "user_subscriptions_own_read" on public.user_subscriptions
  for select to authenticated using (user_id = auth.uid() or public.is_current_user_admin());

drop policy if exists "user_subscriptions_admin_manage" on public.user_subscriptions;
create policy "user_subscriptions_admin_manage" on public.user_subscriptions
  for all to authenticated using (public.is_current_user_admin()) with check (public.is_current_user_admin());

drop trigger if exists billing_plans_touch on public.billing_plans;
create trigger billing_plans_touch before update on public.billing_plans
  for each row execute function public.set_updated_at();

drop trigger if exists user_subscriptions_touch on public.user_subscriptions;
create trigger user_subscriptions_touch before update on public.user_subscriptions
  for each row execute function public.set_updated_at();

-- Effective plan for the current user
create or replace function public.get_my_plan()
returns table (
  plan_code text,
  plan_name text,
  status text,
  source text,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  features jsonb,
  is_paid boolean
)
language sql stable security definer set search_path = public as $$
  with active as (
    select s.status as s_status, s.source as s_source, s.current_period_end, s.trial_ends_at,
           p.code, p.name, p.features, p.price_cents
    from public.user_subscriptions s
    join public.billing_plans p on p.id = s.plan_id
    where s.user_id = auth.uid()
      and s.status in ('active','trialing')
      and (s.current_period_end is null or s.current_period_end > now())
    order by p.price_cents desc, s.created_at desc
    limit 1
  ),
  fallback as (
    select p.code, p.name, p.features
    from public.billing_plans p
    where p.code = 'free'
    limit 1
  )
  select
    coalesce(a.code, f.code, 'free')::text,
    coalesce(a.name, f.name, 'Gratuito')::text,
    coalesce(a.s_status, 'none')::text,
    coalesce(a.s_source, 'free')::text,
    a.current_period_end,
    a.trial_ends_at,
    coalesce(a.features, f.features, '{}'::jsonb),
    coalesce(a.price_cents, 0) > 0
  from fallback f
  full outer join active a on true;
$$;

revoke execute on function public.get_my_plan() from public, anon;
grant execute on function public.get_my_plan() to authenticated;

-- Seed catalog (free stays default; paid plan disabled until billing goes live)
insert into public.billing_plans (code, name, description, price_cents, billing_interval, trial_days, highlights, features, is_active, sort_order)
values
  ('free', 'Gratuito', 'Organize seus lançamentos, contas e metas com o Nino no app.', 0, 'free', 0,
   array['Lançamentos, contas e cartões','Metas e dívidas','Conversas com o Nino no app'],
   '{"nino_whatsapp": true, "nino_audio": true, "nino_documents": true}'::jsonb, true, 0),
  ('premium_mensal', 'Nino Premium', 'O Nino completo: WhatsApp, áudio, leitura de documentos e relatórios inteligentes.', 2990, 'month', 7,
   array['Tudo do Gratuito','Nino no WhatsApp com áudio e prints','Relatórios inteligentes e previsões','Divisão do rolê e metas conjuntas'],
   '{"nino_whatsapp": true, "nino_audio": true, "nino_documents": true, "relatorios_inteligentes": true, "investimentos": true, "divisao_do_role": true, "metas_conjuntas": true}'::jsonb, false, 1)
on conflict (code) do nothing;