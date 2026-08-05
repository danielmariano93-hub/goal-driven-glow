-- Nino Financial Situation Core v1
-- Arquitetura: fatos -> situações -> diagnóstico -> projeções de superfície.
-- Mantém nino_intelligence_items apenas como read model de compatibilidade.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. CONFIGURAÇÃO, EXECUÇÕES E DOMÍNIO CENTRAL
-- ---------------------------------------------------------------------------

create table if not exists public.nino_diagnosis_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  rollout_mode text not null default 'shadow' check (rollout_mode in ('shadow','active','legacy')),
  communication_mode text not null default 'app_only' check (communication_mode in ('disabled','app_only','full')),
  contract_version text not null default 'nino_diagnosis_contract.v1',
  min_primary_confidence numeric not null default 0.60 check (min_primary_confidence between 0 and 1),
  max_supporting integer not null default 3 check (max_supporting between 1 and 6),
  updated_at timestamptz not null default now()
);

insert into public.nino_diagnosis_config(singleton, enabled, rollout_mode, communication_mode)
values (true, true, 'shadow', 'app_only')
on conflict (singleton) do update
set enabled = excluded.enabled,
    rollout_mode = excluded.rollout_mode,
    communication_mode = excluded.communication_mode,
    contract_version = 'nino_diagnosis_contract.v1',
    updated_at = now();

create table if not exists public.nino_diagnosis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_mode text not null check (run_mode in ('live','shadow','backtest')),
  as_of date not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  source text not null default 'engine',
  situations_created integer not null default 0,
  situations_updated integer not null default 0,
  situations_resolved integer not null default 0,
  projected_items integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists nino_diagnosis_runs_user_idx
  on public.nino_diagnosis_runs(user_id, as_of desc, started_at desc);

create table if not exists public.financial_situations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_mode text not null default 'live' check (run_mode in ('live','shadow','backtest')),
  situation_key text not null,
  situation_type text not null check (situation_type in (
    'cash_flow_imbalance',
    'liquidity_pressure',
    'spending_pace_change',
    'category_shift',
    'card_cycle_pressure',
    'goal_feasibility',
    'debt_progress',
    'investment_drawdown',
    'data_quality_issue',
    'duplicate_review',
    'shared_payment_confirmation',
    'behavioral_pattern',
    'recurring_commitment_pressure',
    'anticipation'
  )),
  status text not null check (status in (
    'observed','confirmed','active','improving','worsening','resolved','expired','suppressed'
  )),
  temporal_scope text not null check (temporal_scope in ('now','historical','future')),
  severity text not null check (severity in ('info','positive','attention','critical')),
  confidence numeric not null check (confidence between 0 and 1),
  relevance_score integer not null default 0 check (relevance_score between 0 and 100),
  period_start date,
  period_end date,
  current_value numeric,
  baseline_value numeric,
  absolute_delta numeric,
  percentage_delta numeric,
  impact_amount numeric,
  headline text not null,
  cause_summary text,
  consequence_summary text,
  forecast_summary text,
  evaluation jsonb not null default '{}'::jsonb,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  formula_version text not null default 'financial_situation.v1',
  last_evaluation_run_id uuid references public.nino_diagnosis_runs(id) on delete set null,
  supersedes_id uuid references public.financial_situations(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, run_mode, situation_key)
);

create index if not exists financial_situations_active_idx
  on public.financial_situations(user_id, run_mode, status, temporal_scope, relevance_score desc);
create index if not exists financial_situations_type_idx
  on public.financial_situations(user_id, situation_type, period_start desc);

create table if not exists public.financial_situation_evidence (
  id uuid primary key default gen_random_uuid(),
  situation_id uuid not null references public.financial_situations(id) on delete cascade,
  evaluation_run_id uuid references public.nino_diagnosis_runs(id) on delete set null,
  evidence_type text not null,
  fact_id uuid references public.financial_insight_facts(id) on delete set null,
  transaction_id uuid references public.transactions(id) on delete set null,
  pattern_id uuid references public.behavioral_patterns(id) on delete set null,
  opportunity_id uuid references public.anticipation_opportunities(id) on delete set null,
  report_id uuid references public.financial_reports(id) on delete set null,
  metric_key text,
  value numeric,
  contribution_amount numeric,
  contribution_pct numeric,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists financial_situation_evidence_situation_idx
  on public.financial_situation_evidence(situation_id, evidence_type);

create table if not exists public.financial_situation_actions (
  id uuid primary key default gen_random_uuid(),
  situation_id uuid not null references public.financial_situations(id) on delete cascade,
  action_key text not null,
  action_type text not null,
  title text not null,
  explanation text,
  estimated_impact numeric,
  route text not null,
  priority integer not null default 50,
  status text not null default 'proposed' check (status in ('proposed','accepted','in_progress','done','dismissed','expired')),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(situation_id, action_key)
);

create index if not exists financial_situation_actions_active_idx
  on public.financial_situation_actions(situation_id, status, priority desc);

create table if not exists public.financial_situation_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  situation_id uuid not null references public.financial_situations(id) on delete cascade,
  item_id uuid references public.nino_intelligence_items(id) on delete set null,
  surface text not null,
  feedback text not null check (feedback in ('useful','not_useful','dismiss','acted')),
  created_at timestamptz not null default now()
);

create index if not exists financial_situation_feedback_idx
  on public.financial_situation_feedback(situation_id, created_at desc);

create table if not exists public.nino_diagnosis_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_mode text not null default 'live' check (run_mode in ('live','shadow','backtest')),
  as_of date not null,
  overall_state text not null check (overall_state in ('stable','positive','attention','critical','insufficient_data')),
  primary_situation_id uuid references public.financial_situations(id) on delete set null,
  supporting_situation_ids uuid[] not null default '{}'::uuid[],
  primary_action_id uuid references public.financial_situation_actions(id) on delete set null,
  forecast jsonb not null default '{}'::jsonb,
  data_quality jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0 check (confidence between 0 and 1),
  rationale jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  contract_version text not null default 'nino_diagnosis_contract.v1',
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists nino_diagnosis_current_idx
  on public.nino_diagnosis_snapshots(user_id, run_mode)
  where is_current;
create index if not exists nino_diagnosis_history_idx
  on public.nino_diagnosis_snapshots(user_id, run_mode, as_of desc, created_at desc);

-- O payload capturado é imutável. Apenas is_current pode mudar para apontar o
-- diagnóstico vigente sem reescrever a história.
create or replace function public.nino_guard_diagnosis_snapshot_immutable()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  -- O payload é a cópia auditável. Ponteiros relacionais podem ser anulados por
  -- cascatas de exclusão sem impedir o fluxo de privacidade/remoção da conta.
  if new.user_id is distinct from old.user_id
     or new.run_mode is distinct from old.run_mode
     or new.as_of is distinct from old.as_of
     or new.payload is distinct from old.payload
     or new.contract_version is distinct from old.contract_version
     or new.created_at is distinct from old.created_at then
    raise exception 'nino_diagnosis_snapshot_is_immutable';
  end if;
  return new;
end $$;

drop trigger if exists trg_nino_diagnosis_snapshot_immutable on public.nino_diagnosis_snapshots;
create trigger trg_nino_diagnosis_snapshot_immutable
before update on public.nino_diagnosis_snapshots
for each row execute function public.nino_guard_diagnosis_snapshot_immutable();

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------

alter table public.nino_diagnosis_runs enable row level security;
alter table public.financial_situations enable row level security;
alter table public.financial_situation_evidence enable row level security;
alter table public.financial_situation_actions enable row level security;
alter table public.financial_situation_feedback enable row level security;
alter table public.nino_diagnosis_snapshots enable row level security;
alter table public.nino_diagnosis_config enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='financial_situations' and policyname='financial_situations_select_own') then
    create policy financial_situations_select_own on public.financial_situations
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='financial_situation_evidence' and policyname='financial_situation_evidence_select_own') then
    create policy financial_situation_evidence_select_own on public.financial_situation_evidence
      for select to authenticated using (
        exists (select 1 from public.financial_situations s where s.id=situation_id and s.user_id=auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='financial_situation_actions' and policyname='financial_situation_actions_select_own') then
    create policy financial_situation_actions_select_own on public.financial_situation_actions
      for select to authenticated using (
        exists (select 1 from public.financial_situations s where s.id=situation_id and s.user_id=auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='financial_situation_feedback' and policyname='financial_situation_feedback_select_own') then
    create policy financial_situation_feedback_select_own on public.financial_situation_feedback
      for select to authenticated using (user_id=auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='nino_diagnosis_snapshots' and policyname='nino_diagnosis_snapshots_select_own') then
    create policy nino_diagnosis_snapshots_select_own on public.nino_diagnosis_snapshots
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='nino_diagnosis_runs' and policyname='nino_diagnosis_runs_select_own') then
    create policy nino_diagnosis_runs_select_own on public.nino_diagnosis_runs
      for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='nino_diagnosis_config' and policyname='nino_diagnosis_config_read') then
    create policy nino_diagnosis_config_read on public.nino_diagnosis_config
      for select to authenticated using (true);
  end if;
end $$;

grant select on public.financial_situations, public.financial_situation_evidence,
  public.financial_situation_actions, public.financial_situation_feedback, public.nino_diagnosis_snapshots,
  public.nino_diagnosis_runs, public.nino_diagnosis_config to authenticated;

-- Guardrails: enquanto o diagnóstico v1 estiver ativo, nenhuma fonte legada pode
-- voltar a publicar itens ou comunicações concorrentes.
create or replace function public.nino_guard_legacy_surface_write()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_enabled boolean; v_mode text;
begin
  select enabled,rollout_mode into v_enabled,v_mode from public.nino_diagnosis_config where singleton=true;
  if coalesce(v_enabled,false) and v_mode='active'
     and coalesce(new.source,'')<>'financial_diagnosis'
     and new.status='active' then
    new.status:='superseded';
    new.superseded_at:=coalesce(new.superseded_at,now());
    new.suppression_reason:=coalesce(new.suppression_reason,'legacy_source_disabled_by_diagnosis_core_v1');
  end if;
  return new;
end $$;

drop trigger if exists trg_nino_guard_legacy_surface_write on public.nino_intelligence_items;
create trigger trg_nino_guard_legacy_surface_write
before insert or update on public.nino_intelligence_items
for each row execute function public.nino_guard_legacy_surface_write();

create or replace function public.nino_guard_legacy_proactive_write()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_enabled boolean; v_mode text;
begin
  select enabled,rollout_mode into v_enabled,v_mode from public.nino_diagnosis_config where singleton=true;
  if coalesce(v_enabled,false) and v_mode='active'
     and coalesce(new.dedup_key,'') not like 'diagnosis:%'
     and new.status in ('pending','ready','deferred') then
    new.status:='dismissed';
    new.defer_reason:='legacy_source_disabled_by_diagnosis_core_v1';
  end if;
  return new;
end $$;

drop trigger if exists trg_nino_guard_legacy_proactive_write on public.pending_proactive_suggestions;
create trigger trg_nino_guard_legacy_proactive_write
before insert or update on public.pending_proactive_suggestions
for each row execute function public.nino_guard_legacy_proactive_write();

-- ---------------------------------------------------------------------------
-- 3. HELPERS DETERMINÍSTICOS
-- ---------------------------------------------------------------------------

create or replace function public.nino_diag_brl(_value numeric)
returns text language sql immutable set search_path=public as $$
  select public.nino_brl(coalesce(_value,0));
$$;

create or replace function public.nino_diag_pct(_value numeric)
returns text language sql immutable set search_path=public as $$
  select public.nino_num(coalesce(_value,0)) || '%';
$$;

create or replace function public.nino_diag_score(
  _severity text,
  _confidence numeric,
  _impact numeric,
  _impact_pct numeric,
  _temporal_scope text,
  _actionable boolean,
  _positive boolean default false
) returns integer
language sql immutable set search_path=public as $$
  select greatest(1, least(100, (
    case _severity when 'critical' then 82 when 'attention' then 66 when 'positive' then 48 else 42 end
    + least(10, (abs(coalesce(_impact,0))/250)::int)
    + least(8, (abs(coalesce(_impact_pct,0))/8)::int)
    + (coalesce(_confidence,0.5)*8)::int
    + case when _temporal_scope='future' then 5 else 0 end
    + case when _actionable then 5 else 0 end
    - case when _positive then 6 else 0 end
  )::int));
$$;

create or replace function public.nino_diag_put_situation(
  _user_id uuid,
  _run_mode text,
  _run_id uuid,
  _as_of date,
  _situation_type text,
  _situation_key text,
  _status text,
  _temporal_scope text,
  _severity text,
  _confidence numeric,
  _period_start date,
  _period_end date,
  _current_value numeric,
  _baseline_value numeric,
  _absolute_delta numeric,
  _percentage_delta numeric,
  _impact_amount numeric,
  _headline text,
  _cause text,
  _consequence text,
  _forecast text,
  _valid_until timestamptz,
  _evaluation jsonb,
  _evidence jsonb,
  _action jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_id uuid;
  v_key text := _situation_key || case when _run_mode='live' then '' else ':' || _as_of::text end;
  v_score int;
  v_actionable boolean := coalesce(_action->>'route','') <> '';
  v_action_key text := coalesce(_action->>'key', _situation_type || ':primary');
  v_positive boolean := _severity='positive' or _status='improving';
begin
  v_score := public.nino_diag_score(_severity, _confidence, _impact_amount, _percentage_delta,
                                     _temporal_scope, v_actionable, v_positive);

  insert into public.financial_situations(
    user_id, run_mode, situation_key, situation_type, status, temporal_scope,
    severity, confidence, relevance_score, period_start, period_end,
    current_value, baseline_value, absolute_delta, percentage_delta, impact_amount,
    headline, cause_summary, consequence_summary, forecast_summary,
    evaluation, valid_from, valid_until, formula_version, last_evaluation_run_id,
    resolved_at, updated_at
  ) values (
    _user_id, _run_mode, v_key, _situation_type, _status, _temporal_scope,
    _severity, greatest(0,least(1,coalesce(_confidence,0.5))), v_score,
    _period_start, _period_end, _current_value, _baseline_value,
    _absolute_delta, _percentage_delta, _impact_amount,
    _headline, _cause, _consequence, _forecast,
    coalesce(_evaluation,'{}'::jsonb), now(), _valid_until,
    'financial_situation.v1', _run_id, null, now()
  )
  on conflict (user_id, run_mode, situation_key) do update set
    situation_type=excluded.situation_type,
    status=excluded.status,
    temporal_scope=excluded.temporal_scope,
    severity=excluded.severity,
    confidence=excluded.confidence,
    relevance_score=excluded.relevance_score,
    period_start=excluded.period_start,
    period_end=excluded.period_end,
    current_value=excluded.current_value,
    baseline_value=excluded.baseline_value,
    absolute_delta=excluded.absolute_delta,
    percentage_delta=excluded.percentage_delta,
    impact_amount=excluded.impact_amount,
    headline=excluded.headline,
    cause_summary=excluded.cause_summary,
    consequence_summary=excluded.consequence_summary,
    forecast_summary=excluded.forecast_summary,
    evaluation=excluded.evaluation,
    valid_from=excluded.valid_from,
    valid_until=excluded.valid_until,
    formula_version=excluded.formula_version,
    last_evaluation_run_id=excluded.last_evaluation_run_id,
    resolved_at=null,
    updated_at=now()
  returning id into v_id;

  insert into public.financial_situation_evidence(
    situation_id, evaluation_run_id, evidence_type, metric_key, value, contribution_amount,
    contribution_pct, confidence, metadata
  ) values (
    v_id, _run_id, coalesce(_evidence->>'evidence_type','aggregate'), _evidence->>'metric_key',
    nullif(_evidence->>'value','')::numeric,
    nullif(_evidence->>'contribution_amount','')::numeric,
    nullif(_evidence->>'contribution_pct','')::numeric,
    _confidence, coalesce(_evidence,'{}'::jsonb)
  );

  if v_actionable then
    -- Mantém o mesmo action_id e preserva decisões já tomadas pelo usuário.
    -- Ações antigas que deixaram de ser a recomendação atual apenas expiram.
    update public.financial_situation_actions
       set status='expired', updated_at=now()
     where situation_id=v_id and action_key<>v_action_key and status='proposed';

    insert into public.financial_situation_actions(
      situation_id, action_key, action_type, title, explanation,
      estimated_impact, route, priority, status, expires_at, metadata
    ) values (
      v_id,
      v_action_key,
      coalesce(_action->>'type','review'),
      coalesce(_action->>'title','Ver detalhes'),
      _action->>'explanation',
      nullif(_action->>'estimated_impact','')::numeric,
      _action->>'route',
      coalesce(nullif(_action->>'priority','')::int, 70),
      'proposed', _valid_until, coalesce(_action,'{}'::jsonb)
    )
    on conflict (situation_id, action_key) do update set
      action_type=excluded.action_type,
      title=excluded.title,
      explanation=excluded.explanation,
      estimated_impact=excluded.estimated_impact,
      route=excluded.route,
      priority=excluded.priority,
      status=case when public.financial_situation_actions.status in ('accepted','in_progress','done','dismissed')
                  then public.financial_situation_actions.status else 'proposed' end,
      expires_at=excluded.expires_at,
      metadata=excluded.metadata,
      updated_at=now();
  else
    update public.financial_situation_actions
       set status='expired', updated_at=now()
     where situation_id=v_id and status='proposed';
  end if;

  update public.financial_situations s
     set relevance_score=greatest(1,least(100,
       s.relevance_score
       + 3*(select count(*) from public.financial_situation_feedback f where f.situation_id=s.id and f.feedback='useful' and f.created_at>now()-interval '90 days')
       - 8*(select count(*) from public.financial_situation_feedback f where f.situation_id=s.id and f.feedback in ('not_useful','dismiss') and f.created_at>now()-interval '90 days')
     ))
   where s.id=v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. AVALIADORES DE SITUAÇÃO
-- ---------------------------------------------------------------------------

create or replace function public.nino_evaluate_financial_situations(
  _user_id uuid,
  _as_of date default current_date,
  _run_mode text default 'live',
  _source text default 'engine'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_run_id uuid;
  v_period_start date := date_trunc('month', _as_of)::date;
  v_prev_start date := (date_trunc('month', _as_of) - interval '1 month')::date;
  v_days_elapsed int := greatest(1, (_as_of - date_trunc('month', _as_of)::date) + 1);
  v_prev_end date;
  v_days_in_month int := extract(day from (date_trunc('month', _as_of) + interval '1 month - 1 day'))::int;
  v_current_expense numeric := 0;
  v_previous_expense numeric := 0;
  v_current_income numeric := 0;
  v_previous_income numeric := 0;
  v_redemptions numeric := 0;
  v_delta numeric := 0;
  v_pct numeric := 0;
  v_projected numeric := 0;
  v_gap numeric := 0;
  v_cat record;
  v_cat_contribution numeric := 0;
  v_merchants jsonb := '[]'::jsonb;
  v_avg_income numeric := 0;
  v_avg_expense numeric := 0;
  v_monthly_surplus numeric := 0;
  v_card_outstanding numeric := 0;
  v_card_limit numeric := 0;
  v_card_goal numeric := 0;
  v_card_ratio numeric := 0;
  v_commitments numeric := 0;
  v_goal record;
  v_goal_current numeric := 0;
  v_goal_remaining numeric := 0;
  v_goal_months numeric := 0;
  v_goal_needed numeric := 0;
  v_debt record;
  v_debt_progress numeric := 0;
  v_uncategorized_count int := 0;
  v_uncategorized_amount numeric := 0;
  v_duplicate_pairs jsonb := '[]'::jsonb;
  v_duplicate_count int := 0;
  v_duplicate_amount numeric := 0;
  v_situation_id uuid;
  r record;
  v_detected int := 0;
  v_resolved int := 0;
begin
  if _run_mode not in ('live','shadow','backtest') then
    raise exception 'invalid run_mode: %', _run_mode;
  end if;

  v_prev_end := least((v_period_start - interval '1 day')::date,
                      v_prev_start + (v_days_elapsed - 1));

  insert into public.nino_diagnosis_runs(user_id, run_mode, as_of, status, source)
  values (_user_id, _run_mode, _as_of, 'running', _source)
  returning id into v_run_id;

  update public.financial_situations
     set status='observed', updated_at=now()
   where user_id=_user_id and run_mode=_run_mode
     and status in ('active','confirmed','improving','worsening','observed')
     and temporal_scope in ('now','future');

  -- Consumo: somente transações de despesa; exclui fatura, dívida, aplicações,
  -- transferências e demais movimentos não comparáveis.
  select coalesce(sum(amount),0) into v_current_expense
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='expense'
     and coalesce(movement_kind,'transaction')='transaction'
     and occurred_at between v_period_start and _as_of;

  select coalesce(sum(amount),0) into v_previous_expense
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='expense'
     and coalesce(movement_kind,'transaction')='transaction'
     and occurred_at between v_prev_start and v_prev_end;

  select coalesce(sum(amount),0) into v_current_income
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='income'
     and coalesce(movement_kind,'transaction')='transaction'
     and occurred_at between v_period_start and _as_of;

  select coalesce(sum(amount),0) into v_previous_income
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='income'
     and coalesce(movement_kind,'transaction')='transaction'
     and occurred_at between v_prev_start and v_prev_end;

  select coalesce(sum(amount),0) into v_redemptions
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='income'
     and movement_kind='investment_redemption'
     and occurred_at between v_period_start and _as_of;

  v_delta := v_current_expense - v_previous_expense;
  v_pct := case when v_previous_expense > 0 then (v_delta/v_previous_expense)*100 else 0 end;
  v_projected := case when v_days_elapsed > 0 then (v_current_expense/v_days_elapsed)*v_days_in_month else 0 end;

  with curr as (
    select t.category_id, coalesce(c.name,'Sem categoria') category_name, sum(t.amount) amount,
           array_agg(t.id order by t.amount desc) transaction_ids
      from public.transactions t
      left join public.categories c on c.id=t.category_id
     where t.user_id=_user_id and t.status='confirmed' and t.type='expense'
       and coalesce(t.movement_kind,'transaction')='transaction'
       and t.occurred_at between v_period_start and _as_of
       and lower(coalesce(c.name,'')) !~ '(estorno|reembolso|transfer|fatura|invest|resgate|d[ií]vida)'
     group by t.category_id, c.name
  ), prev as (
    select t.category_id, sum(t.amount) amount
      from public.transactions t
     where t.user_id=_user_id and t.status='confirmed' and t.type='expense'
       and coalesce(t.movement_kind,'transaction')='transaction'
       and t.occurred_at between v_prev_start and v_prev_end
     group by t.category_id
  )
  select c.category_id, c.category_name, c.amount current_amount,
         coalesce(p.amount,0) previous_amount,
         c.amount-coalesce(p.amount,0) delta,
         c.transaction_ids
    into v_cat
    from curr c left join prev p on p.category_id is not distinct from c.category_id
   order by
     case when v_delta=0 then 0
          when (c.amount-coalesce(p.amount,0))*v_delta>0 then 0 else 1 end,
     abs(c.amount-coalesce(p.amount,0)) desc
   limit 1;

  if v_cat.category_id is not null or v_cat.category_name is not null then
    v_cat_contribution := case
      when abs(v_delta)>0 and coalesce(v_cat.delta,0)*v_delta>0
      then least(100, greatest(0, abs(v_cat.delta/v_delta)*100))
      else 0 end;
    select coalesce(jsonb_agg(x order by (x->>'amount')::numeric desc), '[]'::jsonb)
      into v_merchants
      from (
        select jsonb_build_object(
          'merchant', coalesce(nullif(t.normalized_description,''), nullif(t.friendly_description,''), t.description),
          'amount', sum(t.amount),
          'count', count(*)
        ) x
        from public.transactions t
        where t.user_id=_user_id and t.status='confirmed' and t.type='expense'
          and coalesce(t.movement_kind,'transaction')='transaction'
          and t.occurred_at between v_period_start and _as_of
          and t.category_id is not distinct from v_cat.category_id
        group by coalesce(nullif(t.normalized_description,''), nullif(t.friendly_description,''), t.description)
        order by sum(t.amount) desc limit 3
      ) q;
  end if;

  -- 4.1 Ritmo de gastos + explicação causal por categoria.
  if abs(v_delta) >= 100 and (abs(v_pct) >= 15 or v_previous_expense=0) then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'spending_pace_change', 'spending_pace:' || to_char(v_period_start,'YYYY-MM'),
      case when v_delta>0 then 'worsening' else 'improving' end,
      'now',
      case when v_delta<0 then 'positive'
           when v_days_elapsed>=7 and abs(v_pct)>=40 and v_delta>=500 then 'critical'
           else 'attention' end,
      case when v_days_elapsed<7 then 0.68 else 0.85 end,
      v_period_start, _as_of, v_current_expense, v_previous_expense,
      v_delta, v_pct, abs(v_delta),
      case
        when v_delta>0 and v_cat_contribution>=40 then
          v_cat.category_name || ' explicou ' || public.nino_diag_pct(v_cat_contribution) || ' do aumento dos seus gastos'
        when v_delta>0 then 'Seus gastos aumentaram ' || public.nino_diag_brl(abs(v_delta))
        else 'Seus gastos caíram ' || public.nino_diag_brl(abs(v_delta))
      end,
      'No mesmo intervalo, você gastou ' || public.nino_diag_brl(v_current_expense)
        || ' agora e ' || public.nino_diag_brl(v_previous_expense) || ' no mês anterior.'
        || case when v_cat_contribution>=25 then ' ' || v_cat.category_name || ' foi a maior explicação da diferença.' else '' end,
      case
        when v_delta>0 and v_cat_contribution>=50 then
          'Sem ' || v_cat.category_name || ', a variação restante seria de aproximadamente '
          || public.nino_diag_brl(abs(v_delta-v_cat.delta)) || '.'
        when v_delta>0 then 'A alta merece contexto antes de qualquer recomendação de corte.'
        else 'A redução melhora o ritmo do mês, desde que não seja apenas efeito de despesas adiadas.'
      end,
      case when v_delta>0 and v_days_elapsed>=5 then 'Mantido o ritmo atual, o consumo pode chegar a '
        || public.nino_diag_brl(v_projected) || ' até o fim do mês.' else null end,
      (_as_of + 3)::timestamptz,
      jsonb_build_object(
        'comparison_period', jsonb_build_object('current_start',v_period_start,'current_end',_as_of,'previous_start',v_prev_start,'previous_end',v_prev_end),
        'current_expense',v_current_expense,'previous_expense',v_previous_expense,
        'delta',v_delta,'percentage_delta',v_pct,'projected_month',v_projected,
        'top_category',v_cat.category_name,'category_delta',v_cat.delta,
        'category_contribution_pct',v_cat_contribution,'top_merchants',v_merchants
      ),
      jsonb_build_object(
        'evidence_type','spending_comparison','metric_key','expense_consumption',
        'value',v_current_expense,'contribution_amount',abs(coalesce(v_cat.delta,0)),
        'contribution_pct',v_cat_contribution,'top_merchants',v_merchants,
        'transaction_ids',coalesce(to_jsonb(v_cat.transaction_ids),'[]'::jsonb)
      ),
      jsonb_build_object(
        'key','spending_pace:review','type','review_spending','title',
        case when v_cat_contribution>=40 then 'Entender ' || v_cat.category_name else 'Entender a mudança' end,
        'explanation','Veja os lançamentos que mais contribuíram antes de decidir qualquer ajuste.',
        'route','/app/relatorios','priority',85
      )
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.2 Mudança concentrada em uma categoria: o estabelecimento vira evidência.
  if v_cat.category_name is not null and abs(coalesce(v_cat.delta,0)) >= 100 and v_cat_contribution >= 35 then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'category_shift', 'category_shift:' || coalesce(v_cat.category_id::text,'none') || ':' || to_char(v_period_start,'YYYY-MM'),
      case when v_cat.delta>0 then 'active' else 'improving' end,
      'now', case when v_cat.delta>0 then 'attention' else 'positive' end,
      case when v_days_elapsed<7 then 0.68 else 0.82 end,
      v_period_start, _as_of, v_cat.current_amount, v_cat.previous_amount,
      v_cat.delta,
      case when v_cat.previous_amount>0 then (v_cat.delta/v_cat.previous_amount)*100 else null end,
      abs(v_cat.delta),
      case when v_cat.delta>0 then v_cat.category_name || ' foi a principal causa do aumento'
           else v_cat.category_name || ' foi a principal causa da redução' end,
      v_cat.category_name || ' passou de ' || public.nino_diag_brl(v_cat.previous_amount)
        || ' para ' || public.nino_diag_brl(v_cat.current_amount) || ' no período equivalente.',
      'Os maiores lançamentos da categoria são evidências da mudança; eles não são, isoladamente, o insight.',
      null, (_as_of + 5)::timestamptz,
      jsonb_build_object('category_id',v_cat.category_id,'category_name',v_cat.category_name,
                         'current',v_cat.current_amount,'previous',v_cat.previous_amount,
                         'delta',v_cat.delta,'contribution_pct',v_cat_contribution,
                         'top_merchants',v_merchants),
      jsonb_build_object('evidence_type','category_contribution','metric_key','category_delta',
                         'value',v_cat.current_amount,'contribution_amount',abs(v_cat.delta),
                         'contribution_pct',v_cat_contribution,'top_merchants',v_merchants),
      jsonb_build_object('key','category_shift:review','type','review_category',
                         'title','Ver o que mudou','route','/app/relatorios','priority',78)
    );
    v_detected := v_detected + 1;
  end if;

  -- Médias móveis de renda e consumo para capacidade financeira.
  select coalesce(sum(case when type='income' and coalesce(movement_kind,'transaction')='transaction' then amount else 0 end),0)/3,
         coalesce(sum(case when type='expense' and coalesce(movement_kind,'transaction')='transaction' then amount else 0 end),0)/3
    into v_avg_income, v_avg_expense
    from public.transactions
   where user_id=_user_id and status='confirmed'
     and occurred_at between (_as_of - 90) and (_as_of - 1);
  v_monthly_surplus := greatest(v_avg_income-v_avg_expense,0);

  -- 4.3 Desequilíbrio operacional; resgates são explicação, não receita recorrente.
  v_gap := v_current_expense-v_current_income;
  if (v_days_elapsed>=7 or v_current_income>0)
     and v_gap > greatest(300, v_current_income*0.10) then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'cash_flow_imbalance', 'cash_flow:' || to_char(v_period_start,'YYYY-MM'),
      'active', 'now',
      case when v_current_income>0 and v_gap/v_current_income>=0.35 then 'critical' else 'attention' end,
      case when v_days_elapsed<7 then 0.65 else 0.88 end,
      v_period_start, _as_of, v_current_expense, v_current_income,
      v_gap, case when v_current_income>0 then (v_gap/v_current_income)*100 else null end,
      v_gap,
      'Seus gastos de consumo superam a renda em ' || public.nino_diag_brl(v_gap),
      'O cálculo considera apenas renda operacional e consumo; pagamentos de fatura, transferências, dívidas e investimentos ficam fora para evitar dupla contagem.',
      case when v_redemptions>0 then public.nino_diag_brl(v_redemptions)
        || ' entraram por resgates de investimento e ajudaram a sustentar o caixa.'
        else 'Sem uma entrada adicional, a diferença tende a pressionar o saldo disponível.' end,
      case when v_current_expense>0 then 'Mantido o ritmo, o consumo projetado é '
        || public.nino_diag_brl(v_projected) || ' no mês.' else null end,
      (_as_of + 3)::timestamptz,
      jsonb_build_object('earned_income',v_current_income,'consumption_expense',v_current_expense,
                         'gap',v_gap,'investment_redemptions',v_redemptions,
                         'average_monthly_surplus_90d',v_monthly_surplus),
      jsonb_build_object('evidence_type','cash_flow','metric_key','operating_gap',
                         'value',v_gap,'redemptions',v_redemptions),
      jsonb_build_object('key','cash_flow:review','type','review_cash_flow',
                         'title','Revisar a formação do saldo','route','/app/relatorios','priority',92)
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.4 Uso de investimento para sustentar o mês.
  if v_redemptions >= 500 and v_current_expense > v_current_income then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'investment_drawdown', 'investment_drawdown:' || to_char(v_period_start,'YYYY-MM'),
      'active', 'now', 'attention', 0.92,
      v_period_start, _as_of, v_redemptions, 0, v_redemptions, null, v_redemptions,
      public.nino_diag_brl(v_redemptions) || ' do caixa vieram de resgates de investimento',
      'Resgate não é renda nova: é patrimônio sendo convertido em caixa.',
      'Quando isso acontece para cobrir consumo recorrente, o orçamento deixa de se sustentar apenas pela renda.',
      'O Nino acompanhará se o uso de investimentos volta a acontecer nos próximos ciclos.',
      (_as_of + 7)::timestamptz,
      jsonb_build_object('redemptions',v_redemptions,'earned_income',v_current_income,
                         'consumption_expense',v_current_expense),
      jsonb_build_object('evidence_type','investment_redemption','metric_key','redemption_total','value',v_redemptions),
      jsonb_build_object('key','investment_drawdown:review','type','review_investments',
                         'title','Entender os resgates','route','/app/investimentos','priority',88)
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.5 Pressão de cartão por fatura aberta/relevante.
  select coalesce(sum(greatest(coalesce(s.outstanding_amount,s.reconciled_total,s.stated_total,0),0)),0),
         coalesce(sum(c.total_limit),0), coalesce(sum(c.statement_goal),0)
    into v_card_outstanding, v_card_limit, v_card_goal
    from public.credit_card_statements s
    join public.credit_cards c on c.id=s.credit_card_id
   where s.user_id=_user_id and c.active=true
     and s.status not in ('deleted','void')
     and (s.competence_month=date_trunc('month',_as_of)::date
          or s.due_date between (_as_of-7) and (_as_of+20));

  v_card_ratio := case when v_card_limit>0 then (v_card_outstanding/v_card_limit)*100 else 0 end;
  if v_card_outstanding>0 and (v_card_ratio>=35 or (v_card_goal>0 and v_card_outstanding>v_card_goal)) then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'card_cycle_pressure', 'card_pressure:' || to_char(v_period_start,'YYYY-MM'),
      'active', 'now', case when v_card_ratio>=65 then 'critical' else 'attention' end, 0.88,
      v_period_start, _as_of, v_card_outstanding,
      case when v_card_goal>0 then v_card_goal else v_card_limit end,
      case when v_card_goal>0 then v_card_outstanding-v_card_goal else v_card_outstanding end,
      v_card_ratio, v_card_outstanding,
      case when v_card_goal>0 and v_card_outstanding>v_card_goal then
        'Sua fatura está ' || public.nino_diag_brl(v_card_outstanding-v_card_goal) || ' acima da meta'
      else 'Sua fatura ocupa ' || public.nino_diag_pct(v_card_ratio) || ' do limite' end,
      'A leitura usa o saldo da fatura, não o pagamento da fatura como novo consumo.',
      'Uma fatura acelerada reduz a margem dos próximos dias e pode pressionar o fechamento do mês.',
      null, (_as_of + 5)::timestamptz,
      jsonb_build_object('outstanding',v_card_outstanding,'limit',v_card_limit,
                         'goal',v_card_goal,'utilization_pct',v_card_ratio),
      jsonb_build_object('evidence_type','card_statement','metric_key','statement_outstanding','value',v_card_outstanding),
      jsonb_build_object('key','card_pressure:review','type','review_card',
                         'title','Revisar a fatura','route','/app/cartoes','priority',90)
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.6 Viabilidade de meta baseada na sobra média real.
  -- Metas e saldos de investimentos não têm histórico de estado suficiente para
  -- um backtest fiel; entram apenas em execução live/shadow do presente.
  if _run_mode <> 'backtest' then
    select g.*, coalesce(sum(i.current_value),0) current_saved
      into v_goal
      from public.goals g
      left join public.investments i on i.goal_id=g.id and i.user_id=g.user_id
     where g.user_id=_user_id and g.status='active'
     group by g.id
     order by g.priority desc, g.target_date asc
     limit 1;

    if v_goal.id is not null then
      v_goal_current := coalesce(v_goal.current_saved,0);
      v_goal_remaining := greatest(v_goal.target_amount-v_goal_current,0);
      v_goal_months := greatest(1, ceil(greatest(v_goal.target_date-_as_of,1)/30.0));
      v_goal_needed := v_goal_remaining/v_goal_months;
      if v_goal_remaining>0 and (v_monthly_surplus=0 or v_goal_needed>v_monthly_surplus*1.15) then
        perform public.nino_diag_put_situation(
          _user_id, _run_mode, v_run_id, _as_of,
          'goal_feasibility', 'goal_feasibility:' || v_goal.id::text,
          'active', 'now', case when v_goal.target_date<_as_of then 'critical' else 'attention' end, 0.86,
          v_period_start, _as_of, v_goal_needed, v_monthly_surplus,
          v_goal_needed-v_monthly_surplus,
          case when v_monthly_surplus>0 then ((v_goal_needed-v_monthly_surplus)/v_monthly_surplus)*100 else null end,
          v_goal_remaining,
          'A meta “' || v_goal.name || '” pede mais do que sua sobra média comporta',
          'Faltam ' || public.nino_diag_brl(v_goal_remaining) || ' e o ritmo necessário é '
            || public.nino_diag_brl(v_goal_needed) || ' por mês.',
          'Sua sobra média dos últimos 90 dias foi ' || public.nino_diag_brl(v_monthly_surplus)
            || '. Ajustar prazo ou valor evita uma meta matematicamente inviável.',
          null, (_as_of + 14)::timestamptz,
          jsonb_build_object('goal_id',v_goal.id,'goal_name',v_goal.name,'target',v_goal.target_amount,
                             'current',v_goal_current,'remaining',v_goal_remaining,'months_left',v_goal_months,
                             'monthly_needed',v_goal_needed,'average_surplus_90d',v_monthly_surplus),
          jsonb_build_object('evidence_type','goal_capacity','metric_key','monthly_needed','value',v_goal_needed),
          jsonb_build_object('key','goal_feasibility:adjust','type','adjust_goal',
                             'title','Ajustar a meta','route','/app/metas','priority',82)
        );
        v_detected := v_detected + 1;
      end if;
    end if;

  end if;

  -- 4.7 Progresso de dívida como evolução, não como alerta.
  -- O saldo atual da dívida não é projetado para trás em backtests.
  if _run_mode <> 'backtest' then
    select * into v_debt from public.debts
     where user_id=_user_id and status='active'
       and coalesce(original_amount,contract_total_amount,0)>0
     order by coalesce(outstanding_balance,original_amount,0) desc limit 1;

    if v_debt.id is not null then
      v_debt_progress := greatest(0, least(100,
        (1-(coalesce(v_debt.outstanding_balance,0)/nullif(coalesce(v_debt.original_amount,v_debt.contract_total_amount),0)))*100));
      if v_debt_progress>=10 then
        perform public.nino_diag_put_situation(
          _user_id, _run_mode, v_run_id, _as_of,
          'debt_progress', 'debt_progress:' || v_debt.id::text,
          'improving', 'historical', 'positive', 0.95,
          coalesce(v_debt.start_date,v_period_start), _as_of,
          coalesce(v_debt.outstanding_balance,0), coalesce(v_debt.original_amount,v_debt.contract_total_amount),
          coalesce(v_debt.original_amount,v_debt.contract_total_amount)-coalesce(v_debt.outstanding_balance,0),
          v_debt_progress,
          coalesce(v_debt.original_amount,v_debt.contract_total_amount)-coalesce(v_debt.outstanding_balance,0),
          'Você já reduziu ' || public.nino_diag_pct(v_debt_progress) || ' da dívida “' || v_debt.name || '”',
          'O saldo caiu para ' || public.nino_diag_brl(coalesce(v_debt.outstanding_balance,0)) || '.',
          'Esse avanço reduz o passivo e melhora o patrimônio líquido.',
          null, (_as_of + 30)::timestamptz,
          jsonb_build_object('debt_id',v_debt.id,'name',v_debt.name,'progress_pct',v_debt_progress,
                             'outstanding',v_debt.outstanding_balance,'original',v_debt.original_amount),
          jsonb_build_object('evidence_type','debt_balance','metric_key','debt_progress','value',v_debt_progress),
          jsonb_build_object('key','debt_progress:open','type','review_debt',
                             'title','Ver a evolução','route','/app/dividas','priority',60)
        );
        v_detected := v_detected + 1;
      end if;
    end if;

  end if;

  -- 4.8 Compromissos recorrentes comparados à renda média.
  -- Regras e saldos atuais não podem vazar para uma leitura histórica.
  if _run_mode <> 'backtest' then
    select coalesce(sum(case frequency::text
      when 'weekly' then amount*4.345
      when 'biweekly' then amount*2.17
      when 'quarterly' then amount/3
      when 'yearly' then amount/12
      else amount end),0)
      into v_commitments
      from public.recurring_rules
     where user_id=_user_id and status='active' and kind::text='expense';

    select v_commitments + coalesce(sum(installment_amount),0) into v_commitments
      from public.debts where user_id=_user_id and status='active';
    v_commitments := coalesce(v_commitments,0)+coalesce(v_card_outstanding,0);

    if v_avg_income>0 and v_commitments/v_avg_income>=0.60 then
      perform public.nino_diag_put_situation(
        _user_id, _run_mode, v_run_id, _as_of,
        'recurring_commitment_pressure', 'commitment_pressure:' || to_char(v_period_start,'YYYY-MM'),
        'active', 'future', case when v_commitments/v_avg_income>=0.85 then 'critical' else 'attention' end, 0.78,
        v_period_start, (v_period_start + interval '1 month - 1 day')::date,
        v_commitments, v_avg_income, v_commitments-v_avg_income,
        (v_commitments/v_avg_income)*100, v_commitments,
        'Compromissos previstos consomem ' || public.nino_diag_pct((v_commitments/v_avg_income)*100) || ' da renda média',
        'A conta reúne recorrências, parcelas de dívida e faturas identificadas.',
        'Quanto menor a margem restante, maior o risco de depender de resgates ou crédito.',
        'Revise o calendário antes dos próximos vencimentos.', (_as_of + 14)::timestamptz,
        jsonb_build_object('monthly_commitments',v_commitments,'average_income_90d',v_avg_income),
        jsonb_build_object('evidence_type','commitments','metric_key','commitment_ratio','value',v_commitments),
        jsonb_build_object('key','commitments:review','type','review_commitments',
                           'title','Revisar compromissos','route','/app/recorrencias','priority',88)
      );
      v_detected := v_detected + 1;
    end if;

  end if;

  -- 4.9 Padrões comportamentais: somente com direção coerente e evidência mínima.
  for r in
    select * from public.behavioral_patterns
     where user_id=_user_id and status in ('candidate','validated','active','weakened')
       and confidence>=0.60 and data_coverage>=0.60 and sample_size>=6
       and coalesce(absolute_delta,0)>0
       and (_run_mode<>'backtest' or (window_end<=_as_of and created_at::date<=_as_of))
     order by confidence desc, abs(absolute_delta) desc limit 4
  loop
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'behavioral_pattern', 'behavioral_pattern:' || r.id::text,
      case when r.status in ('validated','active') then 'confirmed' else 'observed' end,
      'historical', 'info', r.confidence,
      r.window_start, r.window_end, r.pattern_value, r.baseline_value,
      r.absolute_delta, r.uplift_pct, abs(r.absolute_delta),
      r.label,
      'O comportamento apareceu em ' || r.sample_size || ' amostras, com confiança de '
        || public.nino_diag_pct(r.confidence*100) || '.',
      'O padrão só vira antecipação quando também existir uma oportunidade futura útil e acionável.',
      null, coalesce(r.expires_at, now()+interval '30 days'),
      jsonb_build_object('pattern_id',r.id,'detector',r.detector,'sample_size',r.sample_size,
                         'baseline',r.baseline_value,'observed',r.pattern_value,
                         'delta',r.absolute_delta,'uplift_pct',r.uplift_pct,
                         'coverage',r.data_coverage,'consistency',r.consistency),
      jsonb_build_object('evidence_type','behavioral_pattern','metric_key',r.detector,
                         'value',r.pattern_value,'contribution_amount',r.absolute_delta,
                         'contribution_pct',r.uplift_pct,'pattern_id',r.id),
      jsonb_build_object('key','pattern:understand','type','understand_pattern',
                         'title','Entender o padrão','route','/app/nino?section=aprendizados','priority',55)
    );
    v_detected := v_detected + 1;
  end loop;

  -- 4.10 Antecipações conectadas ao mesmo domínio de situação.
  for r in
    select * from public.anticipation_opportunities
     where user_id=_user_id and status in ('scheduled','ready','revalidating')
       and opportunity_date between _as_of and (_as_of+30)
       and (_run_mode<>'backtest' or created_at::date<=_as_of)
     order by utility_score desc, opportunity_date asc limit 4
  loop
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'anticipation', 'anticipation:' || r.id::text,
      'active', 'future',
      case when r.severity='critical' then 'critical' when r.severity='attention' then 'attention' else 'info' end,
      coalesce(r.confidence,0.5), _as_of, r.opportunity_date,
      r.expected_value, r.baseline_value,
      r.expected_value-r.baseline_value,
      case when r.baseline_value<>0 then ((r.expected_value-r.baseline_value)/abs(r.baseline_value))*100 else null end,
      abs(r.expected_value-r.baseline_value), r.title,
      r.body, 'A antecipação existe porque há um padrão validado e uma janela futura em que agir pode mudar o resultado.',
      'Janela útil: ' || to_char(r.window_start at time zone coalesce(r.timezone,'America/Sao_Paulo'),'DD/MM HH24:MI')
        || ' a ' || to_char(r.window_end at time zone coalesce(r.timezone,'America/Sao_Paulo'),'DD/MM HH24:MI') || '.',
      coalesce(r.window_end, (r.opportunity_date+1)::timestamptz),
      coalesce(r.evidence,'{}'::jsonb) || jsonb_build_object('opportunity_id',r.id,'pattern_id',r.pattern_id,
                                                            'utility_score',r.utility_score),
      jsonb_build_object('evidence_type','anticipation','metric_key',r.detector,'value',r.expected_value,
                         'contribution_amount',abs(r.expected_value-r.baseline_value),
                         'opportunity_id',r.id,'pattern_id',r.pattern_id),
      coalesce(r.action, jsonb_build_object('key','anticipation:act','type','anticipation_action',
                                            'title','Preparar agora','route','/app/nino?section=prepare-se','priority',90))
    );
    v_detected := v_detected + 1;
  end loop;

  -- 4.11 Qualidade de dados: operacional, nunca insight principal.
  select count(*)::int, coalesce(sum(amount),0)
    into v_uncategorized_count, v_uncategorized_amount
    from public.transactions
   where user_id=_user_id and status='confirmed' and type='expense'
     and coalesce(movement_kind,'transaction')='transaction'
     and category_id is null and occurred_at between v_period_start and _as_of;

  if v_uncategorized_count>0 then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'data_quality_issue', 'uncategorized:' || to_char(v_period_start,'YYYY-MM'),
      'observed', 'now', 'info', 1,
      v_period_start, _as_of, v_uncategorized_count, 0,
      v_uncategorized_count, null, v_uncategorized_amount,
      v_uncategorized_count || case when v_uncategorized_count=1 then ' lançamento sem categoria' else ' lançamentos sem categoria' end,
      'Eles somam ' || public.nino_diag_brl(v_uncategorized_amount) || ' e reduzem a precisão das análises por categoria.',
      'Classificar melhora as próximas leituras, mas não deve competir com a situação financeira principal.',
      null, (_as_of+14)::timestamptz,
      jsonb_build_object('uncategorized_count',v_uncategorized_count,'amount',v_uncategorized_amount),
      jsonb_build_object('evidence_type','data_quality','metric_key','uncategorized_count','value',v_uncategorized_count),
      jsonb_build_object('key','uncategorized:classify','type','classify_transactions',
                         'title','Classificar agora','route','/app/lancamentos?filtro=sem-categoria','priority',70)
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.12 Duplicidades agrupadas em uma única pendência operacional.
  with grouped as (
    select occurred_at, amount,
           coalesce(nullif(normalized_description,''),nullif(friendly_description,''),description) merchant,
           count(*)::int cnt,
           array_agg(id order by created_at) transaction_ids
      from public.transactions t
     where t.user_id=_user_id and t.status='confirmed' and t.type='expense'
       and coalesce(t.movement_kind,'transaction')='transaction'
       and t.occurred_at >= (_as_of-60)
     group by occurred_at, amount,
              coalesce(nullif(normalized_description,''),nullif(friendly_description,''),description)
    having count(*)>1
  ), undecided as (
    select g.*,
           public.nino_norm_text(g.merchant) || '::' || g.amount::text || '::' || g.occurred_at::text pair_key
      from grouped g
     where not exists (
       select 1 from public.nino_duplicate_decisions d
        where d.user_id=_user_id
          and d.pair_key=public.nino_norm_text(g.merchant) || '::' || g.amount::text || '::' || g.occurred_at::text
     )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'pair_key',pair_key,'merchant',merchant,'amount',amount,
           'occurred_at',occurred_at,'count',cnt,'transactions',transaction_ids
         ) order by occurred_at desc),'[]'::jsonb),
         count(*)::int,
         coalesce(sum(amount*(cnt-1)),0)
    into v_duplicate_pairs, v_duplicate_count, v_duplicate_amount
    from undecided;

  if v_duplicate_count>0 then
    perform public.nino_diag_put_situation(
      _user_id, _run_mode, v_run_id, _as_of,
      'duplicate_review', 'duplicate_review',
      'observed', 'now', 'info', 0.75,
      (_as_of-60), _as_of, v_duplicate_count, 0,
      v_duplicate_count, null, v_duplicate_amount,
      v_duplicate_count || case when v_duplicate_count=1 then ' possível duplicidade para revisar' else ' possíveis duplicidades para revisar' end,
      public.nino_diag_brl(v_duplicate_amount) || ' podem estar contados duas vezes.',
      'É uma pendência de qualidade dos dados, não um highlight comportamental.',
      null, (_as_of+21)::timestamptz,
      jsonb_build_object('pairs',v_duplicate_pairs,'pair_count',v_duplicate_count,'amount_at_risk',v_duplicate_amount),
      jsonb_build_object('evidence_type','duplicate_groups','metric_key','duplicate_pair_count','value',v_duplicate_count,
                         'pairs',v_duplicate_pairs),
      jsonb_build_object('key','duplicates:review','type','review_duplicates',
                         'title','Revisar duplicidades','route','/app/lancamentos?revisar=duplicidades','priority',72)
    );
    v_detected := v_detected + 1;
  end if;

  -- 4.13 Confirmações reais da Divisão do Rolê permanecem operacionais.
  -- Status atual de cobrança não é reescrito em backtests históricos.
  if _run_mode <> 'backtest' then
    for r in
      select p.id participant_id, p.name, p.amount_due, p.amount_paid, p.status,
             se.id shared_expense_id, se.title shared_expense_title
        from public.shared_expense_participants p
        join public.shared_expenses se on se.id=p.shared_expense_id
       where se.owner_user_id=_user_id and se.deleted_at is null
         and p.status in ('payment_reported','awaiting_owner_confirmation')
    loop
      perform public.nino_diag_put_situation(
        _user_id, _run_mode, v_run_id, _as_of,
        'shared_payment_confirmation', 'split_confirmation:' || r.participant_id::text,
        'active', 'now', 'attention', 1,
        _as_of, _as_of,
        greatest(coalesce(r.amount_due,0)-coalesce(r.amount_paid,0),0), 0,
        greatest(coalesce(r.amount_due,0)-coalesce(r.amount_paid,0),0), null,
        greatest(coalesce(r.amount_due,0)-coalesce(r.amount_paid,0),0),
        '1 pagamento aguardando sua confirmação',
        r.name || ' informou pagamento em “' || r.shared_expense_title || '”.',
        'Confirmar atualiza o valor a receber e encerra os lembretes daquele participante.',
        null, (_as_of+30)::timestamptz,
        jsonb_build_object('participant_id',r.participant_id,'shared_expense_id',r.shared_expense_id,'status',r.status),
        jsonb_build_object('evidence_type','shared_payment','metric_key','amount_due','value',
                           greatest(coalesce(r.amount_due,0)-coalesce(r.amount_paid,0),0)),
        jsonb_build_object('key','split:confirm','type','confirm_shared_payment',
                           'title','Confirmar pagamento','route','/app/divisao-do-role/' || r.shared_expense_id::text,'priority',96)
      );
      v_detected := v_detected + 1;
    end loop;

  end if;

  -- O que não foi revalidado nesta execução deixa de ser atual.
  update public.financial_situations
     set status='resolved', resolved_at=now(), updated_at=now()
   where user_id=_user_id and run_mode=_run_mode
     and status='observed'
     and temporal_scope in ('now','future')
     and last_evaluation_run_id is distinct from v_run_id;
  get diagnostics v_resolved = row_count;

  update public.financial_situations
     set status='expired', resolved_at=coalesce(resolved_at,now()), updated_at=now()
   where user_id=_user_id and run_mode=_run_mode
     and status not in ('resolved','expired','suppressed')
     and valid_until is not null and valid_until<now();

  update public.nino_diagnosis_runs
     set status='completed', situations_created=v_detected,
         situations_resolved=v_resolved, finished_at=now()
   where id=v_run_id;

  return jsonb_build_object('ok',true,'run_id',v_run_id,'detected',v_detected,
                            'resolved',v_resolved,'as_of',_as_of,'run_mode',_run_mode);
exception when others then
  update public.nino_diagnosis_runs
     set status='failed', error_message=sqlerrm, finished_at=now()
   where id=v_run_id;
  raise;
end $$;

-- ---------------------------------------------------------------------------
-- 5. DIAGNÓSTICO CONSOLIDADO E PROJEÇÕES
-- ---------------------------------------------------------------------------

create or replace function public.nino_assemble_diagnosis(
  _user_id uuid,
  _as_of date default current_date,
  _run_mode text default 'live'
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_primary public.financial_situations;
  v_supporting uuid[] := '{}'::uuid[];
  v_primary_action uuid;
  v_state text := 'stable';
  v_confidence numeric := 0;
  v_snapshot uuid;
  v_quality jsonb;
  v_payload jsonb;
  v_max_supporting int := 3;
  v_min_conf numeric := 0.60;
begin
  select max_supporting, min_primary_confidence
    into v_max_supporting, v_min_conf
    from public.nino_diagnosis_config where singleton=true;

  select * into v_primary
    from public.financial_situations s
   where s.user_id=_user_id and s.run_mode=_run_mode
     and s.status in ('active','confirmed','improving','worsening')
     -- Uma situação futura pode ser o assunto principal quando já exige decisão agora
     -- (ex.: pressão de caixa antes do vencimento). O score continua controlando a relevância.
     and s.temporal_scope in ('now','future')
     and s.situation_type not in ('data_quality_issue','duplicate_review','shared_payment_confirmation','behavioral_pattern')
     and s.confidence>=v_min_conf
     and (s.valid_until is null or s.valid_until>now())
   order by
     case s.severity when 'critical' then 4 when 'attention' then 3 when 'positive' then 2 else 1 end desc,
     s.relevance_score desc, s.updated_at desc
   limit 1;

  select coalesce(array_agg(id order by relevance_score desc),'{}'::uuid[])
    into v_supporting
    from (
      select s.id, s.relevance_score
        from public.financial_situations s
       where s.user_id=_user_id and s.run_mode=_run_mode
         and s.status in ('active','confirmed','improving','worsening')
         and s.temporal_scope in ('now','future')
         and (v_primary.id is null or s.id<>v_primary.id)
         and s.situation_type not in ('data_quality_issue','duplicate_review','shared_payment_confirmation')
         and (s.valid_until is null or s.valid_until>now())
       order by s.relevance_score desc
       limit v_max_supporting
    ) x;

  if v_primary.id is not null then
    select id into v_primary_action
      from public.financial_situation_actions
     where situation_id=v_primary.id and status in ('proposed','accepted','in_progress')
     order by priority desc, created_at desc limit 1;
    v_state := case v_primary.severity when 'critical' then 'critical'
              when 'attention' then 'attention'
              when 'positive' then 'positive' else 'stable' end;
    v_confidence := v_primary.confidence;
  elsif not exists (select 1 from public.transactions where user_id=_user_id and status='confirmed') then
    v_state := 'insufficient_data';
    v_confidence := 0;
  end if;

  select jsonb_build_object(
    'uncategorized_count', coalesce((select (evaluation->>'uncategorized_count')::int
      from public.financial_situations where user_id=_user_id and run_mode=_run_mode
       and situation_type='data_quality_issue' and status in ('observed','active') order by updated_at desc limit 1),0),
    'duplicate_groups', coalesce((select (evaluation->>'pair_count')::int
      from public.financial_situations where user_id=_user_id and run_mode=_run_mode
       and situation_type='duplicate_review' and status in ('observed','active') order by updated_at desc limit 1),0)
  ) into v_quality;

  select jsonb_build_object(
    'primary_situation', (select to_jsonb(s) from public.financial_situations s where s.id=v_primary.id),
    'primary_action', (select to_jsonb(a) from public.financial_situation_actions a where a.id=v_primary_action),
    'supporting_situations', coalesce((select jsonb_agg(to_jsonb(s) order by s.relevance_score desc)
      from public.financial_situations s where s.id=any(coalesce(v_supporting,'{}'::uuid[]))),'[]'::jsonb),
    'captured_at', now()
  ) into v_payload;

  if _run_mode='live' then
    update public.nino_diagnosis_snapshots set is_current=false
     where user_id=_user_id and run_mode='live' and is_current;
  end if;

  insert into public.nino_diagnosis_snapshots(
    user_id, run_mode, as_of, overall_state, primary_situation_id,
    supporting_situation_ids, primary_action_id, forecast, data_quality,
    confidence, rationale, payload, contract_version, is_current
  ) values (
    _user_id, _run_mode, _as_of, v_state, v_primary.id,
    coalesce(v_supporting,'{}'::uuid[]), v_primary_action,
    jsonb_build_object('summary',v_primary.forecast_summary), v_quality,
    v_confidence,
    jsonb_build_object('primary_score',v_primary.relevance_score,
                       'primary_type',v_primary.situation_type,
                       'supporting_count',coalesce(array_length(v_supporting,1),0)),
    coalesce(v_payload,'{}'::jsonb),
    'nino_diagnosis_contract.v1', _run_mode='live'
  ) returning id into v_snapshot;

  return v_snapshot;
end $$;

create or replace function public.nino_project_diagnosis(
  _user_id uuid,
  _snapshot_id uuid
) returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_count int := 0;
  r record;
  v_kind public.nino_item_kind;
  v_role public.nino_temporal_role;
  v_category text;
  v_action jsonb;
  v_evidence jsonb;
  v_group_size int;
begin
  -- Legado deixa de disputar a verdade atual. Nada é apagado.
  update public.nino_intelligence_items
     set status='superseded', superseded_at=now(),
         suppression_reason=coalesce(suppression_reason,'superseded_by_diagnosis_core_v1'),
         updated_at=now()
   where user_id=_user_id and status='active' and source<>'financial_diagnosis';

  update public.nino_intelligence_items
     set status='superseded', superseded_at=now(), updated_at=now()
   where user_id=_user_id and status='active' and source='financial_diagnosis';

  for r in
    select s.*,
           a.id action_id, a.title action_title, a.route action_route,
           a.action_type, a.explanation action_explanation,
           e.metadata evidence_metadata
      from public.financial_situations s
      left join lateral (
        select * from public.financial_situation_actions x
         where x.situation_id=s.id and x.status in ('proposed','accepted','in_progress')
         order by x.priority desc limit 1
      ) a on true
      left join lateral (
        select metadata from public.financial_situation_evidence x
         where x.situation_id=s.id order by x.created_at desc limit 1
      ) e on true
     where s.user_id=_user_id and s.run_mode='live'
       and s.status in ('active','confirmed','improving','worsening','observed')
       and (s.valid_until is null or s.valid_until>now())
       and (
         s.temporal_scope in ('now','future')
         or (s.situation_type in ('behavioral_pattern','debt_progress') and s.temporal_scope='historical')
       )
     order by s.relevance_score desc
  loop
    v_kind := case r.situation_type
      when 'cash_flow_imbalance' then 'risk'::public.nino_item_kind
      when 'liquidity_pressure' then 'risk'::public.nino_item_kind
      when 'card_cycle_pressure' then 'risk'::public.nino_item_kind
      when 'goal_feasibility' then 'risk'::public.nino_item_kind
      when 'investment_drawdown' then 'risk'::public.nino_item_kind
      when 'recurring_commitment_pressure' then 'risk'::public.nino_item_kind
      when 'spending_pace_change' then 'change'::public.nino_item_kind
      when 'category_shift' then 'change'::public.nino_item_kind
      when 'debt_progress' then 'achievement'::public.nino_item_kind
      when 'behavioral_pattern' then 'pattern'::public.nino_item_kind
      when 'anticipation' then case when r.severity in ('critical','attention') then 'risk'::public.nino_item_kind else 'opportunity'::public.nino_item_kind end
      when 'shared_payment_confirmation' then 'pending_confirmation'::public.nino_item_kind
      else 'data_quality'::public.nino_item_kind
    end;

    v_role := case r.temporal_scope when 'future' then 'future'::public.nino_temporal_role
              when 'historical' then 'historical'::public.nino_temporal_role
              else 'now'::public.nino_temporal_role end;

    v_category := case when r.situation_type in ('data_quality_issue','duplicate_review','shared_payment_confirmation')
                       then 'operational' else 'intelligence' end;

    v_action := case when r.action_route is null then null else jsonb_build_object(
      'label',r.action_title,'route',r.action_route,'type',r.action_type,
      'action_id',r.action_id) end;
    v_evidence := coalesce(r.evaluation,'{}'::jsonb)
      || coalesce(r.evidence_metadata,'{}'::jsonb)
      || jsonb_build_object('situation_id',r.id,'diagnosis_snapshot_id',_snapshot_id,
                            'situation_type',r.situation_type,'relevance_score',r.relevance_score);
    v_group_size := greatest(1,coalesce((r.evaluation->>'pair_count')::int,1));

    insert into public.nino_intelligence_items(
      user_id, kind, temporal_role, status, priority, severity,
      title, summary, explanation, facts, evidence,
      primary_action, source, source_period_start, source_period_end,
      valid_from, valid_until, confidence, data_quality,
      dedup_key, formula_version, narrative_version, created_by,
      logical_topic_key, category, group_key, group_size,
      impact_amount, impact_pct, selection_reason,
      superseded_at, suppression_reason, updated_at
    ) values (
      _user_id, v_kind, v_role, 'active', r.relevance_score,
      case r.severity when 'critical' then 'critical' when 'attention' then 'attention' else 'info' end,
      r.headline, coalesce(r.cause_summary,''),
      trim(coalesce(r.consequence_summary,'') || case when r.forecast_summary is not null then ' '||r.forecast_summary else '' end),
      '[]'::jsonb, v_evidence, v_action, 'financial_diagnosis',
      r.period_start, r.period_end, r.valid_from, r.valid_until,
      r.confidence, case when v_category='operational' then 'attention' else 'ok' end,
      'diagnosis:situation:'||r.id::text, 'financial_situation.v1',
      'nino_diagnosis_narrative.v1','diagnosis_core',
      'situation:'||r.situation_key, v_category,
      case when r.situation_type='duplicate_review' then 'duplicate_review_summary' else r.situation_type end,
      v_group_size, r.impact_amount, r.percentage_delta,
      jsonb_build_object('diagnosis_snapshot_id',_snapshot_id,'score',r.relevance_score,
                         'situation_type',r.situation_type,'confidence',r.confidence),
      null, null, now()
    )
    on conflict (user_id,dedup_key) do update set
      kind=excluded.kind, temporal_role=excluded.temporal_role, status='active',
      priority=excluded.priority, severity=excluded.severity,
      title=excluded.title, summary=excluded.summary, explanation=excluded.explanation,
      evidence=excluded.evidence, primary_action=excluded.primary_action,
      source_period_start=excluded.source_period_start,
      source_period_end=excluded.source_period_end,
      valid_from=excluded.valid_from, valid_until=excluded.valid_until,
      confidence=excluded.confidence, data_quality=excluded.data_quality,
      formula_version=excluded.formula_version,
      narrative_version=excluded.narrative_version,
      logical_topic_key=excluded.logical_topic_key, category=excluded.category,
      group_key=excluded.group_key, group_size=excluded.group_size,
      impact_amount=excluded.impact_amount, impact_pct=excluded.impact_pct,
      selection_reason=excluded.selection_reason,
      superseded_at=null, suppression_reason=null, updated_at=now();
    v_count := v_count+1;
  end loop;

  return v_count;
end $$;

create or replace function public.nino_project_diagnosis_communications(
  _user_id uuid,
  _snapshot_id uuid
) returns integer
language plpgsql security definer set search_path=public as $$
declare r record; v_count int:=0; v_action jsonb; v_channel text; v_communication_mode text;
begin
  select communication_mode into v_communication_mode
    from public.nino_diagnosis_config where singleton=true;
  if coalesce(v_communication_mode,'disabled')='disabled' then return 0; end if;

  update public.pending_proactive_suggestions
     set status='dismissed', defer_reason='superseded_by_diagnosis_core_v1'
   where user_id=_user_id and status in ('pending','ready','deferred')
     and dedup_key not like 'diagnosis:%';

  for r in
    select s.*, a.title action_title, a.route action_route, a.action_type
      from public.financial_situations s
      join public.financial_situation_actions a on a.situation_id=s.id
       and a.status in ('proposed','accepted','in_progress')
     where s.user_id=_user_id and s.run_mode='live'
       and s.status in ('active','worsening','confirmed')
       and s.confidence>=0.70 and s.relevance_score>=70
       and (s.temporal_scope='future' or s.severity='critical')
       and (s.valid_until is null or s.valid_until>now())
     order by s.relevance_score desc limit 2
  loop
    v_action := jsonb_build_object('label',r.action_title,'route',r.action_route,'type',r.action_type,
                                   'situation_id',r.id,'diagnosis_snapshot_id',_snapshot_id);
    v_channel := case
      when v_communication_mode='full'
       and (r.severity='critical' or (r.temporal_scope='future' and r.valid_until<=now()+interval '48 hours'))
      then 'both'
      else 'app'
    end;

    insert into public.pending_proactive_suggestions(
      user_id, kind, severity, title, body, action, evidence,
      channel_ready, dedup_key, logical_dedup_key, status,
      expires_at, next_attempt_at
    ) values (
      _user_id, r.situation_type,
      case r.severity when 'critical' then 'critical' when 'attention' then 'attention' else 'info' end,
      r.headline,
      trim(coalesce(r.cause_summary,'') || case when r.forecast_summary is not null then ' '||r.forecast_summary else '' end),
      v_action,
      r.evaluation || jsonb_build_object('situation_id',r.id,'diagnosis_snapshot_id',_snapshot_id),
      v_channel,
      'diagnosis:'||r.situation_key,
      'diagnosis:'||r.situation_key,
      'pending', coalesce(r.valid_until,now()+interval '3 days'), now()
    )
    on conflict (user_id,dedup_key) do update set
      title=excluded.title, body=excluded.body, action=excluded.action,
      evidence=excluded.evidence, channel_ready=excluded.channel_ready,
      severity=excluded.severity, expires_at=excluded.expires_at,
      status=case when public.pending_proactive_suggestions.status='dispatched'
                  then 'dispatched' else 'pending' end,
      next_attempt_at=case when public.pending_proactive_suggestions.status='dispatched'
                           then public.pending_proactive_suggestions.next_attempt_at else now() end;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.nino_refresh_diagnosis(
  _user_id uuid,
  _as_of date default current_date,
  _run_mode text default 'live',
  _source text default 'engine'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_eval jsonb;
  v_snapshot uuid;
  v_projected int:=0;
  v_communications int:=0;
begin
  v_eval := public.nino_evaluate_financial_situations(_user_id,_as_of,_run_mode,_source);
  v_snapshot := public.nino_assemble_diagnosis(_user_id,_as_of,_run_mode);
  if _run_mode='live' then
    v_projected := public.nino_project_diagnosis(_user_id,v_snapshot);
    v_communications := public.nino_project_diagnosis_communications(_user_id,v_snapshot);
  end if;
  update public.nino_diagnosis_runs
     set projected_items=v_projected, finished_at=coalesce(finished_at,now())
   where id=(v_eval->>'run_id')::uuid;
  return v_eval || jsonb_build_object('snapshot_id',v_snapshot,'projected_items',v_projected,
                                      'communications',v_communications);
end $$;

-- Contrato canônico direto, útil para novas superfícies, agente e auditoria.
create or replace function public.nino_diagnosis_context_for_user(_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_snapshot public.nino_diagnosis_snapshots;
  v_enabled boolean;
  v_mode text;
begin
  if _user_id is null then return jsonb_build_object('ok',false,'error','missing_user'); end if;
  select enabled, rollout_mode into v_enabled, v_mode
    from public.nino_diagnosis_config where singleton=true;
  if not coalesce(v_enabled,false) or v_mode='legacy' then
    return jsonb_build_object('ok',true,'contract','nino_diagnosis_contract.v1',
      'mode','legacy','snapshot_id',null,'as_of',now(),'overall_state','insufficient_data',
      'primary_situation',null,'supporting_situations','[]'::jsonb,'primary_action',null,
      'patterns','[]'::jsonb,'anticipations','[]'::jsonb,'operational_tasks','[]'::jsonb,
      'forecast','{}'::jsonb,'data_quality','{}'::jsonb,'confidence',0,
      'rationale','{}'::jsonb,'snapshot_payload','{}'::jsonb);
  end if;
  select * into v_snapshot from public.nino_diagnosis_snapshots
   where user_id=_user_id and run_mode='live' and is_current
   order by created_at desc limit 1;
  if v_snapshot.id is null then
    return jsonb_build_object('ok',true,'contract','nino_diagnosis_contract.v1',
      'snapshot_id',null,'as_of',now(),'overall_state','insufficient_data','primary_situation',null,
      'supporting_situations','[]'::jsonb,'primary_action',null,
      'patterns','[]'::jsonb,'anticipations','[]'::jsonb,
      'operational_tasks','[]'::jsonb,'forecast','{}'::jsonb,
      'data_quality','{}'::jsonb,'confidence',0,'rationale','{}'::jsonb,
      'snapshot_payload','{}'::jsonb);
  end if;
  return jsonb_build_object(
    'ok',true,'contract',v_snapshot.contract_version,'snapshot_id',v_snapshot.id,
    'as_of',v_snapshot.created_at,'overall_state',v_snapshot.overall_state,
    'primary_situation',(select to_jsonb(s) from public.financial_situations s where s.id=v_snapshot.primary_situation_id),
    'supporting_situations',coalesce((select jsonb_agg(to_jsonb(s) order by s.relevance_score desc)
      from public.financial_situations s where s.id=any(v_snapshot.supporting_situation_ids)),'[]'::jsonb),
    'primary_action',(select to_jsonb(a) from public.financial_situation_actions a where a.id=v_snapshot.primary_action_id),
    'patterns',coalesce((select jsonb_agg(to_jsonb(s) order by s.relevance_score desc)
      from public.financial_situations s where s.user_id=_user_id and s.run_mode='live'
       and s.situation_type='behavioral_pattern' and s.status in ('observed','confirmed','active')),'[]'::jsonb),
    'anticipations',coalesce((select jsonb_agg(to_jsonb(s) order by s.period_end)
      from public.financial_situations s where s.user_id=_user_id and s.run_mode='live'
       and s.situation_type='anticipation' and s.status in ('active','confirmed')),'[]'::jsonb),
    'operational_tasks',coalesce((select jsonb_agg(to_jsonb(s) order by s.relevance_score desc)
      from public.financial_situations s where s.user_id=_user_id and s.run_mode='live'
       and s.situation_type in ('data_quality_issue','duplicate_review','shared_payment_confirmation')
       and s.status in ('observed','active','confirmed')),'[]'::jsonb),
    'forecast',v_snapshot.forecast,'data_quality',v_snapshot.data_quality,
    'confidence',v_snapshot.confidence,'rationale',v_snapshot.rationale,
    'snapshot_payload',v_snapshot.payload
  );
end $$;

create or replace function public.my_nino_diagnosis_context()
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_uid uuid:=auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  return public.nino_diagnosis_context_for_user(v_uid);
end $$;

-- Feedback e ações fecham o ciclo de aprendizado no domínio de situações.
create or replace function public.my_nino_item_act(_item_id uuid, _surface text default 'nino')
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_situation_id uuid; v_opportunity_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  update public.nino_intelligence_items
     set acted_at=coalesce(acted_at,now()), updated_at=now()
   where id=_item_id and user_id=v_uid
   returning nullif(evidence->>'situation_id','')::uuid,
             nullif(evidence->>'opportunity_id','')::uuid
        into v_situation_id,v_opportunity_id;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;

  insert into public.nino_item_exposures(user_id,item_id,surface,acted_at,outcome,shown_at)
  values(v_uid,_item_id,_surface,now(),'acted',now());

  if v_situation_id is not null then
    insert into public.financial_situation_feedback(user_id,situation_id,item_id,surface,feedback)
    values(v_uid,v_situation_id,_item_id,_surface,'acted');
    update public.financial_situation_actions
       set status=case when status='proposed' then 'accepted' else status end, updated_at=now()
     where situation_id=v_situation_id and status in ('proposed','accepted','in_progress');
  end if;
  if v_opportunity_id is not null then
    update public.anticipation_outcomes set acted=true,updated_at=now()
     where user_id=v_uid and opportunity_id=v_opportunity_id;
  end if;
  return jsonb_build_object('ok',true,'situation_id',v_situation_id);
end $$;

-- Preserva a decisão de duplicidade legada antes de substituir o RPC público.
do $$
begin
  if to_regprocedure('public.my_nino_duplicate_decision_legacy(text,text)') is null
     and to_regprocedure('public.my_nino_duplicate_decision(text,text)') is not null then
    alter function public.my_nino_duplicate_decision(text,text) rename to my_nino_duplicate_decision_legacy;
  end if;
end $$;

create or replace function public.my_nino_duplicate_decision(_pair_key text, _decision text)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_result jsonb; v_enabled boolean; v_mode text;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  select enabled,rollout_mode into v_enabled,v_mode from public.nino_diagnosis_config where singleton=true;
  if not coalesce(v_enabled,false) or v_mode='legacy' then
    return public.my_nino_duplicate_decision_legacy(_pair_key,_decision);
  end if;
  if coalesce(_pair_key,'')='' or _decision not in ('distinct','duplicate','ignored') then
    return jsonb_build_object('ok',false,'error','invalid_input');
  end if;
  insert into public.nino_duplicate_decisions(user_id,pair_key,decision)
  values(v_uid,_pair_key,_decision)
  on conflict(user_id,pair_key) do update set decision=excluded.decision,updated_at=now();

  v_result:=public.nino_refresh_diagnosis(v_uid,current_date,'live','duplicate_decision');
  return jsonb_build_object('ok',true,'pair_key',_pair_key,'decision',_decision,
                            'diagnosis_snapshot_id',v_result->>'snapshot_id');
end $$;

create or replace function public.my_nino_item_feedback(
  _item_id uuid,
  _feedback text,
  _surface text default 'nino'
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_situation_id uuid; v_opportunity_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  if _feedback not in ('useful','not_useful','dismiss') then
    return jsonb_build_object('ok',false,'error','invalid_feedback');
  end if;
  select nullif(evidence->>'situation_id','')::uuid,
         nullif(evidence->>'opportunity_id','')::uuid
    into v_situation_id,v_opportunity_id
    from public.nino_intelligence_items where id=_item_id and user_id=v_uid;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;

  insert into public.nino_item_exposures(user_id,item_id,surface,feedback,outcome,shown_at)
  values(v_uid,_item_id,_surface,_feedback,_feedback,now());

  if v_situation_id is not null then
    insert into public.financial_situation_feedback(user_id,situation_id,item_id,surface,feedback)
    values(v_uid,v_situation_id,_item_id,_surface,_feedback);
  end if;
  if v_opportunity_id is not null then
    update public.anticipation_outcomes
       set user_feedback=_feedback, interacted=true, updated_at=now()
     where user_id=v_uid and opportunity_id=v_opportunity_id;
  end if;
  if _feedback='dismiss' then
    update public.nino_intelligence_items
       set status='dismissed',dismissed_at=now(),updated_at=now()
     where id=_item_id and user_id=v_uid;
    if v_situation_id is not null then
      update public.financial_situations
         set status='suppressed',resolved_at=now(),updated_at=now()
       where id=v_situation_id and user_id=v_uid;
      update public.financial_situation_actions
         set status='dismissed',updated_at=now()
       where situation_id=v_situation_id and status in ('proposed','accepted','in_progress');
    end if;
  end if;
  return jsonb_build_object('ok',true,'situation_id',v_situation_id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. COMPATIBILIDADE, TICK, BACKTEST E ROLLBACK
-- ---------------------------------------------------------------------------

-- Preserva as funções legadas para rollback sem depender de um novo deploy.
do $$
begin
  if to_regprocedure('public.nino_legacy_rebuild_items(uuid,text)') is null
     and to_regprocedure('public.nino_rebuild_items(uuid,text)') is not null then
    alter function public.nino_rebuild_items(uuid,text) rename to nino_legacy_rebuild_items;
  end if;
  if to_regprocedure('public.nino_legacy_intelligence_tick()') is null
     and to_regprocedure('public.nino_intelligence_tick()') is not null then
    alter function public.nino_intelligence_tick() rename to nino_legacy_intelligence_tick;
  end if;
  if to_regprocedure('public.my_nino_refresh_legacy()') is null
     and to_regprocedure('public.my_nino_refresh()') is not null then
    alter function public.my_nino_refresh() rename to my_nino_refresh_legacy;
  end if;
end $$;

create or replace function public.nino_rebuild_items(
  _user_id uuid,
  _created_by text default 'engine'
) returns integer
language plpgsql security definer set search_path=public as $$
declare v_enabled boolean; v_mode text; v_result jsonb;
begin
  select enabled,rollout_mode into v_enabled,v_mode from public.nino_diagnosis_config where singleton=true;
  if not coalesce(v_enabled,false) or v_mode='legacy' then
    return public.nino_legacy_rebuild_items(_user_id,_created_by);
  end if;
  v_result:=public.nino_refresh_diagnosis(_user_id,current_date,
    case when v_mode='shadow' then 'shadow' else 'live' end,_created_by);
  return coalesce((v_result->>'projected_items')::int,0);
end $$;

create or replace function public.my_nino_refresh()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid:=auth.uid();
  v_result jsonb;
  v_active int;
  v_enabled boolean;
  v_mode text;
begin
  if v_uid is null then return jsonb_build_object('ok',false,'error','unauthenticated'); end if;
  select enabled,rollout_mode into v_enabled,v_mode from public.nino_diagnosis_config where singleton=true;
  if not coalesce(v_enabled,false) or v_mode='legacy' then
    return public.my_nino_refresh_legacy();
  end if;
  v_result:=public.nino_refresh_diagnosis(v_uid,current_date,'live','manual');
  select count(*)::int into v_active from public.nino_intelligence_items
   where user_id=v_uid and source='financial_diagnosis' and status='active';
  return jsonb_build_object(
    'ok',true,'at',now(),'items',v_active,'facts_processed',coalesce((v_result->>'detected')::int,0),
    'counts',jsonb_build_object(
      'created',coalesce((v_result->>'detected')::int,0),
      'updated',0,'superseded',coalesce((v_result->>'resolved')::int,0),
      'expired',0,'grouped',0,'suppressed',0,'active_total',v_active
    ),
    'diagnosis_snapshot_id',v_result->>'snapshot_id',
    'communications',coalesce((v_result->>'communications')::int,0),
    'contract','nino_diagnosis_contract.v1'
  );
end $$;

create or replace function public.nino_diagnosis_tick()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare r record; v_ok int:=0; v_failed int:=0; v_errors jsonb:='[]'::jsonb;
begin
  for r in select id from auth.users loop
    begin
      perform public.nino_refresh_diagnosis(r.id,current_date,'live','scheduled');
      v_ok:=v_ok+1;
    exception when others then
      v_failed:=v_failed+1;
      v_errors:=v_errors||jsonb_build_object('user_id',r.id,'error',sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok',v_failed=0,'processed',v_ok,'failed',v_failed,'errors',v_errors,
                            'contract','nino_diagnosis_contract.v1','at',now());
end $$;

create or replace function public.nino_intelligence_tick()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_enabled boolean; v_mode text;
begin
  select enabled,rollout_mode into v_enabled,v_mode from public.nino_diagnosis_config where singleton=true;
  if not coalesce(v_enabled,false) or v_mode='legacy' then
    return public.nino_legacy_intelligence_tick();
  end if;
  if v_mode='shadow' then
    return jsonb_build_object('ok',true,'mode','shadow','note','Use nino_diagnosis_backtest para homologação histórica.');
  end if;
  return public.nino_diagnosis_tick();
end $$;

create or replace function public.nino_diagnosis_backtest(
  _user_id uuid,
  _from date,
  _to date,
  _step_days int default 7
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d date; v_count int:=0; v_snapshots jsonb:='[]'::jsonb; v_result jsonb; v_snapshot uuid;
begin
  if current_user not in ('postgres','service_role','supabase_admin')
     and auth.uid() is distinct from _user_id
     and not exists (select 1 from public.user_roles where user_id=auth.uid() and role::text in ('admin','platform_admin')) then
    raise exception 'forbidden';
  end if;
  if _from is null or _to is null or _from>_to then raise exception 'invalid backtest range'; end if;
  if _step_days<1 or _step_days>31 then raise exception 'step_days must be between 1 and 31'; end if;
  delete from public.nino_diagnosis_snapshots where user_id=_user_id and run_mode='backtest' and as_of between _from and _to;
  delete from public.financial_situations where user_id=_user_id and run_mode='backtest'
    and period_end between _from and _to;
  for d in select generate_series(_from::timestamp,_to::timestamp,make_interval(days=>_step_days))::date loop
    v_result:=public.nino_evaluate_financial_situations(_user_id,d,'backtest','backtest');
    v_snapshot:=public.nino_assemble_diagnosis(_user_id,d,'backtest');
    v_snapshots:=v_snapshots||jsonb_build_object(
      'as_of',d,'snapshot_id',v_snapshot,
      'overall_state',(select overall_state from public.nino_diagnosis_snapshots where id=v_snapshot),
      'primary_headline',(select s.headline from public.nino_diagnosis_snapshots n
        left join public.financial_situations s on s.id=n.primary_situation_id where n.id=v_snapshot)
    );
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('ok',true,'runs',v_count,'from',_from,'to',_to,'snapshots',v_snapshots);
end $$;

create or replace function public.nino_diagnosis_rollback()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_restored int:=0;
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    if v_uid is null then raise exception 'unauthenticated'; end if;
    if not exists (select 1 from public.user_roles where user_id=v_uid and role::text in ('admin','platform_admin')) then
      raise exception 'forbidden';
    end if;
  end if;
  update public.nino_diagnosis_config
     set enabled=false,rollout_mode='legacy',communication_mode='disabled',updated_at=now()
   where singleton=true;
  update public.nino_intelligence_items
     set status='superseded',superseded_at=now(),updated_at=now()
   where source='financial_diagnosis' and status='active';
  update public.nino_intelligence_items
     set status='active',superseded_at=null,suppression_reason=null,updated_at=now()
   where status='superseded' and suppression_reason='superseded_by_diagnosis_core_v1'
     and (valid_until is null or valid_until>now());
  get diagnostics v_restored=row_count;
  update public.pending_proactive_suggestions
     set status='dismissed',defer_reason='diagnosis_core_rollback'
   where dedup_key like 'diagnosis:%' and status in ('pending','ready','deferred');
  return jsonb_build_object('ok',true,'mode','legacy','legacy_items_restored',v_restored,'at',now());
end $$;

-- Segurança das funções públicas e internas.
revoke all on function public.nino_legacy_rebuild_items(uuid,text) from public, anon, authenticated;
revoke all on function public.nino_legacy_intelligence_tick() from public, anon, authenticated;
revoke all on function public.my_nino_refresh_legacy() from public, anon, authenticated;
revoke all on function public.my_nino_duplicate_decision_legacy(text,text) from public, anon, authenticated;
revoke all on function public.nino_diagnosis_context_for_user(uuid) from public, anon, authenticated;
revoke all on function public.my_nino_diagnosis_context() from public, anon;
revoke all on function public.my_nino_refresh() from public, anon;
revoke all on function public.my_nino_item_act(uuid,text) from public, anon;
revoke all on function public.my_nino_item_feedback(uuid,text,text) from public, anon;
revoke all on function public.my_nino_duplicate_decision(text,text) from public, anon;
revoke all on function public.nino_diagnosis_backtest(uuid,date,date,int) from public, anon;
revoke all on function public.nino_diagnosis_rollback() from public, anon;
revoke all on function public.nino_guard_diagnosis_snapshot_immutable() from public, anon, authenticated;
revoke all on function public.nino_guard_legacy_surface_write() from public, anon, authenticated;
revoke all on function public.nino_guard_legacy_proactive_write() from public, anon, authenticated;
revoke all on function public.nino_diag_put_situation(uuid,text,uuid,date,text,text,text,text,text,numeric,date,date,numeric,numeric,numeric,numeric,numeric,text,text,text,text,timestamptz,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.nino_evaluate_financial_situations(uuid,date,text,text) from public, anon, authenticated;
revoke all on function public.nino_assemble_diagnosis(uuid,date,text) from public, anon, authenticated;
revoke all on function public.nino_project_diagnosis(uuid,uuid) from public, anon, authenticated;
revoke all on function public.nino_project_diagnosis_communications(uuid,uuid) from public, anon, authenticated;
revoke all on function public.nino_refresh_diagnosis(uuid,date,text,text) from public, anon, authenticated;
revoke all on function public.nino_diagnosis_tick() from public, anon, authenticated;
revoke all on function public.nino_intelligence_tick() from public, anon, authenticated;
revoke all on function public.nino_rebuild_items(uuid,text) from public, anon, authenticated;
grant execute on function public.nino_diagnosis_context_for_user(uuid) to service_role;
grant execute on function public.my_nino_diagnosis_context() to authenticated;
grant execute on function public.my_nino_refresh() to authenticated;
grant execute on function public.my_nino_item_act(uuid,text) to authenticated;
grant execute on function public.my_nino_item_feedback(uuid,text,text) to authenticated;
grant execute on function public.my_nino_duplicate_decision(text,text) to authenticated;
grant execute on function public.nino_diagnosis_backtest(uuid,date,date,int) to authenticated;
grant execute on function public.nino_diagnosis_rollback() to authenticated;
grant execute on function public.nino_diagnosis_tick() to service_role;
grant execute on function public.nino_intelligence_tick() to service_role;
grant execute on function public.nino_rebuild_items(uuid,text) to service_role;

-- Stage 6: filas legadas deixam de alimentar novas comunicações. Mantém histórico.
update public.pending_proactive_suggestions
   set status='dismissed', defer_reason='superseded_by_diagnosis_core_v1'
 where status in ('pending','ready','deferred')
   and dedup_key not like 'diagnosis:%';

-- Backfill inicial em produção. A migration é atômica: qualquer falha por usuário
-- impede o commit, evitando publicar um núcleo parcialmente inicializado.
do $$
declare
  v_result jsonb;
  v_users int;
  v_processed int;
  v_failed int;
begin
  select count(*)::int into v_users from auth.users;
  v_result := public.nino_diagnosis_tick();
  v_processed := coalesce((v_result->>'processed')::int, 0);
  v_failed := coalesce((v_result->>'failed')::int, 0);

  if v_failed > 0 then
    raise exception 'nino_diagnosis_initialization_failed: %', v_result;
  end if;
  if v_users > 0 and v_processed <> v_users then
    raise exception 'nino_diagnosis_initialization_incomplete: users=%, processed=%, result=%',
      v_users, v_processed, v_result;
  end if;
end $$;

-- O núcleo só se torna a fonte ativa depois de todos os usuários terem sido
-- inicializados com sucesso. WhatsApp proativo permanece em app_only até a
-- homologação operacional; a capacidade full já está instalada e versionada.
update public.nino_diagnosis_config
   set rollout_mode='active', communication_mode='app_only', updated_at=now()
 where singleton=true;

commit;
