-- Nino Hábitos M5: formas de medir (check, quantidade, duração, semanal, horário, teto, valor, projeto, largar, rotina em passos, recorrente).
-- Aditiva. Depende das migrações 1 a 4. Os tipos antigos (kind) continuam valendo: cada forma se apoia em um deles.
-- Documento: docs/NINO_HABITOS_REFINAMENTO_TECNICO.md (apêndice J).

alter table public.hb_habits add column if not exists form text;
alter table public.hb_habits add column if not exists direction text;
alter table public.hb_habits add column if not exists implicit_ok boolean not null default false;
alter table public.hb_habits add column if not exists interval_days int;
alter table public.hb_habits add column if not exists meta jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hb_habits_form_ck') then
    alter table public.hb_habits add constraint hb_habits_form_ck
      check (form is null or form in ('check','amount','duration','weekly','time','ceiling','value','project','quit','steps','recurring'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hb_habits_direction_ck') then
    alter table public.hb_habits add constraint hb_habits_direction_ck check (direction is null or direction in ('at_least','at_most','track'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hb_habits_interval_ck') then
    alter table public.hb_habits add constraint hb_habits_interval_ck check (interval_days is null or interval_days between 1 and 3650);
  end if;
end $$;

-- Meta zero só faz sentido quando se acompanha um valor ou se limita algo (teto de zero pedidos); fazer "pelo menos zero" não.
alter table public.hb_habits drop constraint if exists hb_habits_quantity_target_check;
alter table public.hb_habits add constraint hb_habits_quantity_target_check
  check (quantity_target is null or quantity_target > 0 or (quantity_target = 0 and direction in ('track','at_most')));

-- ===== Projetos (livro, curso, reserva): total, avanço e conclusão =====
create table if not exists public.hb_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  total numeric not null check (total > 0),
  current numeric not null default 0 check (current >= 0),
  unit text,
  started_on date not null,
  finished_on date,
  created_at timestamptz not null default now()
);
create unique index if not exists hb_projects_open_idx on public.hb_projects (habit_id) where finished_on is null;
create index if not exists hb_projects_user_idx on public.hb_projects (user_id, habit_id);

-- ===== Rotina em passos =====
create table if not exists public.hb_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  position smallint not null,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  archived_at timestamptz,
  unique (habit_id, position)
);
create table if not exists public.hb_step_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  step_id uuid not null references public.hb_steps(id) on delete cascade,
  local_date date not null,
  logged_at timestamptz not null default now(),
  primary key (step_id, local_date)
);
create index if not exists hb_step_logs_user_idx on public.hb_step_logs (user_id, habit_id, local_date desc);

do $$
declare t text;
begin
  foreach t in array array['hb_projects','hb_steps','hb_step_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())', t || '_select_own', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ===== Criar hábito (todas as formas) =====
create or replace function public.hb_create_habit(p jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  v_kind text := p->>'kind';
  v_form text := nullif(p->>'form', '');
  v_dir text := nullif(p->>'direction', '');
  v_sens text := coalesce(p->>'sensitivity', 'normal');
  v_id uuid;
  v_days smallint[];
  v_today date;
  v_cat uuid := nullif(p->>'money_category_id', '')::uuid;
  v_informed numeric := nullif(p->>'daily_cost', '')::numeric;
  v_base jsonb;
  v_cost numeric; v_src text; v_n int;
  v_target numeric := nullif(p->>'quantity_target', '')::numeric;
  v_steps jsonb := p->'steps';
  v_proj jsonb := p->'project';
  i int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  if v_kind not in ('do_daily','do_weekly_count','do_quantity','quit') then raise exception 'unsupported_kind' using errcode = '22023'; end if;
  if v_form is not null and v_form not in ('check','amount','duration','weekly','time','ceiling','value','project','quit','steps','recurring') then raise exception 'unsupported_form' using errcode = '22023'; end if;
  if v_dir is not null and v_dir not in ('at_least','at_most','track') then raise exception 'unsupported_direction' using errcode = '22023'; end if;
  if v_sens <> 'normal' then
    if not exists (select 1 from public.hb_preferences where user_id = uid and consent_sensitive_at is not null) then
      raise exception 'consent_required' using errcode = '42501';
    end if;
  end if;
  if (select count(*) from public.hb_habits where user_id = uid and status = 'active') >= 5 then
    raise exception 'habit_limit_reached' using errcode = '54000';
  end if;
  if v_form = 'recurring' and coalesce(nullif(p->>'interval_days','')::int, 0) < 1 then raise exception 'interval_required' using errcode = '22023'; end if;
  if v_form = 'steps' and (v_steps is null or jsonb_typeof(v_steps) <> 'array' or jsonb_array_length(v_steps) < 1 or jsonb_array_length(v_steps) > 12) then raise exception 'steps_required' using errcode = '22023'; end if;
  -- valor acompanhado sem meta: a tabela exige um alvo numérico; 0 significa "só acompanhar".
  if v_kind = 'do_quantity' and v_target is null and v_dir = 'track' then v_target := 0; end if;
  v_today := public.hb_local_today(uid);
  if p ? 'days_of_week' and jsonb_typeof(p->'days_of_week') = 'array' and jsonb_array_length(p->'days_of_week') > 0 then
    select array_agg(x::smallint order by x::smallint) into v_days from jsonb_array_elements_text(p->'days_of_week') x;
  end if;
  insert into public.hb_habits (
    user_id, template_id, kind, title, area, sensitivity, cue_kind, cue_text, cue_time, minimum_text, days_of_week,
    weekly_target, quantity_target, quantity_unit, quantity_period, rest_per_week, craving_plan, started_on,
    form, direction, implicit_ok, interval_days, meta
  ) values (
    uid, nullif(p->>'template_id','')::uuid, v_kind, btrim(p->>'title'), coalesce(p->>'area','other'), v_sens,
    nullif(p->>'cue_kind',''), nullif(btrim(p->>'cue_text'),''), nullif(p->>'cue_time','')::time,
    nullif(btrim(p->>'minimum_text'),''), v_days,
    nullif(p->>'weekly_target','')::smallint, v_target, nullif(p->>'quantity_unit',''),
    nullif(p->>'quantity_period',''), coalesce(nullif(p->>'rest_per_week','')::smallint, 1),
    nullif(btrim(p->>'craving_plan'), ''),
    case when v_kind = 'quit' then v_today
         when coalesce((p->>'start_today')::boolean, false) then v_today else v_today + 1 end,
    v_form, v_dir, coalesce((p->>'implicit_ok')::boolean, false), nullif(p->>'interval_days','')::int,
    case when jsonb_typeof(p->'meta') = 'object' then p->'meta' else '{}'::jsonb end
  ) returning id into v_id;

  if v_kind = 'quit' then
    if v_cat is not null then
      insert into public.hb_money_links (user_id, habit_id, category_id, ref_label) values (uid, v_id, v_cat, nullif(btrim(p->>'money_label'), ''));
      v_base := public.hb_category_baseline(uid, v_cat, v_today);
      v_n := coalesce((v_base->>'n_tx')::int, 0);
      if coalesce((v_base->>'enough')::boolean, false) then v_cost := (v_base->>'daily_cost')::numeric; v_src := 'nino_data'; end if;
    end if;
    if v_cost is null and v_informed is not null then v_cost := v_informed; v_src := 'user_informed'; end if;
    insert into public.hb_cycles (user_id, habit_id, started_on, baseline_daily_cost, baseline_source, baseline_n_days)
    values (uid, v_id, v_today, v_cost, v_src, v_n);
  end if;

  if v_form = 'steps' then
    for i in 0 .. jsonb_array_length(v_steps) - 1 loop
      insert into public.hb_steps (user_id, habit_id, position, title) values (uid, v_id, i, btrim(v_steps->>i));
    end loop;
  end if;

  if v_form = 'project' and v_proj is not null and jsonb_typeof(v_proj) = 'object' and nullif(btrim(v_proj->>'title'), '') is not null and coalesce((v_proj->>'total')::numeric, 0) > 0 then
    insert into public.hb_projects (user_id, habit_id, title, total, current, unit, started_on)
    values (uid, v_id, btrim(v_proj->>'title'), (v_proj->>'total')::numeric, least(greatest(coalesce((v_proj->>'current')::numeric, 0), 0), (v_proj->>'total')::numeric),
            nullif(v_proj->>'unit',''), case when coalesce((p->>'start_today')::boolean, false) then v_today else v_today + 1 end);
  end if;
  return v_id;
end $$;

-- ===== Projeto: registrar avanço, trocar de projeto, ajustar =====
create or replace function public.hb_project_add(p_habit uuid, p_amount numeric, p_date date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  h public.hb_habits; pr public.hb_projects; v_date date; v_today date; v_prev numeric; v_add numeric;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000 then raise exception 'invalid_amount' using errcode = '22023'; end if;
  select * into h from public.hb_habits where id = p_habit and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.form is distinct from 'project' then raise exception 'not_a_project_habit' using errcode = '22023'; end if;
  select * into pr from public.hb_projects where habit_id = p_habit and finished_on is null;
  if not found then raise exception 'no_open_project' using errcode = 'P0002'; end if;
  v_today := public.hb_local_today(uid);
  v_date := coalesce(p_date, v_today);
  v_add := least(p_amount, pr.total - pr.current);
  if v_add <= 0 then raise exception 'project_already_complete' using errcode = '22023'; end if;
  select coalesce(quantity, 0) into v_prev from public.hb_logs where habit_id = p_habit and local_date = v_date;
  perform public.hb_log_as(uid, p_habit, v_date, 'quantity', coalesce(v_prev, 0) + v_add, null, 'app', null);
  update public.hb_projects set current = current + v_add,
    finished_on = case when current + v_add >= total then v_date else null end
  where id = pr.id returning * into pr;
  return jsonb_build_object('project_id', pr.id, 'current', pr.current, 'total', pr.total, 'finished', pr.finished_on is not null, 'added', v_add);
end $$;
revoke all on function public.hb_project_add(uuid, numeric, date) from public, anon;
grant execute on function public.hb_project_add(uuid, numeric, date) to authenticated;

create or replace function public.hb_project_start(p_habit uuid, p_title text, p_total numeric, p_unit text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); h public.hb_habits; v_id uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  select * into h from public.hb_habits where id = p_habit and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.form is distinct from 'project' then raise exception 'not_a_project_habit' using errcode = '22023'; end if;
  if exists (select 1 from public.hb_projects where habit_id = p_habit and finished_on is null) then raise exception 'open_project_exists' using errcode = '23505'; end if;
  insert into public.hb_projects (user_id, habit_id, title, total, current, unit, started_on)
  values (uid, p_habit, btrim(p_title), p_total, 0, coalesce(nullif(p_unit, ''), h.quantity_unit), public.hb_local_today(uid)) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.hb_project_start(uuid, text, numeric, text) from public, anon;
grant execute on function public.hb_project_start(uuid, text, numeric, text) to authenticated;

create or replace function public.hb_project_update(p_project uuid, p_title text default null, p_total numeric default null, p_current numeric default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); pr public.hb_projects;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into pr from public.hb_projects where id = p_project and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.hb_projects set
    title = coalesce(nullif(btrim(p_title), ''), title),
    total = coalesce(p_total, total),
    current = least(greatest(coalesce(p_current, current), 0), coalesce(p_total, total))
  where id = p_project;
end $$;
revoke all on function public.hb_project_update(uuid, text, numeric, numeric) from public, anon;
grant execute on function public.hb_project_update(uuid, text, numeric, numeric) to authenticated;

-- ===== Rotina em passos: marcar um passo; o dia vira feito (todos), mínimo (pelo menos metade) ou em aberto =====
create or replace function public.hb_step_toggle(p_habit uuid, p_step uuid, p_date date, p_done boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid(); h public.hb_habits; v_today date; v_total int; v_done int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  select * into h from public.hb_habits where id = p_habit and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.form is distinct from 'steps' then raise exception 'not_a_steps_habit' using errcode = '22023'; end if;
  if h.status <> 'active' then raise exception 'habit_not_active' using errcode = '55000'; end if;
  if not exists (select 1 from public.hb_steps where id = p_step and habit_id = p_habit and archived_at is null) then raise exception 'not_found' using errcode = 'P0002'; end if;
  v_today := public.hb_local_today(uid);
  if p_date > v_today then raise exception 'future_date' using errcode = '22008'; end if;
  if p_date < v_today - 7 then raise exception 'edit_window_closed' using errcode = '22008'; end if;
  if p_date < h.started_on then raise exception 'before_start' using errcode = '22008'; end if;
  if p_done then
    insert into public.hb_step_logs (user_id, habit_id, step_id, local_date) values (uid, p_habit, p_step, p_date) on conflict do nothing;
  else
    delete from public.hb_step_logs where step_id = p_step and local_date = p_date and user_id = uid;
  end if;
  select count(*) into v_total from public.hb_steps where habit_id = p_habit and archived_at is null;
  select count(*) into v_done from public.hb_step_logs l join public.hb_steps s on s.id = l.step_id and s.archived_at is null where l.habit_id = p_habit and l.local_date = p_date;
  if v_done = 0 then
    perform public.hb_unlog_as(uid, p_habit, p_date);
  elsif v_done >= v_total then
    perform public.hb_log_as(uid, p_habit, p_date, 'done', null, null, 'app', null);
  elsif v_done * 2 >= v_total then
    perform public.hb_log_as(uid, p_habit, p_date, 'minimum', null, null, 'app', null);
  else
    perform public.hb_unlog_as(uid, p_habit, p_date);
  end if;
  return jsonb_build_object('done', v_done, 'total', v_total);
end $$;
revoke all on function public.hb_step_toggle(uuid, uuid, date, boolean) from public, anon;
grant execute on function public.hb_step_toggle(uuid, uuid, date, boolean) to authenticated;

-- ===== Fotografias: projetos, passos e marcações de passos =====
do $$ begin
  if position('hb_snapshot_as_v4' in pg_get_functiondef('public.hb_snapshot_as(uuid,int)'::regprocedure)) = 0 then
    drop function if exists public.hb_snapshot_as_v4(uuid, int);
    alter function public.hb_snapshot_as(uuid, int) rename to hb_snapshot_as_v4;
  end if;
  if position('hb_snapshot_v4' in pg_get_functiondef('public.hb_snapshot(int)'::regprocedure)) = 0 then
    drop function if exists public.hb_snapshot_v4(int);
    alter function public.hb_snapshot(int) rename to hb_snapshot_v4;
  end if;
end $$;
revoke all on function public.hb_snapshot_as_v4(uuid, int) from public, anon, authenticated;
revoke all on function public.hb_snapshot_v4(int) from public, anon, authenticated;
grant execute on function public.hb_snapshot_as_v4(uuid, int) to service_role;

create or replace function public.hb_forms_extra(p_user uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'habit_id', pr.habit_id, 'title', pr.title, 'total', pr.total, 'current', pr.current, 'unit', pr.unit, 'started_on', pr.started_on, 'finished_on', pr.finished_on) order by pr.created_at)
                         from public.hb_projects pr where pr.user_id = p_user), '[]'::jsonb),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'habit_id', s.habit_id, 'position', s.position, 'title', s.title) order by s.habit_id, s.position)
                       from public.hb_steps s where s.user_id = p_user and s.archived_at is null), '[]'::jsonb),
    'step_logs', coalesce((select jsonb_agg(jsonb_build_object('habit_id', l.habit_id, 'step_id', l.step_id, 'local_date', l.local_date))
                           from public.hb_step_logs l where l.user_id = p_user and l.local_date >= current_date - 60), '[]'::jsonb)
  );
$$;
revoke all on function public.hb_forms_extra(uuid) from public, anon, authenticated;
grant execute on function public.hb_forms_extra(uuid) to service_role;

create or replace function public.hb_snapshot_as(p_user uuid, p_days int default 120)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare base jsonb;
begin
  base := public.hb_snapshot_as_v4(p_user, p_days);
  if base is null then return null; end if;
  return base || public.hb_forms_extra(p_user);
end $$;
revoke all on function public.hb_snapshot_as(uuid, int) from public, anon, authenticated;
grant execute on function public.hb_snapshot_as(uuid, int) to service_role;

create or replace function public.hb_snapshot(p_days int default 180)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare base jsonb;
begin
  base := public.hb_snapshot_v4(p_days);
  return base || public.hb_forms_extra(auth.uid());
end $$;
revoke all on function public.hb_snapshot(int) from public, anon;
grant execute on function public.hb_snapshot(int) to authenticated;
