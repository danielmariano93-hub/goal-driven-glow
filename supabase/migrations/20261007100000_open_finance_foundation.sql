-- Open Finance (Pluggy) — fundação. Beta fechado: só quem está em open_finance_access enxerga.
-- Nada aqui grava lançamento: a sincronização entrega itens ao estágio de importação
-- (document_imports → revisão no app → confirm_document_import), com o mesmo motor de duplicidade.

create table if not exists public.open_finance_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text
);

create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'pluggy' check (provider in ('pluggy')),
  item_id text not null check (char_length(item_id) between 8 and 80),
  label text check (label is null or char_length(label) <= 60),
  status text not null default 'active' check (status in ('active','paused','expired','error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, item_id)
);

create table if not exists public.bank_account_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.bank_connections(id) on delete cascade,
  external_account_id text not null,
  external_type text not null check (external_type in ('BANK','CREDIT','OTHER')),
  external_name text,
  account_id uuid references public.accounts(id) on delete set null,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_account_id),
  check (account_id is null or credit_card_id is null)
);

create table if not exists public.bank_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.bank_connections(id) on delete set null,
  mode text not null check (mode in ('preview','stage')),
  status text not null default 'running' check (status in ('running','ok','error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counters jsonb not null default '{}'::jsonb,
  error text,
  document_id uuid
);

create index if not exists idx_bank_sync_runs_user on public.bank_sync_runs(user_id, started_at desc);

alter table public.open_finance_access enable row level security;
alter table public.bank_connections enable row level security;
alter table public.bank_account_links enable row level security;
alter table public.bank_sync_runs enable row level security;

create policy "of_access_select_own" on public.open_finance_access for select to authenticated using (user_id = auth.uid());
create policy "bank_connections_select_own" on public.bank_connections for select to authenticated using (user_id = auth.uid());
create policy "bank_links_select_own" on public.bank_account_links for select to authenticated using (user_id = auth.uid());
create policy "bank_runs_select_own" on public.bank_sync_runs for select to authenticated using (user_id = auth.uid());

-- Escrita só por RPC (abaixo) ou serviço.
revoke all on public.open_finance_access, public.bank_connections, public.bank_account_links, public.bank_sync_runs from anon, public;
grant select on public.open_finance_access, public.bank_connections, public.bank_account_links, public.bank_sync_runs to authenticated;

-- Importação aceita a nova origem.
alter table public.document_imports drop constraint if exists document_imports_source_check;
alter table public.document_imports add constraint document_imports_source_check
  check (source = any (array['app'::text, 'whatsapp'::text, 'open_finance'::text]));

create or replace function public.open_finance_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.open_finance_access where user_id = auth.uid());
$$;

create or replace function public.bank_connection_save(p_item_id text, p_label text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_item text := btrim(coalesce(p_item_id, ''));
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.open_finance_enabled() then raise exception 'open_finance_not_enabled' using errcode = '42501'; end if;
  if v_item !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_item_id' using errcode = '22023';
  end if;
  insert into public.bank_connections(user_id, item_id, label)
  values (v_uid, lower(v_item), nullif(btrim(coalesce(p_label, '')), ''))
  on conflict (user_id, provider, item_id) do update
    set label = coalesce(excluded.label, public.bank_connections.label), status = 'active', updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.bank_connection_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  -- Desconectar = pausar (preserva o histórico de execuções; apagar a conta apaga tudo em cascata).
  update public.bank_connections set status = 'paused', last_error = null, updated_at = now()
   where id = p_id and user_id = auth.uid();
end;
$$;

create or replace function public.bank_account_link_set(
  p_connection_id uuid, p_external_account_id text, p_account_id uuid default null, p_credit_card_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_account_id is not null and p_credit_card_id is not null then raise exception 'account_xor_card' using errcode = '22023'; end if;
  if not exists (select 1 from public.bank_connections where id = p_connection_id and user_id = v_uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_account_id is not null and not exists (select 1 from public.accounts where id = p_account_id and user_id = v_uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_credit_card_id is not null and not exists (select 1 from public.credit_cards where id = p_credit_card_id and user_id = v_uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.bank_account_links
     set account_id = p_account_id, credit_card_id = p_credit_card_id, updated_at = now()
   where connection_id = p_connection_id and external_account_id = p_external_account_id and user_id = v_uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.open_finance_enabled() from public, anon;
revoke all on function public.bank_connection_save(text, text) from public, anon;
revoke all on function public.bank_connection_remove(uuid) from public, anon;
revoke all on function public.bank_account_link_set(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.open_finance_enabled() to authenticated, service_role;
grant execute on function public.bank_connection_save(text, text) to authenticated;
grant execute on function public.bank_connection_remove(uuid) to authenticated;
grant execute on function public.bank_account_link_set(uuid, text, uuid, uuid) to authenticated;
