-- behavioral_evolution.v1 — emotion -> action -> habit -> learning
-- Three product waves in one coherent contract:
-- 1) quantified money mood + behavioral wheel
-- 2) experiments/habits with measurable progress
-- 3) evidence-ready behavioral coaching and proactive signals

begin;

-- ---------------------------------------------------------------------------
-- Wave 1 — richer emotional check-in, still non-clinical
-- ---------------------------------------------------------------------------
alter table public.emotional_checkins
  add column if not exists financial_calm_score smallint,
  add column if not exists financial_control_score smallint,
  add column if not exists spending_urge_score smallint,
  add column if not exists context_key text,
  add column if not exists measurement_version text not null default 'money_mood.v1';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'emotional_checkins_calm_score_check') then
    alter table public.emotional_checkins add constraint emotional_checkins_calm_score_check
      check (financial_calm_score is null or financial_calm_score between 0 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'emotional_checkins_control_score_check') then
    alter table public.emotional_checkins add constraint emotional_checkins_control_score_check
      check (financial_control_score is null or financial_control_score between 0 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'emotional_checkins_urge_score_check') then
    alter table public.emotional_checkins add constraint emotional_checkins_urge_score_check
      check (spending_urge_score is null or spending_urge_score between 0 and 10);
  end if;
end $$;

create index if not exists emotional_checkins_user_occurred_desc_idx
  on public.emotional_checkins(user_id, occurred_at desc);

-- Self-perception wheel. Scores are intentionally user-declared; observed
-- evidence is displayed next to them rather than silently pretending to be a
-- psychological score.
create table if not exists public.behavioral_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scores jsonb not null,
  overall_score numeric(4,2) not null,
  source text not null default 'self_assessment',
  version text not null default 'behavior_wheel.v1',
  created_at timestamptz not null default now(),
  constraint behavioral_assessments_overall_check check (overall_score between 0 and 10)
);
create index if not exists behavioral_assessments_user_created_idx
  on public.behavioral_assessments(user_id, created_at desc);

alter table public.behavioral_assessments enable row level security;
drop policy if exists behavioral_assessments_select_own on public.behavioral_assessments;
create policy behavioral_assessments_select_own on public.behavioral_assessments
  for select using (auth.uid() = user_id);
drop policy if exists behavioral_assessments_insert_own on public.behavioral_assessments;
create policy behavioral_assessments_insert_own on public.behavioral_assessments
  for insert with check (auth.uid() = user_id);

create or replace function public.behavioral_assessment_save(p_scores jsonb)
returns public.behavioral_assessments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_required text[] := array['awareness','planning','control','consistency','security','wealth','calm','debt'];
  v_key text;
  v_value numeric;
  v_total numeric := 0;
  v_row public.behavioral_assessments;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  foreach v_key in array v_required loop
    if not (p_scores ? v_key) then raise exception 'missing_dimension:%', v_key; end if;
    begin
      v_value := (p_scores ->> v_key)::numeric;
    exception when others then
      raise exception 'invalid_dimension:%', v_key;
    end;
    if v_value < 0 or v_value > 10 then raise exception 'dimension_out_of_range:%', v_key; end if;
    v_total := v_total + v_value;
  end loop;

  insert into public.behavioral_assessments(user_id, scores, overall_score)
  values (v_uid, p_scores, round(v_total / array_length(v_required, 1), 2))
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.behavioral_assessment_save(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Wave 2 — experiments instead of generic tasks
-- ---------------------------------------------------------------------------
create table if not exists public.behavior_experiment_templates (
  slug text primary key,
  title text not null,
  description text not null,
  dimension text not null,
  tracking_kind text not null,
  target_value numeric not null,
  duration_days integer not null,
  xp_reward integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint behavior_experiment_templates_tracking_check check (tracking_kind in ('checkin_count','no_spend_days','spend_reduction_pct','manual')),
  constraint behavior_experiment_templates_duration_check check (duration_days between 1 and 90)
);

insert into public.behavior_experiment_templates(slug,title,description,dimension,tracking_kind,target_value,duration_days,xp_reward,config)
values
  ('checkin-consistency-14d','Entender antes de mudar','Faça 10 check-ins curtos em 14 dias. O objetivo é criar contexto suficiente para o Nino encontrar padrões reais.','awareness','checkin_count',10,14,80,'{"cta":"Registrar como me sinto"}'::jsonb),
  ('three-no-spend-days','Três dias de respiro','Tenha 3 dias completos sem despesas de consumo durante as próximas duas semanas. Contas e transferências não entram.','control','no_spend_days',3,14,100,'{"cta":"Começar experimento"}'::jsonb),
  ('reduce-spend-10pct','Reduzir sem radicalizar','Teste por 14 dias um ritmo de gastos de consumo pelo menos 10% menor que a sua média anterior.','control','spend_reduction_pct',10,14,120,'{"cta":"Testar por 14 dias"}'::jsonb),
  ('pause-before-buying','Pausa antes da compra','Em 7 compras que despertarem vontade imediata, faça uma pausa e registre se ainda quer comprar depois.','calm','manual',7,14,90,'{"event_label":"Fiz a pausa","cta":"Aceitar experimento"}'::jsonb),
  ('weekly-money-review','Revisão de 5 minutos','Uma vez por semana, olhe saldo, próximos compromissos e uma decisão que você pode simplificar.','planning','manual',4,28,100,'{"event_label":"Fiz minha revisão","cta":"Criar rotina"}'::jsonb),
  ('small-wealth-moves','Pequenas ações de patrimônio','Faça quatro pequenas ações intencionais de construção de patrimônio durante o mês.','wealth','manual',4,30,120,'{"event_label":"Fiz uma ação","cta":"Começar"}'::jsonb)
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  dimension = excluded.dimension,
  tracking_kind = excluded.tracking_kind,
  target_value = excluded.target_value,
  duration_days = excluded.duration_days,
  xp_reward = excluded.xp_reward,
  config = excluded.config,
  active = true,
  updated_at = now();

create table if not exists public.behavior_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_slug text not null references public.behavior_experiment_templates(slug),
  title text not null,
  dimension text not null,
  tracking_kind text not null,
  status text not null default 'active',
  target_value numeric not null,
  current_value numeric not null default 0,
  progress numeric not null default 0,
  baseline_value numeric,
  result_value numeric,
  result_delta_pct numeric,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint behavior_experiments_status_check check (status in ('active','completed','abandoned','expired')),
  constraint behavior_experiments_progress_check check (progress between 0 and 100)
);
create unique index if not exists behavior_experiments_one_active_template_idx
  on public.behavior_experiments(user_id, template_slug) where status = 'active';
create index if not exists behavior_experiments_user_status_idx
  on public.behavior_experiments(user_id, status, started_at desc);

create table if not exists public.behavior_experiment_events (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.behavior_experiments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null default 'manual_progress',
  value numeric not null default 1,
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists behavior_experiment_events_experiment_idx
  on public.behavior_experiment_events(experiment_id, occurred_at desc);

alter table public.behavior_experiment_templates enable row level security;
alter table public.behavior_experiments enable row level security;
alter table public.behavior_experiment_events enable row level security;

drop policy if exists behavior_experiment_templates_read on public.behavior_experiment_templates;
create policy behavior_experiment_templates_read on public.behavior_experiment_templates
  for select using (active = true);
drop policy if exists behavior_experiments_select_own on public.behavior_experiments;
create policy behavior_experiments_select_own on public.behavior_experiments
  for select using (auth.uid() = user_id);
drop policy if exists behavior_experiments_insert_own on public.behavior_experiments;
create policy behavior_experiments_insert_own on public.behavior_experiments
  for insert with check (auth.uid() = user_id);
drop policy if exists behavior_experiments_update_own on public.behavior_experiments;
create policy behavior_experiments_update_own on public.behavior_experiments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists behavior_experiment_events_select_own on public.behavior_experiment_events;
create policy behavior_experiment_events_select_own on public.behavior_experiment_events
  for select using (auth.uid() = user_id);
drop policy if exists behavior_experiment_events_insert_own on public.behavior_experiment_events;
create policy behavior_experiment_events_insert_own on public.behavior_experiment_events
  for insert with check (auth.uid() = user_id);

create or replace function public.behavior_experiment_refresh(p_experiment_id uuid)
returns public.behavior_experiments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := auth.role();
  v_exp public.behavior_experiments;
  v_current numeric := 0;
  v_progress numeric := 0;
  v_elapsed_days numeric := 1;
  v_baseline numeric;
begin
  select * into v_exp from public.behavior_experiments where id = p_experiment_id;
  if v_exp.id is null then raise exception 'experiment_not_found'; end if;
  if v_role <> 'service_role' and (v_uid is null or v_exp.user_id <> v_uid) then raise exception 'forbidden'; end if;
  if v_exp.status <> 'active' then return v_exp; end if;

  if now() > v_exp.ends_at then
    update public.behavior_experiments set status='expired', updated_at=now() where id=v_exp.id returning * into v_exp;
    return v_exp;
  end if;

  if v_exp.tracking_kind = 'checkin_count' then
    select count(distinct (occurred_at at time zone 'America/Sao_Paulo')::date)::numeric into v_current
      from public.emotional_checkins
     where user_id = v_exp.user_id and occurred_at >= v_exp.started_at and occurred_at <= now();

  elsif v_exp.tracking_kind = 'no_spend_days' then
    select count(*)::numeric into v_current
      from generate_series(v_exp.started_at::date, least(current_date - 1, v_exp.ends_at::date), interval '1 day') d(day)
     where not exists (
       select 1 from public.transactions t
        where t.user_id = v_exp.user_id
          and t.status = 'confirmed'
          and t.type::text = 'expense'
          and coalesce(t.movement_kind,'transaction') = 'transaction'
          and coalesce(t.behavioral_day,t.occurred_at) = d.day::date
     );

  elsif v_exp.tracking_kind = 'spend_reduction_pct' then
    v_elapsed_days := greatest(1, extract(epoch from (least(now(),v_exp.ends_at) - v_exp.started_at))/86400.0);
    v_baseline := v_exp.baseline_value;
    if v_baseline is null or v_baseline <= 0 then
      select coalesce(sum(t.amount),0) / greatest(1, extract(epoch from (v_exp.started_at - (v_exp.ends_at-v_exp.started_at) - v_exp.started_at))/86400.0 * -1)
        into v_baseline
        from public.transactions t
       where t.user_id = v_exp.user_id
         and t.status = 'confirmed'
         and t.type::text = 'expense'
         and coalesce(t.movement_kind,'transaction') = 'transaction'
         and coalesce(t.behavioral_day,t.occurred_at) >= (v_exp.started_at - (v_exp.ends_at-v_exp.started_at))::date
         and coalesce(t.behavioral_day,t.occurred_at) < v_exp.started_at::date;
      update public.behavior_experiments set baseline_value=v_baseline where id=v_exp.id;
    end if;
    if coalesce(v_baseline,0) > 0 then
      select greatest(-100, least(100,
        (v_baseline - (coalesce(sum(t.amount),0) / v_elapsed_days)) / v_baseline * 100
      )) into v_current
        from public.transactions t
       where t.user_id = v_exp.user_id
         and t.status = 'confirmed'
         and t.type::text = 'expense'
         and coalesce(t.movement_kind,'transaction') = 'transaction'
         and coalesce(t.behavioral_day,t.occurred_at) >= v_exp.started_at::date
         and coalesce(t.behavioral_day,t.occurred_at) <= current_date;
    else
      v_current := 0;
    end if;

  else
    select coalesce(sum(value),0) into v_current
      from public.behavior_experiment_events
     where experiment_id = v_exp.id and occurred_at >= v_exp.started_at;
  end if;

  v_progress := greatest(0, least(100, case when v_exp.target_value > 0 then (v_current / v_exp.target_value) * 100 else 0 end));

  update public.behavior_experiments
     set current_value = round(v_current,2),
         progress = round(v_progress,2),
         status = case when v_progress >= 100 then 'completed' else status end,
         completed_at = case when v_progress >= 100 then coalesce(completed_at,now()) else completed_at end,
         result_value = case when v_progress >= 100 then round(v_current,2) else result_value end,
         result_delta_pct = case when v_progress >= 100 and coalesce(v_exp.baseline_value,0) <> 0 then round((v_current-v_exp.baseline_value)/abs(v_exp.baseline_value)*100,2) else result_delta_pct end,
         updated_at = now()
   where id = v_exp.id
   returning * into v_exp;
  return v_exp;
end;
$$;
grant execute on function public.behavior_experiment_refresh(uuid) to authenticated, service_role;

create or replace function public.behavior_experiment_start(p_template_slug text)
returns public.behavior_experiments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tpl public.behavior_experiment_templates;
  v_existing public.behavior_experiments;
  v_row public.behavior_experiments;
  v_baseline numeric;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_tpl from public.behavior_experiment_templates where slug=p_template_slug and active=true;
  if v_tpl.slug is null then raise exception 'template_not_found'; end if;
  select * into v_existing from public.behavior_experiments where user_id=v_uid and template_slug=p_template_slug and status='active' limit 1;
  if v_existing.id is not null then return v_existing; end if;

  if v_tpl.tracking_kind = 'spend_reduction_pct' then
    select coalesce(sum(t.amount),0) / greatest(1,v_tpl.duration_days)::numeric into v_baseline
      from public.transactions t
     where t.user_id=v_uid and t.status='confirmed' and t.type::text='expense'
       and coalesce(t.movement_kind,'transaction')='transaction'
       and coalesce(t.behavioral_day,t.occurred_at) >= current_date - v_tpl.duration_days
       and coalesce(t.behavioral_day,t.occurred_at) < current_date;
  end if;

  insert into public.behavior_experiments(
    user_id,template_slug,title,dimension,tracking_kind,target_value,baseline_value,ends_at,metadata
  ) values (
    v_uid,v_tpl.slug,v_tpl.title,v_tpl.dimension,v_tpl.tracking_kind,v_tpl.target_value,v_baseline,
    now() + make_interval(days => v_tpl.duration_days),
    jsonb_build_object('xp_reward',v_tpl.xp_reward,'config',v_tpl.config,'version','behavior_experiment.v1')
  ) returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.behavior_experiment_start(text) to authenticated;

create or replace function public.behavior_experiment_log(
  p_experiment_id uuid,
  p_value numeric default 1,
  p_note text default null
)
returns public.behavior_experiments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_exp public.behavior_experiments;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_exp from public.behavior_experiments where id=p_experiment_id and user_id=v_uid;
  if v_exp.id is null or v_exp.status <> 'active' then raise exception 'active_experiment_not_found'; end if;
  if v_exp.tracking_kind <> 'manual' then raise exception 'experiment_is_auto_tracked'; end if;
  insert into public.behavior_experiment_events(experiment_id,user_id,value,note)
  values (v_exp.id,v_uid,greatest(0,p_value),nullif(trim(p_note),''));
  return public.behavior_experiment_refresh(v_exp.id);
end;
$$;
grant execute on function public.behavior_experiment_log(uuid,numeric,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Wave 3 — communication contract for deterministic, user-declared signals
-- ---------------------------------------------------------------------------
insert into public.communication_catalog(
  kind,label,family,description,active,base_priority,allowed_channels,cooldown_hours,
  dismiss_cooldown_days,not_useful_cooldown_days,max_per_day,requires_manual_approval,
  content_mode,audience_note,default_channels,sensitivity,fallback_policy,
  min_severity_for_whatsapp,default_window_hours,min_utility_score,same_pattern_cooldown_days
) values (
  'behavior_coach_highlight','Highlight de comportamento','behavior',
  'Leitura acionável baseada em check-in declarado ou progresso real de um experimento.',
  true,48,array['app','whatsapp']::text[],72,7,30,1,false,'deterministic',
  'Nunca diagnosticar; usar somente sinais declarados ou resultados observados.',
  array['app']::text[],'behavior','deterministic','attention',72,45,5
)
on conflict (kind) do update set
  label=excluded.label,
  family=excluded.family,
  description=excluded.description,
  active=true,
  allowed_channels=excluded.allowed_channels,
  default_channels=excluded.default_channels,
  cooldown_hours=excluded.cooldown_hours,
  sensitivity=excluded.sensitivity,
  updated_at=now();

notify pgrst, 'reload schema';
commit;