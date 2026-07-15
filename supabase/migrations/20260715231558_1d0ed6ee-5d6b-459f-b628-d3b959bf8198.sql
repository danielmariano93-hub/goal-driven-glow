
-- ============================================================
-- Fase 3 — Mensageria + Agente (NoControle.ia)
-- ============================================================

-- 1) Enums
do $$ begin
  create type public.messaging_provider as enum ('waha','meta_cloud');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.msg_direction as enum ('inbound','outbound');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.msg_status as enum ('queued','sent','delivered','read','failed','dead');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.link_status as enum ('pending','active','revoked');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.run_status as enum ('running','done','error','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.confirmation_status as enum ('pending','confirmed','cancelled','expired');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.prompt_status as enum ('draft','active','archived');
exception when duplicate_object then null; end $$;

-- 2) has_role overload (sem _user_id)
create or replace function public.has_role(_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid() and role = _role)
$$;
revoke all on function public.has_role(public.app_role) from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated;

-- 3) whatsapp_links
create table if not exists public.whatsapp_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text not null,
  phone_hash text not null,
  phone_masked text not null,
  status public.link_status not null default 'active',
  consent_at timestamptz not null default now(),
  last_verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists wl_active_user_uniq
  on public.whatsapp_links(user_id) where status = 'active';
create unique index if not exists wl_active_phone_uniq
  on public.whatsapp_links(phone_e164) where status = 'active';
create index if not exists wl_phone_hash_idx on public.whatsapp_links(phone_hash);
grant select on public.whatsapp_links to authenticated;
grant all on public.whatsapp_links to service_role;
alter table public.whatsapp_links enable row level security;
create policy wl_select_own on public.whatsapp_links for select
  to authenticated using (user_id = auth.uid() or public.is_current_user_admin());
create trigger wl_updated before update on public.whatsapp_links
  for each row execute function public.set_updated_at();

-- 4) phone_link_codes
create table if not exists public.phone_link_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  attempts smallint not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  cooldown_until timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists plc_user_idx on public.phone_link_codes(user_id, created_at desc);
grant all on public.phone_link_codes to service_role;
alter table public.phone_link_codes enable row level security;
-- Sem policies para authenticated: acesso apenas via RPCs.

-- 5) inbound / outbound / delivery / idempotency
create table if not exists public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  provider public.messaging_provider not null,
  provider_message_id text not null,
  from_phone text not null,
  to_phone text,
  body text,
  received_at timestamptz not null default now(),
  raw_hash text,
  processed_at timestamptz,
  ignored_reason text
);
create unique index if not exists im_provider_msg_uniq
  on public.inbound_messages(provider, provider_message_id);
create index if not exists im_from_idx on public.inbound_messages(from_phone, received_at desc);
grant all on public.inbound_messages to service_role;
alter table public.inbound_messages enable row level security;

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  to_phone text not null,
  body text not null,
  provider public.messaging_provider not null default 'waha',
  provider_message_id text,
  status public.msg_status not null default 'queued',
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  kind text not null default 'agent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists om_status_idx on public.outbound_messages(status, next_attempt_at);
grant all on public.outbound_messages to service_role;
alter table public.outbound_messages enable row level security;
create trigger om_updated before update on public.outbound_messages
  for each row execute function public.set_updated_at();

create table if not exists public.message_delivery_events (
  id uuid primary key default gen_random_uuid(),
  outbound_id uuid references public.outbound_messages(id) on delete cascade,
  provider_message_id text,
  status public.msg_status not null,
  occurred_at timestamptz not null default now(),
  payload_hash text
);
create index if not exists mde_out_idx on public.message_delivery_events(outbound_id);
grant all on public.message_delivery_events to service_role;
alter table public.message_delivery_events enable row level security;

create table if not exists public.idempotency_keys (
  scope text not null,
  key text not null,
  user_id uuid,
  first_seen_at timestamptz not null default now(),
  result_ref uuid,
  primary key (scope, key)
);
grant all on public.idempotency_keys to service_role;
alter table public.idempotency_keys enable row level security;

-- 6) conversations + messages
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text not null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists conv_user_idx on public.conversations(user_id, last_message_at desc);
grant select on public.conversations to authenticated;
grant all on public.conversations to service_role;
alter table public.conversations enable row level security;
create policy conv_select_own on public.conversations for select
  to authenticated using (user_id = auth.uid());

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null,
  direction public.msg_direction not null,
  body_masked text not null,
  created_at timestamptz not null default now()
);
create index if not exists cm_conv_idx on public.conversation_messages(conversation_id, created_at desc);
grant select on public.conversation_messages to authenticated;
grant all on public.conversation_messages to service_role;
alter table public.conversation_messages enable row level security;
create policy cm_select_own on public.conversation_messages for select
  to authenticated using (user_id = auth.uid());

-- 7) agente
create table if not exists public.agent_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  status public.prompt_status not null default 'draft',
  system_prompt text not null,
  model text not null default 'google/gemini-2.5-flash',
  temperature numeric(3,2) not null default 0.2,
  max_steps smallint not null default 8,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists apv_version_uniq on public.agent_prompt_versions(version);
create unique index if not exists apv_active_uniq on public.agent_prompt_versions(status) where status = 'active';
grant select on public.agent_prompt_versions to authenticated;
grant all on public.agent_prompt_versions to service_role;
alter table public.agent_prompt_versions enable row level security;
create policy apv_admin_select on public.agent_prompt_versions for select
  to authenticated using (public.is_current_user_admin());

create table if not exists public.agent_settings (
  id smallint primary key default 1,
  model text not null default 'google/gemini-2.5-flash',
  temperature numeric(3,2) not null default 0.2,
  max_steps smallint not null default 8,
  timeout_ms int not null default 30000,
  proactive_enabled boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint agent_settings_singleton check (id = 1)
);
insert into public.agent_settings(id) values (1) on conflict do nothing;
grant select on public.agent_settings to authenticated;
grant all on public.agent_settings to service_role;
alter table public.agent_settings enable row level security;
create policy as_admin_select on public.agent_settings for select
  to authenticated using (public.is_current_user_admin());

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  prompt_version_id uuid references public.agent_prompt_versions(id),
  model text,
  status public.run_status not null default 'running',
  steps smallint not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_cents int not null default 0,
  error_masked text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists ar_user_idx on public.agent_runs(user_id, started_at desc);
grant select on public.agent_runs to authenticated;
grant all on public.agent_runs to service_role;
alter table public.agent_runs enable row level security;
create policy ar_select_own on public.agent_runs for select
  to authenticated using (user_id = auth.uid() or public.is_current_user_admin());

create table if not exists public.agent_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  idx smallint not null,
  kind text not null,
  name text,
  args_hash text,
  result_hash text,
  tokens int,
  created_at timestamptz not null default now()
);
grant all on public.agent_steps to service_role;
alter table public.agent_steps enable row level security;

create table if not exists public.pending_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  kind text not null,
  payload jsonb not null,
  summary_text text not null,
  status public.confirmation_status not null default 'pending',
  expires_at timestamptz not null,
  executed_at timestamptz,
  result_ref uuid,
  created_at timestamptz not null default now()
);
create index if not exists pc_user_idx on public.pending_confirmations(user_id, created_at desc);
create index if not exists pc_pending_idx on public.pending_confirmations(user_id, status) where status = 'pending';
grant select on public.pending_confirmations to authenticated;
grant all on public.pending_confirmations to service_role;
alter table public.pending_confirmations enable row level security;
create policy pc_select_own on public.pending_confirmations for select
  to authenticated using (user_id = auth.uid());

create table if not exists public.provider_health_events (
  id uuid primary key default gen_random_uuid(),
  provider public.messaging_provider not null,
  ok boolean not null,
  latency_ms int,
  error_masked text,
  occurred_at timestamptz not null default now()
);
create index if not exists phe_recent_idx on public.provider_health_events(provider, occurred_at desc);
grant select on public.provider_health_events to authenticated;
grant all on public.provider_health_events to service_role;
alter table public.provider_health_events enable row level security;
create policy phe_admin_select on public.provider_health_events for select
  to authenticated using (public.is_current_user_admin());

-- 8) import_batches / import_rows: adicionar colunas necessárias se ainda não existem
alter table public.import_batches
  add column if not exists source text,
  add column if not exists imported_count int not null default 0,
  add column if not exists skipped_count int not null default 0,
  add column if not exists status text not null default 'completed';
alter table public.import_rows
  add column if not exists external_id text,
  add column if not exists entity text,
  add column if not exists action text,
  add column if not exists notes text;

-- 9) RPCs
create or replace function public.create_phone_link_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  raw text;
  h text;
  recent int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select count(*) into recent from public.phone_link_codes
    where user_id = uid and created_at > now() - interval '30 minutes';
  if recent >= 5 then
    raise exception 'too many attempts, try again later';
  end if;
  raw := lpad((floor(random() * 1000000))::int::text, 6, '0');
  h := encode(digest(raw || uid::text, 'sha256'), 'hex');
  insert into public.phone_link_codes(user_id, code_hash, expires_at)
    values (uid, h, now() + interval '10 minutes');
  return raw;
end $$;
revoke all on function public.create_phone_link_code() from public, anon;
grant execute on function public.create_phone_link_code() to authenticated;

create or replace function public.revoke_whatsapp_link()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update public.whatsapp_links
    set status = 'revoked', revoked_at = now()
    where user_id = uid and status = 'active';
end $$;
revoke all on function public.revoke_whatsapp_link() from public, anon;
grant execute on function public.revoke_whatsapp_link() to authenticated;

create or replace function public.list_my_whatsapp_link()
returns table(id uuid, status public.link_status, phone_masked text, consent_at timestamptz, last_verified_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select id, status, phone_masked, consent_at, last_verified_at
    from public.whatsapp_links
    where user_id = auth.uid()
    order by created_at desc
    limit 1
$$;
revoke all on function public.list_my_whatsapp_link() from public, anon;
grant execute on function public.list_my_whatsapp_link() to authenticated;

create or replace function public.cancel_pending_action(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pending_confirmations
    set status = 'cancelled'
    where id = p_id and user_id = auth.uid() and status = 'pending';
end $$;
revoke all on function public.cancel_pending_action(uuid) from public, anon;
grant execute on function public.cancel_pending_action(uuid) to authenticated;

create or replace function public.set_active_prompt_version(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  update public.agent_prompt_versions set status = 'archived' where status = 'active';
  update public.agent_prompt_versions set status = 'active' where id = p_id;
end $$;
revoke all on function public.set_active_prompt_version(uuid) from public, anon;
grant execute on function public.set_active_prompt_version(uuid) to authenticated;

create or replace function public.update_agent_settings(
  p_model text, p_temperature numeric, p_max_steps smallint, p_timeout_ms int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  if p_temperature < 0 or p_temperature > 1 then raise exception 'invalid temperature'; end if;
  if p_max_steps < 1 or p_max_steps > 20 then raise exception 'invalid max_steps'; end if;
  if p_timeout_ms < 1000 or p_timeout_ms > 120000 then raise exception 'invalid timeout'; end if;
  update public.agent_settings
    set model = p_model, temperature = p_temperature,
        max_steps = p_max_steps, timeout_ms = p_timeout_ms,
        updated_by = auth.uid(), updated_at = now()
    where id = 1;
end $$;
revoke all on function public.update_agent_settings(text, numeric, smallint, int) from public, anon;
grant execute on function public.update_agent_settings(text, numeric, smallint, int) to authenticated;

-- 10) Import legado — idempotente por external_id, aceita apenas entidades suportadas.
create or replace function public.import_legacy_batch(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  batch_id uuid;
  imported int := 0;
  skipped int := 0;
  it jsonb;
  new_acc uuid;
  new_cat uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  insert into public.import_batches(user_id, source, status)
    values (uid, 'financial_ecosystem_v2', 'running')
    returning id into batch_id;

  -- Contas
  for it in select * from jsonb_array_elements(coalesce(p_payload->'accounts','[]'::jsonb)) loop
    if exists(
      select 1 from public.import_rows
        where user_id = uid and entity = 'account'
          and external_id = coalesce(it->>'id', md5(it::text))
    ) then
      skipped := skipped + 1; continue;
    end if;
    insert into public.accounts(user_id, name, type, institution, opening_balance)
      values (
        uid,
        coalesce(it->>'name','Conta importada'),
        coalesce((it->>'type')::public.account_type,'checking'),
        it->>'institution',
        coalesce((it->>'opening_balance')::numeric, (it->>'balance')::numeric, 0)
      )
      returning id into new_acc;
    insert into public.import_rows(batch_id, user_id, entity, action, external_id, notes)
      values (batch_id, uid, 'account', 'inserted', coalesce(it->>'id', md5(it::text)), null);
    imported := imported + 1;
  end loop;

  -- Categorias pessoais
  for it in select * from jsonb_array_elements(coalesce(p_payload->'categories','[]'::jsonb)) loop
    if exists(
      select 1 from public.import_rows
        where user_id = uid and entity = 'category'
          and external_id = coalesce(it->>'id', md5(it::text))
    ) then
      skipped := skipped + 1; continue;
    end if;
    insert into public.categories(user_id, slug, name, type, color, icon)
      values (
        uid,
        coalesce(it->>'slug', 'cat_' || substr(md5(coalesce(it->>'name','')), 1, 8)),
        coalesce(it->>'name','Categoria'),
        coalesce((it->>'type')::public.category_type,'expense'),
        it->>'color',
        it->>'icon'
      )
      on conflict (user_id, slug) do nothing
      returning id into new_cat;
    insert into public.import_rows(batch_id, user_id, entity, action, external_id)
      values (batch_id, uid, 'category', 'inserted', coalesce(it->>'id', md5(it::text)));
    imported := imported + 1;
  end loop;

  update public.import_batches
    set status = 'completed', imported_count = imported, skipped_count = skipped
    where id = batch_id;

  return jsonb_build_object('batch_id', batch_id, 'imported', imported, 'skipped', skipped);
end $$;
revoke all on function public.import_legacy_batch(jsonb) from public, anon;
grant execute on function public.import_legacy_batch(jsonb) to authenticated;
