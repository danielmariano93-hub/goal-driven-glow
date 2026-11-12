-- Hábitos: Objetivos e Medidas. Perder peso, ganhar massa ou reduzir a cintura são METAS (resultados), não hábitos:
-- um Objetivo agrupa as medidas (peso, cintura, braço, coxa...) e os hábitos ligados a ele (treinar). Medidas não ocupam
-- vaga entre os hábitos ativos, não entram no contador do Hoje e têm frequência própria (semanal ou mensal).
-- Tudo só adiciona. O hábito "Peso" existente é copiado para uma medida e arquivado (reversível: status volta a 'active').

create table if not exists public.hb_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 80),
  started_on date not null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hb_goals_user_idx on public.hb_goals (user_id) where archived_at is null;

create table if not exists public.hb_goal_habits (
  goal_id uuid not null references public.hb_goals(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  primary key (goal_id, habit_id)
);

create table if not exists public.hb_measures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.hb_goals(id) on delete cascade,
  kind text not null check (kind in ('weight', 'waist', 'arm', 'thigh', 'custom')),
  label text not null check (char_length(btrim(label)) between 2 and 40),
  unit text not null check (char_length(unit) between 1 and 10),
  cadence text not null check (cadence in ('weekly', 'monthly')),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hb_measures_goal_idx on public.hb_measures (goal_id) where archived_at is null;

create table if not exists public.hb_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measure_id uuid not null references public.hb_measures(id) on delete cascade,
  measured_on date not null,
  value numeric not null check (value > 0 and value < 100000),
  created_at timestamptz not null default now(),
  unique (measure_id, measured_on)
);
create index if not exists hb_measurements_measure_idx on public.hb_measurements (measure_id, measured_on);

alter table public.hb_goals enable row level security;
alter table public.hb_goal_habits enable row level security;
alter table public.hb_measures enable row level security;
alter table public.hb_measurements enable row level security;
drop policy if exists hb_goals_select_own on public.hb_goals;
create policy hb_goals_select_own on public.hb_goals for select to authenticated using (user_id = auth.uid());
drop policy if exists hb_goal_habits_select_own on public.hb_goal_habits;
create policy hb_goal_habits_select_own on public.hb_goal_habits for select to authenticated using (exists (select 1 from public.hb_goals g where g.id = goal_id and g.user_id = auth.uid()));
drop policy if exists hb_measures_select_own on public.hb_measures;
create policy hb_measures_select_own on public.hb_measures for select to authenticated using (user_id = auth.uid());
drop policy if exists hb_measurements_select_own on public.hb_measurements;
create policy hb_measurements_select_own on public.hb_measurements for select to authenticated using (user_id = auth.uid());
revoke all on public.hb_goals, public.hb_goal_habits, public.hb_measures, public.hb_measurements from anon, public;
grant select on public.hb_goals, public.hb_goal_habits, public.hb_measures, public.hb_measurements to authenticated;

-- ===== Leitura: tudo de uma vez =====
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
            'id', m.id, 'kind', m.kind, 'label', m.label, 'unit', m.unit, 'cadence', m.cadence,
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

-- ===== Escrita =====
create or replace function public.hb_goal_create(p_title text, p_habits uuid[] default '{}', p_measures jsonb default '[]')
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); gid uuid; m jsonb; hid uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  if (select count(*) from public.hb_goals where user_id = uid and archived_at is null) >= 3 then raise exception 'goal_limit_reached' using errcode = '54000'; end if;
  insert into public.hb_goals (user_id, title, started_on) values (uid, btrim(p_title), public.hb_local_today(uid)) returning id into gid;
  foreach hid in array coalesce(p_habits, '{}') loop
    if exists (select 1 from public.hb_habits where id = hid and user_id = uid) then
      insert into public.hb_goal_habits (goal_id, habit_id) values (gid, hid) on conflict do nothing;
    end if;
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_measures, '[]'::jsonb)) loop
    insert into public.hb_measures (user_id, goal_id, kind, label, unit, cadence)
    values (uid, gid, m->>'kind', btrim(m->>'label'), m->>'unit', m->>'cadence');
  end loop;
  return gid;
end $$;
revoke all on function public.hb_goal_create(text, uuid[], jsonb) from public, anon;
grant execute on function public.hb_goal_create(text, uuid[], jsonb) to authenticated;

create or replace function public.hb_goal_update(p_goal uuid, p_title text default null, p_habits uuid[] default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); hid uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.hb_goals where id = p_goal and user_id = uid and archived_at is null) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_title is not null then
    update public.hb_goals set title = btrim(p_title) where id = p_goal;
  end if;
  if p_habits is not null then
    delete from public.hb_goal_habits where goal_id = p_goal;
    foreach hid in array p_habits loop
      if exists (select 1 from public.hb_habits where id = hid and user_id = uid) then
        insert into public.hb_goal_habits (goal_id, habit_id) values (p_goal, hid) on conflict do nothing;
      end if;
    end loop;
  end if;
end $$;
revoke all on function public.hb_goal_update(uuid, text, uuid[]) from public, anon;
grant execute on function public.hb_goal_update(uuid, text, uuid[]) to authenticated;

create or replace function public.hb_goal_archive(p_goal uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.hb_goals set archived_at = now() where id = p_goal and user_id = auth.uid() and archived_at is null;
end $$;
revoke all on function public.hb_goal_archive(uuid) from public, anon;
grant execute on function public.hb_goal_archive(uuid) to authenticated;

create or replace function public.hb_measure_add(p_goal uuid, p_kind text, p_label text, p_unit text, p_cadence text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); mid uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.hb_goals where id = p_goal and user_id = uid and archived_at is null) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (select count(*) from public.hb_measures where goal_id = p_goal and archived_at is null) >= 6 then raise exception 'measure_limit_reached' using errcode = '54000'; end if;
  insert into public.hb_measures (user_id, goal_id, kind, label, unit, cadence) values (uid, p_goal, p_kind, btrim(p_label), p_unit, p_cadence) returning id into mid;
  return mid;
end $$;
revoke all on function public.hb_measure_add(uuid, text, text, text, text) from public, anon;
grant execute on function public.hb_measure_add(uuid, text, text, text, text) to authenticated;

create or replace function public.hb_measure_archive(p_measure uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.hb_measures set archived_at = now() where id = p_measure and user_id = auth.uid() and archived_at is null;
end $$;
revoke all on function public.hb_measure_archive(uuid) from public, anon;
grant execute on function public.hb_measure_archive(uuid) to authenticated;

-- Registra (ou corrige) a medida de um dia: no máximo uma por dia; de hoje até 400 dias atrás.
create or replace function public.hb_measurement_set(p_measure uuid, p_date date, p_value numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); today date; pid uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not exists (select 1 from public.hb_measures where id = p_measure and user_id = uid and archived_at is null) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_value is null or p_value <= 0 or p_value >= 100000 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  today := public.hb_local_today(uid);
  if p_date > today then raise exception 'future_date' using errcode = '22008'; end if;
  if p_date < today - 400 then raise exception 'edit_window_closed' using errcode = '22008'; end if;
  insert into public.hb_measurements (user_id, measure_id, measured_on, value) values (uid, p_measure, p_date, p_value)
  on conflict (measure_id, measured_on) do update set value = excluded.value returning id into pid;
  return pid;
end $$;
revoke all on function public.hb_measurement_set(uuid, date, numeric) from public, anon;
grant execute on function public.hb_measurement_set(uuid, date, numeric) to authenticated;

create or replace function public.hb_measurement_delete(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from public.hb_measurements where id = p_id and user_id = auth.uid();
end $$;
revoke all on function public.hb_measurement_delete(uuid) from public, anon;
grant execute on function public.hb_measurement_delete(uuid) to authenticated;

-- ===== O hábito "Peso" vira uma medida =====
-- Para cada pessoa com o hábito de acompanhar o peso: cria o Objetivo, liga o hábito de treino (se houver), copia o histórico
-- para a medida de peso e arquiva o hábito (os registros dele continuam guardados; para desfazer, volte o status para 'active').
do $$
declare h record; g uuid; m uuid; tid uuid;
begin
  for h in select * from public.hb_habits where status = 'active' and form = 'value' and title ~* '^(acompanhar o )?peso' loop
    if exists (select 1 from public.hb_measures where user_id = h.user_id and kind = 'weight') then continue; end if;
    insert into public.hb_goals (user_id, title, started_on)
    values (h.user_id, 'Meu objetivo', coalesce((select min(local_date) from public.hb_logs where habit_id = h.id and status = 'quantity'), h.started_on))
    returning id into g;
    select id into tid from public.hb_habits where user_id = h.user_id and status = 'active' and (form = 'weekly' or title ~* '^trein') order by created_at limit 1;
    if tid is not null then insert into public.hb_goal_habits (goal_id, habit_id) values (g, tid); end if;
    insert into public.hb_measures (user_id, goal_id, kind, label, unit, cadence) values (h.user_id, g, 'weight', 'Peso', 'kg', 'weekly') returning id into m;
    insert into public.hb_measurements (user_id, measure_id, measured_on, value)
    select h.user_id, m, local_date, quantity from public.hb_logs where habit_id = h.id and status = 'quantity' and quantity > 0
    on conflict do nothing;
    update public.hb_habits set status = 'archived', archived_at = now() where id = h.id;
  end loop;
end $$;
