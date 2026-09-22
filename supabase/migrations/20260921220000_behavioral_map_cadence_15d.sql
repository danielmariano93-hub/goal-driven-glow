-- behavioral_map_cadence_15d
-- Reduz a recorrência da autoavaliação comportamental de 30 para 15 dias.
-- A janela analítica do Money Mood (30d) permanece inalterada: são conceitos diferentes.

begin;

-- O convite da roda precisa poder reaparecer a cada ciclo quinzenal.
update public.communication_catalog
   set description = 'Convida o usuário a repetir o mapa a cada 15 dias para comparar autopercepção e comportamento observado.',
       cooldown_hours = 360,
       same_pattern_cooldown_days = 15,
       updated_at = now()
 where kind = 'behavioral_reassessment_due';

-- Recalibra somente a avaliação MAIS RECENTE de cada usuário. Avaliações antigas
-- preservam a data histórica que vigorava quando foram respondidas.
with latest as (
  select distinct on (user_id) id
  from public.behavioral_assessments
  order by user_id, created_at desc
)
update public.behavioral_assessments b
   set next_due_at = b.created_at + interval '15 days'
  from latest l
 where b.id = l.id;

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
  v_due timestamptz := now() + interval '15 days';
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

  -- Uma nova avaliação substitui qualquer convite ainda não entregue do ciclo anterior.
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
    jsonb_build_object('assessment_id',v_row.id,'due_at',v_due,'cadence_days',15),
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

-- Alinha o convite já pendente ao novo vencimento da avaliação mais recente.
with latest as (
  select distinct on (user_id) id, user_id, next_due_at
  from public.behavioral_assessments
  order by user_id, created_at desc
)
update public.pending_proactive_suggestions p
   set next_attempt_at = greatest(l.next_due_at, now()),
       expires_at = greatest(l.next_due_at, now()) + interval '7 days',
       evidence = jsonb_set(
         jsonb_set(coalesce(p.evidence, '{}'::jsonb), '{cadence_days}', to_jsonb(15), true),
         '{due_at}', to_jsonb(l.next_due_at), true
       )
  from latest l
 where p.user_id = l.user_id
   and p.kind = 'behavioral_reassessment_due'
   and p.status = 'pending'
   and p.evidence ->> 'assessment_id' = l.id::text;

-- Garante o convite para a avaliação mais recente mesmo se a linha pendente tiver sido perdida.
with latest as (
  select distinct on (user_id) id, user_id, next_due_at
  from public.behavioral_assessments
  order by user_id, created_at desc
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
  jsonb_build_object('assessment_id',l.id,'due_at',l.next_due_at,'cadence_days',15),
  'both',
  'behavior-map-review:' || l.id::text,
  'behavior-map-review',
  'pending',
  greatest(l.next_due_at,now()),
  greatest(l.next_due_at,now()) + interval '7 days'
from latest l
where l.next_due_at is not null
on conflict (user_id,dedup_key) do update set
  next_attempt_at = excluded.next_attempt_at,
  expires_at = excluded.expires_at,
  status = 'pending',
  evidence = excluded.evidence,
  action = excluded.action;

notify pgrst, 'reload schema';

commit;
