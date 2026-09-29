-- nino_priority_feed.v1 — fila única de "o que importa agora" por usuário.
-- Escrita pelo pipeline proativo (service role) a cada rodada; lida pelo app
-- (RPC), pelo chat e alinhada ao que o WhatsApp envia (mesmo ranking).
create table if not exists public.nino_priority_feed (
  user_id uuid not null references auth.users(id) on delete cascade,
  rank smallint not null check (rank between 1 and 10),
  fingerprint text not null,
  kind text not null,
  severity text not null check (severity in ('info', 'attention', 'critical')),
  title text not null,
  body text not null default '',
  route text,
  impact_amount numeric not null default 0,
  priority_score numeric not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  as_of date not null,
  version text not null default 'nino_priority_feed.v1',
  computed_at timestamptz not null default now(),
  valid_until timestamptz not null,
  primary key (user_id, rank)
);

create index if not exists nino_priority_feed_valid_idx
  on public.nino_priority_feed (user_id, valid_until);

alter table public.nino_priority_feed enable row level security;

drop policy if exists nino_priority_feed_select_own on public.nino_priority_feed;
create policy nino_priority_feed_select_own on public.nino_priority_feed
  for select to authenticated using (user_id = auth.uid());

grant select on public.nino_priority_feed to authenticated;
grant all on public.nino_priority_feed to service_role;

create or replace function public.my_nino_priorities(_limit int default 3)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rank', f.rank, 'fingerprint', f.fingerprint, 'kind', f.kind, 'severity', f.severity,
    'title', f.title, 'body', f.body, 'route', f.route, 'impact_amount', f.impact_amount,
    'as_of', f.as_of, 'computed_at', f.computed_at
  ) order by f.rank), '[]'::jsonb)
  from (
    select * from public.nino_priority_feed
    where user_id = auth.uid() and valid_until > now()
    order by rank
    limit greatest(1, least(coalesce(_limit, 3), 5))
  ) f;
$$;

revoke all on function public.my_nino_priorities(int) from public;
grant execute on function public.my_nino_priorities(int) to authenticated;
