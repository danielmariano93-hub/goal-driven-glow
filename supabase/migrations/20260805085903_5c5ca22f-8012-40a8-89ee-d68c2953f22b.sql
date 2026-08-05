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
grant all on public.financial_situations, public.financial_situation_evidence,
  public.financial_situation_actions, public.financial_situation_feedback, public.nino_diagnosis_snapshots,
  public.nino_diagnosis_runs, public.nino_diagnosis_config to service_role;

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