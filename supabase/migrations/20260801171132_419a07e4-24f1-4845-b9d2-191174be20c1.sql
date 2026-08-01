-- E7 — contrato de erro: incidentes persistidos para rastreabilidade (request_id).
create table if not exists public.edge_incidents (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  function_name text not null,
  error_code text not null,
  http_status integer not null,
  retryable boolean not null default false,
  user_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_edge_incidents_created on public.edge_incidents (created_at desc);
create index if not exists idx_edge_incidents_request on public.edge_incidents (request_id);
create index if not exists idx_edge_incidents_fn_code on public.edge_incidents (function_name, error_code);

grant all on public.edge_incidents to service_role;

alter table public.edge_incidents enable row level security;

drop policy if exists "platform admins read edge incidents" on public.edge_incidents;
create policy "platform admins read edge incidents"
on public.edge_incidents
for select
to authenticated
using (public.is_platform_admin());