-- nino_feedback_respected.v1 — o que a pessoa dispensa some na hora e em
-- todas as telas.
--  * "não foi útil" passa a esconder como "dispensar" (antes só era gravado);
--  * dispensa na Home (fila) esconde o mesmo assunto na página do Nino e
--    vice-versa (a fila e o diagnóstico usam a mesma chave de assunto);
--  * risco crítico volta em 3 dias mesmo dispensado; o resto em 90 dias.

-- Assunto canônico de um item da fila: "...:situation:<chave>" → "<chave>".
create or replace function public.nino_topic_of(_fingerprint text)
returns text
language sql
immutable
as $$
  select case
    when position('situation:' in coalesce(_fingerprint, '')) > 0
      then substring(_fingerprint from position('situation:' in _fingerprint) + length('situation:'))
    else _fingerprint
  end;
$$;

create or replace function public.nino_dismissed_topics(_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with feed_dismissals as (
    select public.nino_topic_of(e.fingerprint) as topic, e.fingerprint, e.kind, max(e.created_at) as at
    from public.nino_priority_events e
    where e.user_id = _user_id and e.event = 'dismissed'
      and e.created_at > now() - interval '90 days'
    group by 1, 2, 3
  ), situation_feedback as (
    select distinct on (f.situation_id) s.situation_key as topic, s.severity, f.feedback, f.created_at as at
    from public.financial_situation_feedback f
    join public.financial_situations s on s.id = f.situation_id
    where f.user_id = _user_id
    order by f.situation_id, f.created_at desc
  )
  select coalesce(array_agg(distinct t), '{}'::text[]) from (
    select topic as t from feed_dismissals
    where at > now() - case
      when kind in ('debt_overdue', 'card_bill_pressure', 'upcoming_cash_pressure', 'forgotten_bill') then interval '3 days'
      else interval '90 days' end
    union all
    select fingerprint from feed_dismissals
    where at > now() - case
      when kind in ('debt_overdue', 'card_bill_pressure', 'upcoming_cash_pressure', 'forgotten_bill') then interval '3 days'
      else interval '90 days' end
    union all
    select topic from situation_feedback
    where feedback in ('dismiss', 'not_useful')
      and at > now() - case when severity = 'critical' then interval '3 days' else interval '90 days' end
  ) x
  where t is not null and t <> '';
$$;

revoke all on function public.nino_dismissed_topics(uuid) from public, anon, authenticated;
grant execute on function public.nino_dismissed_topics(uuid) to service_role;

-- Página do Nino: esconde "dispensar" E "não foi útil", e também o que foi
-- dispensado na Home (mesmo assunto).
create or replace function public.nino_situation_screen_hidden_ids(_user_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with topics as (select public.nino_dismissed_topics(_user_id) as keys)
  select coalesce(array_agg(s.id), '{}'::uuid[])
  from public.financial_situations s, topics t
  where s.user_id = _user_id
    and s.situation_key = any(t.keys);
$$;

-- Home: a fila nunca devolve o que a pessoa dispensou (na Home ou na página
-- do Nino), com as mesmas janelas. Security definer só para ler a regra única
-- de assuntos dispensados; o escopo é sempre auth.uid().
create or replace function public.my_nino_priorities(_limit int default 3)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _keys text[];
begin
  if _uid is null then
    return '[]'::jsonb;
  end if;
  _keys := public.nino_dismissed_topics(_uid);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'rank', f.rank, 'fingerprint', f.fingerprint, 'kind', f.kind, 'severity', f.severity,
      'title', f.title, 'body', f.body, 'route', f.route, 'impact_amount', f.impact_amount,
      'as_of', f.as_of, 'computed_at', f.computed_at
    ) order by f.rank), '[]'::jsonb)
    from (
      select pf.* from public.nino_priority_feed pf
      where pf.user_id = _uid and pf.valid_until > now()
        and not (pf.fingerprint = any(_keys))
        and not (public.nino_topic_of(pf.fingerprint) = any(_keys))
      order by pf.rank
      limit greatest(1, least(coalesce(_limit, 3), 5))
    ) f
  );
end;
$$;

revoke all on function public.my_nino_priorities(int) from public;
grant execute on function public.my_nino_priorities(int) to authenticated;
