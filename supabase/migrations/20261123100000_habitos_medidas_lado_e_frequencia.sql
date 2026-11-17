-- Hábitos: medidas com lado (braço e coxa esquerdos x direitos) e frequência editável (semanal ou mensal).
-- O lado pertence à medida (a série): comparar sempre o mesmo lado. Medir os dois lados = duas medidas. Tudo só adiciona.

alter table public.hb_measures add column if not exists side text;
alter table public.hb_measures drop constraint if exists hb_measures_side_check;
alter table public.hb_measures add constraint hb_measures_side_check check (side is null or (side in ('left', 'right') and kind in ('arm', 'thigh')));

-- Dados do objetivo, agora com o lado de cada medida.
create or replace function public.hb_goals_data()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  return jsonb_build_object(
    'today', public.hb_local_today(uid),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'title', g.title, 'started_on', g.started_on,
        'habit_ids', coalesce((select jsonb_agg(gh.habit_id) from public.hb_goal_habits gh where gh.goal_id = g.id), '[]'::jsonb),
        'measures', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id, 'kind', m.kind, 'label', m.label, 'unit', m.unit, 'cadence', m.cadence, 'side', m.side,
            'points', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'date', p.measured_on, 'value', p.value) order by p.measured_on)
                                from public.hb_measurements p where p.measure_id = m.id), '[]'::jsonb)
          ) order by m.created_at)
          from public.hb_measures m where m.goal_id = g.id and m.archived_at is null), '[]'::jsonb)
      ) order by g.created_at)
      from public.hb_goals g where g.user_id = uid and g.archived_at is null), '[]'::jsonb)
  );
end $$;
revoke all on function public.hb_goals_data() from public, anon;
grant execute on function public.hb_goals_data() to authenticated;

-- Criar medida: agora aceita o lado (só braço e coxa).
drop function if exists public.hb_measure_add(uuid, text, text, text, text);
create or replace function public.hb_measure_add(p_goal uuid, p_kind text, p_label text, p_unit text, p_cadence text, p_side text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); mid uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.hb_goals where id = p_goal and user_id = uid and archived_at is null) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (select count(*) from public.hb_measures where goal_id = p_goal and archived_at is null) >= 6 then raise exception 'measure_limit_reached' using errcode = '54000'; end if;
  if p_side is not null and (p_side not in ('left', 'right') or p_kind not in ('arm', 'thigh')) then raise exception 'invalid_side' using errcode = '22023'; end if;
  insert into public.hb_measures (user_id, goal_id, kind, label, unit, cadence, side) values (uid, p_goal, p_kind, btrim(p_label), p_unit, p_cadence, p_side) returning id into mid;
  return mid;
end $$;
revoke all on function public.hb_measure_add(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.hb_measure_add(uuid, text, text, text, text, text) to authenticated;

-- Mudar a frequência (semanal ou mensal) e/ou o lado de uma medida. Campo nulo = não muda.
create or replace function public.hb_measure_update(p_measure uuid, p_cadence text default null, p_side text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); m public.hb_measures;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into m from public.hb_measures where id = p_measure and user_id = uid and archived_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_cadence is not null and p_cadence not in ('weekly', 'monthly') then raise exception 'invalid_cadence' using errcode = '22023'; end if;
  if p_side is not null and (p_side not in ('left', 'right') or m.kind not in ('arm', 'thigh')) then raise exception 'invalid_side' using errcode = '22023'; end if;
  update public.hb_measures set cadence = coalesce(p_cadence, cadence), side = coalesce(p_side, side) where id = p_measure;
end $$;
revoke all on function public.hb_measure_update(uuid, text, text) from public, anon;
grant execute on function public.hb_measure_update(uuid, text, text) to authenticated;
