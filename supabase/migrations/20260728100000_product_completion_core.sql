-- MEU NINO — PRODUCT COMPLETION CORE
-- Additive migration: memory governance, behavioral hypotheses, advisor reviews
-- and hardened proactive communication. No financial source of truth is replaced.

begin;

alter table public.notification_preferences
  add column if not exists max_proactive_per_day smallint not null default 1,
  add column if not exists muted_proactive_kinds text[] not null default '{}'::text[];

alter table public.communication_deliveries
  add column if not exists interacted_at timestamptz,
  add column if not exists action_taken text,
  add column if not exists cost_usd numeric(12,6) not null default 0,
  add column if not exists block_context jsonb not null default '{}'::jsonb,
  add column if not exists false_positive boolean,
  add column if not exists user_feedback text;

create index if not exists communication_deliveries_user_dedup_created_idx
  on public.communication_deliveries(user_id, dedup_key, created_at desc);

create table if not exists public.behavior_hypotheses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  explanation text not null,
  confidence numeric(5,4) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  evidence jsonb not null default '{}'::jsonb,
  dedup_key text not null,
  status text not null default 'pending'
    check (status in ('pending','confirmed','partial','rejected','expired')),
  user_feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz,
  unique (user_id, dedup_key)
);

create index if not exists behavior_hypotheses_user_status_created_idx
  on public.behavior_hypotheses(user_id, status, created_at desc);

alter table public.behavior_hypotheses enable row level security;
drop policy if exists behavior_hypotheses_owner_select on public.behavior_hypotheses;
create policy behavior_hypotheses_owner_select
  on public.behavior_hypotheses for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists behavior_hypotheses_owner_update on public.behavior_hypotheses;

create table if not exists public.advisor_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_kind text not null check (period_kind in ('weekly','monthly')),
  period_start date not null,
  period_end date not null,
  summary jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  status text not null default 'active'
    check (status in ('active','completed','archived')),
  formula_version text not null default 'advisor.review.v1',
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, period_kind, period_start)
);

create index if not exists advisor_reviews_user_period_idx
  on public.advisor_reviews(user_id, period_kind, period_start desc);

alter table public.advisor_reviews enable row level security;
drop policy if exists advisor_reviews_owner_select on public.advisor_reviews;
create policy advisor_reviews_owner_select
  on public.advisor_reviews for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists advisor_reviews_owner_update on public.advisor_reviews;

revoke all on table public.behavior_hypotheses from public, anon, authenticated;
revoke all on table public.advisor_reviews from public, anon, authenticated;
grant select on table public.behavior_hypotheses to authenticated;
grant select on table public.advisor_reviews to authenticated;
grant all on table public.behavior_hypotheses to service_role;
grant all on table public.advisor_reviews to service_role;

create or replace function public.my_nino_context()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'memory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'kind', m.kind,
        'key', m.key,
        'value', m.value,
        'confidence', m.confidence,
        'source', m.source,
        'expires_at', m.expires_at,
        'last_used_at', m.last_used_at,
        'created_at', m.created_at,
        'updated_at', m.updated_at
      ) order by m.updated_at desc)
      from public.agent_memory m
      where m.user_id = v_user
        and (m.expires_at is null or m.expires_at > now())
    ), '[]'::jsonb),
    'hypotheses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'kind', h.kind,
        'title', h.title,
        'explanation', h.explanation,
        'confidence', h.confidence,
        'evidence', h.evidence,
        'dedup_key', h.dedup_key,
        'status', h.status,
        'user_feedback', h.user_feedback,
        'created_at', h.created_at,
        'updated_at', h.updated_at,
        'expires_at', h.expires_at
      ) order by h.updated_at desc)
      from public.behavior_hypotheses h
      where h.user_id = v_user
        and h.status <> 'expired'
        and (h.expires_at is null or h.expires_at > now())
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'period_kind', r.period_kind,
        'period_start', r.period_start,
        'period_end', r.period_end,
        'summary', r.summary,
        'actions', r.actions,
        'status', r.status,
        'formula_version', r.formula_version,
        'generated_at', r.generated_at,
        'updated_at', r.updated_at
      ) order by r.period_start desc, r.generated_at desc)
      from (
        select *
        from public.advisor_reviews
        where user_id = v_user
        order by period_start desc, generated_at desc
        limit 12
      ) r
    ), '[]'::jsonb),
    'recent_deliveries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'kind', d.kind,
        'channel', d.channel,
        'status', d.status,
        'reason', d.reason,
        'created_at', d.created_at,
        'interacted_at', d.interacted_at,
        'false_positive', d.false_positive,
        'user_feedback', d.user_feedback
      ) order by d.created_at desc)
      from (
        select *
        from public.communication_deliveries
        where user_id = v_user
          and created_at >= now() - interval '30 days'
          and status in ('queued','sent','delivered','acted')
        order by created_at desc
        limit 20
      ) d
    ), '[]'::jsonb),
    'preferences', coalesce((
      select jsonb_build_object(
        'proactive_financial', p.proactive_financial,
        'emotional_checkin', p.emotional_checkin,
        'smart_tips', p.smart_tips,
        'whatsapp_proactive', p.whatsapp_proactive,
        'quiet_start', p.quiet_start,
        'quiet_end', p.quiet_end,
        'max_proactive_per_week', p.max_proactive_per_week,
        'max_proactive_per_day', p.max_proactive_per_day,
        'muted_proactive_kinds', p.muted_proactive_kinds
      )
      from public.notification_preferences p
      where p.user_id = v_user
    ), jsonb_build_object(
      'proactive_financial', true,
      'emotional_checkin', true,
      'smart_tips', true,
      'whatsapp_proactive', false,
      'quiet_start', '21:00',
      'quiet_end', '08:00',
      'max_proactive_per_week', 3,
      'max_proactive_per_day', 1,
      'muted_proactive_kinds', '[]'::jsonb
    )),
    'generated_at', now()
  );
end;
$$;

create or replace function public.my_nino_memory_update(
  _memory_id uuid,
  _value jsonb,
  _expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.agent_memory%rowtype;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if _value is null then
    raise exception 'value_required' using errcode = '22023';
  end if;

  update public.agent_memory
  set value = _value,
      source = 'correction',
      confidence = 1,
      expires_at = _expires_at,
      updated_at = now()
  where id = _memory_id
    and user_id = v_user
  returning * into v_row;

  if v_row.id is null then
    raise exception 'memory_not_found' using errcode = 'P0002';
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.my_nino_memory_delete(_memory_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  delete from public.agent_memory
  where id = _memory_id and user_id = v_user;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.my_behavior_hypothesis_feedback(
  _hypothesis_id uuid,
  _verdict text,
  _feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_status text;
  v_row public.behavior_hypotheses%rowtype;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  v_status := case lower(coalesce(_verdict, ''))
    when 'confirmed' then 'confirmed'
    when 'partial' then 'partial'
    when 'rejected' then 'rejected'
    else null
  end;
  if v_status is null then
    raise exception 'invalid_verdict' using errcode = '22023';
  end if;

  update public.behavior_hypotheses
  set status = v_status,
      user_feedback = nullif(trim(_feedback), ''),
      confirmed_at = case when v_status in ('confirmed','partial') then now() else null end,
      updated_at = now()
  where id = _hypothesis_id
    and user_id = v_user
  returning * into v_row;

  if v_row.id is null then
    raise exception 'hypothesis_not_found' using errcode = 'P0002';
  end if;

  if v_status = 'rejected' then
    delete from public.agent_memory
    where user_id = v_user
      and kind = 'behavior_hypothesis'
      and key = lower(trim(v_row.dedup_key));
  else
    insert into public.agent_memory(
      user_id, kind, key, value, confidence, source, expires_at, updated_at
    ) values (
      v_user,
      'behavior_hypothesis',
      lower(trim(v_row.dedup_key)),
      jsonb_build_object(
        'title', v_row.title,
        'explanation', v_row.explanation,
        'status', v_status,
        'evidence', v_row.evidence
      ),
      case when v_status = 'confirmed' then 1 else greatest(v_row.confidence, 0.75) end,
      'correction',
      v_row.expires_at,
      now()
    )
    on conflict (user_id, kind, key) do update
      set value = excluded.value,
          confidence = excluded.confidence,
          source = excluded.source,
          expires_at = excluded.expires_at,
          updated_at = now();
  end if;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.my_advisor_action_feedback(
  _review_id uuid,
  _action_key text,
  _status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.advisor_reviews%rowtype;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if _status not in ('pending','in_progress','done','dismissed') then
    raise exception 'invalid_action_status' using errcode = '22023';
  end if;

  update public.advisor_reviews r
  set actions = (
        select coalesce(jsonb_agg(
          case
            when item->>'key' = _action_key
              then item || jsonb_build_object('status', _status, 'updated_at', now())
            else item
          end
        ), '[]'::jsonb)
        from jsonb_array_elements(r.actions) item
      ),
      status = case
        when not exists (
          select 1
          from jsonb_array_elements(r.actions) a
          where a->>'key' <> _action_key
            and coalesce(a->>'status','pending') not in ('done','dismissed')
        ) and _status in ('done','dismissed')
        then 'completed'
        else r.status
      end,
      updated_at = now()
  where r.id = _review_id
    and r.user_id = v_user
    and exists (
      select 1 from jsonb_array_elements(r.actions) a
      where a->>'key' = _action_key
    )
  returning * into v_row;

  if v_row.id is null then
    raise exception 'review_or_action_not_found' using errcode = 'P0002';
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.my_proactive_preferences_update(
  _max_per_day smallint default null,
  _whatsapp boolean default null,
  _muted text[] default null,
  _financial boolean default null,
  _emotional boolean default null,
  _smart_tips boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.notification_preferences%rowtype;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if _max_per_day is not null and (_max_per_day < 0 or _max_per_day > 5) then
    raise exception 'invalid_daily_cap' using errcode = '22023';
  end if;

  insert into public.notification_preferences(
    user_id,
    max_proactive_per_day,
    whatsapp_proactive,
    muted_proactive_kinds,
    proactive_financial,
    emotional_checkin,
    smart_tips
  ) values (
    v_user,
    coalesce(_max_per_day, 1),
    coalesce(_whatsapp, false),
    coalesce(_muted, '{}'::text[]),
    coalesce(_financial, true),
    coalesce(_emotional, true),
    coalesce(_smart_tips, true)
  )
  on conflict (user_id) do update set
    max_proactive_per_day = coalesce(_max_per_day, notification_preferences.max_proactive_per_day),
    whatsapp_proactive = coalesce(_whatsapp, notification_preferences.whatsapp_proactive),
    muted_proactive_kinds = coalesce(_muted, notification_preferences.muted_proactive_kinds),
    proactive_financial = coalesce(_financial, notification_preferences.proactive_financial),
    emotional_checkin = coalesce(_emotional, notification_preferences.emotional_checkin),
    smart_tips = coalesce(_smart_tips, notification_preferences.smart_tips)
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.my_communication_feedback(
  _delivery_id uuid,
  _feedback text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.communication_deliveries%rowtype;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if _feedback not in ('useful','not_useful','dismissed') then
    raise exception 'invalid_feedback' using errcode = '22023';
  end if;

  update public.communication_deliveries
  set user_feedback = _feedback,
      false_positive = case
        when _feedback = 'not_useful' then true
        when _feedback = 'useful' then false
        else false_positive
      end,
      interacted_at = now(),
      action_taken = coalesce(action_taken, 'feedback:' || _feedback)
  where id = _delivery_id
    and user_id = v_user
  returning * into v_row;

  if v_row.id is null then
    raise exception 'delivery_not_found' using errcode = 'P0002';
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.admin_v2_nino_quality_summary(_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(_days, 30), 1), 365));
begin
  perform public._require_perm('messaging.read');

  return jsonb_build_object(
    'communications', jsonb_build_object(
      'total', (select count(*)::int from public.communication_deliveries where created_at >= v_from),
      'useful', (select count(*)::int from public.communication_deliveries where created_at >= v_from and user_feedback = 'useful'),
      'not_useful', (select count(*)::int from public.communication_deliveries where created_at >= v_from and false_positive is true),
      'suppressed', (select count(*)::int from public.communication_deliveries where created_at >= v_from and status = 'suppressed')
    ),
    'behavior', jsonb_build_object(
      'pending', (select count(*)::int from public.behavior_hypotheses where created_at >= v_from and status = 'pending'),
      'confirmed', (select count(*)::int from public.behavior_hypotheses where created_at >= v_from and status = 'confirmed'),
      'partial', (select count(*)::int from public.behavior_hypotheses where created_at >= v_from and status = 'partial'),
      'rejected', (select count(*)::int from public.behavior_hypotheses where created_at >= v_from and status = 'rejected')
    ),
    'advisor', jsonb_build_object(
      'weekly', (select count(*)::int from public.advisor_reviews where generated_at >= v_from and period_kind = 'weekly'),
      'monthly', (select count(*)::int from public.advisor_reviews where generated_at >= v_from and period_kind = 'monthly'),
      'completed', (select count(*)::int from public.advisor_reviews where generated_at >= v_from and status = 'completed')
    ),
    'measured_at', now()
  );
end;
$$;

revoke all on function public.my_nino_context() from public, anon;
revoke all on function public.my_nino_memory_update(uuid,jsonb,timestamptz) from public, anon;
revoke all on function public.my_nino_memory_delete(uuid) from public, anon;
revoke all on function public.my_behavior_hypothesis_feedback(uuid,text,text) from public, anon;
revoke all on function public.my_advisor_action_feedback(uuid,text,text) from public, anon;
revoke all on function public.my_proactive_preferences_update(smallint,boolean,text[],boolean,boolean,boolean) from public, anon;
revoke all on function public.my_communication_feedback(uuid,text) from public, anon;
revoke all on function public.admin_v2_nino_quality_summary(integer) from public, anon;

grant execute on function public.my_nino_context() to authenticated, service_role;
grant execute on function public.my_nino_memory_update(uuid,jsonb,timestamptz) to authenticated, service_role;
grant execute on function public.my_nino_memory_delete(uuid) to authenticated, service_role;
grant execute on function public.my_behavior_hypothesis_feedback(uuid,text,text) to authenticated, service_role;
grant execute on function public.my_advisor_action_feedback(uuid,text,text) to authenticated, service_role;
grant execute on function public.my_proactive_preferences_update(smallint,boolean,text[],boolean,boolean,boolean) to authenticated, service_role;
grant execute on function public.my_communication_feedback(uuid,text) to authenticated, service_role;
grant execute on function public.admin_v2_nino_quality_summary(integer) to authenticated, service_role;

commit;
