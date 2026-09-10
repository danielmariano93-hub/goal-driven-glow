create table if not exists public.nino_topic_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  subject text not null,
  title text,
  summary text,
  status text not null default 'open',
  keywords text[] not null default '{}',
  entities text[] not null default '{}',
  acts text[] not null default '{}',
  period_from date,
  period_to date,
  original_query text,
  last_query text,
  evidence_reference jsonb,
  execution_summary jsonb,
  turn_count integer not null default 1,
  opened_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  dormant_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint nino_topic_threads_status_chk
    check (status in ('open','answered','clarifying','dormant','closed'))
);

grant select on public.nino_topic_threads to authenticated;
grant all on public.nino_topic_threads to service_role;
alter table public.nino_topic_threads enable row level security;

drop policy if exists "own topic threads" on public.nino_topic_threads;
create policy "own topic threads" on public.nino_topic_threads
  for select to authenticated using (user_id = auth.uid());

create index if not exists nino_topic_threads_user_activity_idx
  on public.nino_topic_threads (user_id, last_activity_at desc);
create index if not exists nino_topic_threads_keywords_idx
  on public.nino_topic_threads using gin (keywords);
create index if not exists nino_topic_threads_conversation_idx
  on public.nino_topic_threads (conversation_id, last_activity_at desc);

create table if not exists public.nino_topic_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null references public.nino_topic_threads(id) on delete cascade,
  message_id text not null,
  provider_message_id text,
  direction text not null,
  surface text,
  created_at timestamptz not null default now(),
  constraint nino_topic_messages_direction_chk check (direction in ('inbound','outbound')),
  constraint nino_topic_messages_unique unique (topic_id, message_id)
);

grant select on public.nino_topic_messages to authenticated;
grant all on public.nino_topic_messages to service_role;
alter table public.nino_topic_messages enable row level security;

drop policy if exists "own topic messages" on public.nino_topic_messages;
create policy "own topic messages" on public.nino_topic_messages
  for select to authenticated using (user_id = auth.uid());

create index if not exists nino_topic_messages_lookup_idx
  on public.nino_topic_messages (user_id, message_id);
create index if not exists nino_topic_messages_provider_idx
  on public.nino_topic_messages (user_id, provider_message_id);

create or replace function public.nino_topic_thread_touch(p_topic_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.nino_topic_threads t set
    subject = coalesce(p_patch->>'subject', t.subject),
    title = coalesce(p_patch->>'title', t.title),
    summary = coalesce(p_patch->>'summary', t.summary),
    status = coalesce(p_patch->>'status', t.status),
    keywords = coalesce(
      (select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p_patch->'keywords','[]'::jsonb)) x),
      t.keywords),
    entities = coalesce(
      (select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p_patch->'entities','[]'::jsonb)) x),
      t.entities),
    acts = coalesce(
      (select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p_patch->'acts','[]'::jsonb)) x),
      t.acts),
    period_from = coalesce((p_patch->>'period_from')::date, t.period_from),
    period_to = coalesce((p_patch->>'period_to')::date, t.period_to),
    last_query = coalesce(p_patch->>'last_query', t.last_query),
    evidence_reference = coalesce(p_patch->'evidence_reference', t.evidence_reference),
    execution_summary = coalesce(p_patch->'execution_summary', t.execution_summary),
    turn_count = t.turn_count + 1,
    last_activity_at = now(),
    dormant_at = case when coalesce(p_patch->>'status', t.status) = 'dormant' then now() else null end,
    closed_at = case when coalesce(p_patch->>'status', t.status) = 'closed' then now() else null end
  where t.id = p_topic_id;
end;
$$;

revoke all on function public.nino_topic_thread_touch(uuid, jsonb) from public;
grant execute on function public.nino_topic_thread_touch(uuid, jsonb) to service_role;

create or replace function public.nino_topic_threads_lifecycle(p_user_id uuid)
returns table (dormant integer, closed integer)
language plpgsql
security definer
set search_path = public
as $$
declare v_dormant integer := 0; v_closed integer := 0;
begin
  with upd as (
    update public.nino_topic_threads set status = 'dormant', dormant_at = now()
    where user_id = p_user_id and status in ('open','answered','clarifying')
      and last_activity_at < now() - interval '7 days'
    returning 1
  ) select count(*)::int into v_dormant from upd;

  with upd2 as (
    update public.nino_topic_threads set status = 'closed', closed_at = now()
    where user_id = p_user_id and status = 'dormant'
      and last_activity_at < now() - interval '90 days'
    returning 1
  ) select count(*)::int into v_closed from upd2;

  return query select v_dormant, v_closed;
end;
$$;

revoke all on function public.nino_topic_threads_lifecycle(uuid) from public;
grant execute on function public.nino_topic_threads_lifecycle(uuid) to service_role;

alter table public.agent_runs
  add column if not exists execution_tier smallint,
  add column if not exists complexity_score numeric,
  add column if not exists ambiguity_score numeric,
  add column if not exists risk_score numeric,
  add column if not exists context_dependency_score numeric,
  add column if not exists context_blocks_loaded text[],
  add column if not exists context_blocks_skipped text[],
  add column if not exists escalation_count integer,
  add column if not exists escalation_reason text,
  add column if not exists early_exit_stage text,
  add column if not exists parallel_groups jsonb,
  add column if not exists critical_path_ms integer,
  add column if not exists topic_id uuid,
  add column if not exists topic_match_score numeric,
  add column if not exists topic_resolution_source text,
  add column if not exists quoted_message_used boolean,
  add column if not exists turn_marks jsonb,
  add column if not exists backend_latency_ms integer,
  add column if not exists provider_latency_ms integer,
  add column if not exists perceived_latency_ms integer;

create index if not exists agent_runs_execution_tier_idx
  on public.agent_runs (execution_tier, started_at desc);

insert into public.agent_runtime_flags (flag_name, enabled, rollout_percent, pilot_user_ids)
values
  ('adaptive_execution_v1', false, 0, '{}'),
  ('conversation_threads_v1', false, 0, '{}'),
  ('semantic_topic_retrieval_v1', false, 0, '{}')
on conflict (flag_name) do nothing;