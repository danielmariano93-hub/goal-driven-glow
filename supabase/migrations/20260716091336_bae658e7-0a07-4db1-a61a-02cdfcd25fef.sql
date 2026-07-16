create table if not exists public.platform_public_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

grant select on public.platform_public_config to authenticated;
grant all on public.platform_public_config to service_role;

alter table public.platform_public_config enable row level security;

drop policy if exists "platform_public_config_read" on public.platform_public_config;
create policy "platform_public_config_read"
  on public.platform_public_config
  for select
  to authenticated
  using (true);