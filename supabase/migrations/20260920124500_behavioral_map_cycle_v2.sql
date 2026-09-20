-- behavioral_map_cycle.v2
-- Makes the behavioral map a recurring measurement instead of a one-off form.
-- Self-perception remains separate from deterministic financial evidence.

begin;

alter table public.behavioral_assessments
  add column if not exists observed_scores jsonb,
  add column if not exists observed_overall_score numeric(4,2),
  add column if not exists observed_coverage smallint not null default 0,
  add column if not exists observed_evidence jsonb not null default '{}'::jsonb,
  add column if not exists question_set text not null default 'wheel_set_a',
  add column if not exists next_due_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'behavioral_assessments_observed_overall_check') then
    alter table public.behavioral_assessments
      add constraint behavioral_assessments_observed_overall_check
      check (observed_overall_score is null or observed_overall_score between 0 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'behavioral_assessments_observed_coverage_check') then
    alter table public.behavioral_assessments
      add constraint behavioral_assessments_observed_coverage_check
      check (observed_coverage between 0 and 8);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'behavioral_assessments_question_set_check') then
    alter table public.behavioral_assessments
      add constraint behavioral_assessments_question_set_check
      check (question_set in ('wheel_set_a','wheel_set_b','wheel_set_c'));
  end if;
end $$;

update public.behavioral_assessments
   set next_due_at = created_at + interval '30 days'
 where next_due_at is null;

create index if not exists behavioral_assessments_user_due_idx
  on public.behavioral_assessments(user_id, next_due_at desc);

insert into public.communication_catalog(
  kind,label,family,description,active,base_priority,allowed_channels,cooldown_hours,
  dismiss_cooldown_days,not_useful_cooldown_days,max_per_day,requires_manual_approval,
  content_mode,audience_note,default_channels,sensitivity,fallback_policy,
  min_severity_for_whatsapp,stale_policy,default_window_hours,min_utility_score,
  escalation_channels,whatsapp_min_confidence,whatsapp_min_absolute_impact,
  same_pattern_cooldown_days
)
values (
  'behavioral_reassessment_due',
  'Revisão do mapa financeiro comportamental',
  'evolucao',
  'Convida o usuário a repetir o mapa depois de 30 dias para comparar autopercepção e comportamento observado.',
  true,
  55,
  array['app','whatsapp'],
  720,
  7,
  30,
  1,
  false,
  'template',
  'Somente usuários que já preencheram um mapa e chegaram à data da próxima revisão.',
  array['app','whatsapp'],
  'normal',
  'app_only',
  'info',
  'drop_after_window',
  168,
  0.55,
  array[]::text[],
  0.7,
  0,
  30
)
on conflict (kind) do update set
  label = excluded.label,
  family = excluded.family,
  description = excluded.description,
  active = true,
  base_priority = excluded.base_priority,
  allowed_channels = excluded.allowed_channels,
  cooldown_hours = excluded.cooldown_hours,
  default_channels = excluded.default_channels,
  content_mode = excluded.content_mode,
  min_severity_for_whatsapp = excluded.min_severity_for_whatsapp,
  default_window_hours = excluded.default_window_hours,
  updated_at = now();

create or replace function public.behavioral_assessment_save_v2(
  p_scores jsonb,
  p_observed_scores jsonb default '{}'::jsonb,
  p_observed_overall numeric default null,
  p_observed_coverage integer default 0,
  p_observed_evidence jsonb default '{}'::jsonb,
  p_question_set text default 'wheel_set_a'
)
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
  v_due timestamptz := now() + interval '30 days';
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_question_set not in ('wheel_set_a','wheel_set_b','wheel_set_c') then
    raise exception 'invalid_question_set';
  end if;
  if p_observed_coverage < 0 or p_observed_coverage > 8 then
    raise exception 'invalid_observed_coverage';
  end if;
  if p_observed_overall is not null and (p_observed_overall < 0 or p_observed_overall > 10) then
    raise exception 'invalid_observed_overall';
  end if;

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

  -- A new assessment supersedes any not-yet-dispatched review invitation.
  update public.pending_proactive_suggestions
     set status = 'dismissed', dismissed_at = now(), defer_reason = 'superseded_by_new_assessment'
   where user_id = v_uid
     and kind = 'behavioral_reassessment_due'
     and status = 'pending';

  insert into public.behavioral_assessments(
    user_id,scores,overall_score,source,version,
    observed_scores,observed_overall_score,observed_coverage,observed_evidence,
    question_set,next_due_at
  ) values (
    v_uid,p_scores,round(v_total / array_length(v_required,1),2),'self_assessment','behavior_wheel.v2',
    nullif(p_observed_scores,'{}'::jsonb),p_observed_overall,p_observed_coverage,coalesce(p_observed_evidence,'{}'::jsonb),
    p_question_set,v_due
  ) returning * into v_row;

  insert into public.pending_proactive_suggestions(
    user_id,kind,severity,title,body,action,evidence,channel_ready,dedup_key,
    logical_dedup_key,status,next_attempt_at,expires_at
  ) values (
    v_uid,
    'behavioral_reassessment_due',
    'info',
    'Seu mapa está pronto para uma nova leitura',
    'Já passou um ciclo desde o último mapa. Leva cerca de 1 minuto para atualizar sua percepção e comparar com o que mudou nos seus hábitos financeiros.',
    jsonb_build_object('type','behavioral_reassessment','route','/app/emocoes?review=1'),
    jsonb_build_object('assessment_id',v_row.id,'due_at',v_due,'cadence_days',30),
    'both',
    'behavior-map-review:' || v_row.id::text,
    'behavior-map-review',
    'pending',
    v_due,
    v_due + interval '7 days'
  ) on conflict (user_id,dedup_key) do update set
    next_attempt_at = excluded.next_attempt_at,
    expires_at = excluded.expires_at,
    status = 'pending',
    evidence = excluded.evidence,
    action = excluded.action;

  return v_row;
end;
$$;

revoke all on function public.behavioral_assessment_save_v2(jsonb,jsonb,numeric,integer,jsonb,text) from public, anon;
grant execute on function public.behavioral_assessment_save_v2(jsonb,jsonb,numeric,integer,jsonb,text) to authenticated;

-- Schedule one future review for the latest existing assessment of each user.
with latest as (
  select distinct on (user_id)
    id,user_id,next_due_at
  from public.behavioral_assessments
  order by user_id,created_at desc
)
insert into public.pending_proactive_suggestions(
  user_id,kind,severity,title,body,action,evidence,channel_ready,dedup_key,
  logical_dedup_key,status,next_attempt_at,expires_at
)
select
  l.user_id,
  'behavioral_reassessment_due',
  'info',
  'Seu mapa está pronto para uma nova leitura',
  'Já passou um ciclo desde o último mapa. Leva cerca de 1 minuto para atualizar sua percepção e comparar com o que mudou nos seus hábitos financeiros.',
  jsonb_build_object('type','behavioral_reassessment','route','/app/emocoes?review=1'),
  jsonb_build_object('assessment_id',l.id,'due_at',l.next_due_at,'cadence_days',30),
  'both',
  'behavior-map-review:' || l.id::text,
  'behavior-map-review',
  'pending',
  greatest(l.next_due_at,now()),
  greatest(l.next_due_at,now()) + interval '7 days'
from latest l
where l.next_due_at is not null
on conflict (user_id,dedup_key) do nothing;

notify pgrst, 'reload schema';

commit;
