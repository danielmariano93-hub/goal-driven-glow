-- nino_priority_learning.v1 — o que a pessoa faz com cada destaque vira sinal
-- de aprendizado do ranking (antes, cliques da Home só iam para o analytics
-- do navegador e o ranking nunca aprendia com eles).
create table if not exists public.nino_priority_events (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null,
  kind text not null,
  event text not null check (event in ('impression', 'acted', 'next_requested', 'dismissed')),
  surface text not null default 'home' check (surface in ('home', 'nino', 'chat', 'whatsapp')),
  created_at timestamptz not null default now()
);

create index if not exists nino_priority_events_user_idx
  on public.nino_priority_events (user_id, created_at desc);

alter table public.nino_priority_events enable row level security;

drop policy if exists nino_priority_events_select_own on public.nino_priority_events;
create policy nino_priority_events_select_own on public.nino_priority_events
  for select to authenticated using (user_id = auth.uid());

grant select on public.nino_priority_events to authenticated;
grant all on public.nino_priority_events to service_role;
grant usage, select on sequence public.nino_priority_events_id_seq to service_role;

-- Registro validado: só aceita destaque que pertence à fila (ou situação) do
-- próprio usuário; impressão repetida em 12h conta uma vez.
create or replace function public.my_nino_priority_event(
  _fingerprint text,
  _event text,
  _surface text default 'home'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _kind text;
begin
  if _uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if _event not in ('impression', 'acted', 'next_requested', 'dismissed') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_event');
  end if;
  if coalesce(_surface, 'home') not in ('home', 'nino', 'chat', 'whatsapp') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_surface');
  end if;

  select f.kind into _kind
  from public.nino_priority_feed f
  where f.user_id = _uid and f.fingerprint = _fingerprint
  limit 1;
  if _kind is null then
    select s.communication_kind into _kind
    from public.proactive_situations s
    where s.user_id = _uid and s.fingerprint = _fingerprint
    order by s.updated_at desc
    limit 1;
  end if;
  if _kind is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_item');
  end if;

  if _event = 'impression' and exists (
    select 1 from public.nino_priority_events e
    where e.user_id = _uid and e.fingerprint = _fingerprint and e.event = 'impression'
      and e.created_at > now() - interval '12 hours'
  ) then
    return jsonb_build_object('ok', true, 'deduped', true);
  end if;

  insert into public.nino_priority_events (user_id, fingerprint, kind, event, surface)
  values (_uid, _fingerprint, _kind, _event, coalesce(_surface, 'home'));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.my_nino_priority_event(text, text, text) from public;
grant execute on function public.my_nino_priority_event(text, text, text) to authenticated;

-- Métricas de qualidade dos destaques (uso interno/admin; sem acesso do app).
create or replace view public.v_nino_highlight_quality_daily
with (security_invoker = true) as
with events as (
  select date_trunc('day', created_at)::date as day,
    count(*) filter (where event = 'impression') as impressions,
    count(*) filter (where event = 'acted') as acted,
    count(*) filter (where event = 'next_requested') as next_requested,
    count(*) filter (where event = 'dismissed') as dismissed,
    count(distinct user_id) as users
  from public.nino_priority_events
  group by 1
),
decisions as (
  select date_trunc('day', created_at)::date as day,
    count(*) filter (where decision = 'deliver') as delivered,
    count(*) filter (where reason like 'kind_repeat_window%' or reason = 'already_communicated_no_material_change') as repeats_blocked,
    count(*) filter (where reason = 'confidence_too_low') as low_confidence_blocked,
    count(*) filter (where reason = 'app_only_kind') as app_only_blocked
  from public.proactive_decisions
  group by 1
)
select coalesce(e.day, d.day) as day,
  coalesce(e.users, 0) as users_with_events,
  coalesce(e.impressions, 0) as impressions,
  coalesce(e.acted, 0) as acted,
  coalesce(e.next_requested, 0) as next_requested,
  coalesce(e.dismissed, 0) as dismissed,
  case when coalesce(e.impressions, 0) > 0 then round(e.acted::numeric / e.impressions, 3) end as acted_rate,
  case when coalesce(e.impressions, 0) > 0 then round(e.dismissed::numeric / e.impressions, 3) end as dismissed_rate,
  coalesce(d.delivered, 0) as proactive_delivered,
  coalesce(d.repeats_blocked, 0) as repeats_blocked,
  coalesce(d.low_confidence_blocked, 0) as low_confidence_blocked,
  coalesce(d.app_only_blocked, 0) as app_only_blocked
from events e
full outer join decisions d on d.day = e.day;

revoke all on public.v_nino_highlight_quality_daily from public, anon, authenticated;
grant select on public.v_nino_highlight_quality_daily to service_role;
