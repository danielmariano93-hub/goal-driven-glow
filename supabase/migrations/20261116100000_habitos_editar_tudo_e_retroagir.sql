-- Hábitos: (1) quase tudo do hábito passa a ser editável; (2) dá para registrar dias anteriores (até 90 dias),
-- e o início do hábito recua sozinho para o primeiro dia registrado. Idempotente.

-- (1) Edição ampliada: unidade, dias da semana, intervalo (cuidado recorrente) e início.
create or replace function public.hb_update_habit(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  old public.hb_habits;
  today date;
  new_start date;
  new_days smallint[];
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into old from public.hb_habits where id = p_id and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  today := public.hb_local_today(uid);

  if p ? 'started_on' then
    new_start := nullif(p->>'started_on','')::date;
    if new_start is null or new_start > today then raise exception 'invalid_start' using errcode = '22008'; end if;
    if new_start < today - 400 then raise exception 'invalid_start' using errcode = '22008'; end if;
  else
    new_start := old.started_on;
  end if;

  if p ? 'days_of_week' then
    if jsonb_typeof(p->'days_of_week') = 'null' then new_days := null;
    else select coalesce(array_agg(x::smallint order by x::smallint), '{}') into new_days from jsonb_array_elements_text(p->'days_of_week') x;
      if new_days = '{}' then new_days := null; end if;
    end if;
  else
    new_days := old.days_of_week;
  end if;

  update public.hb_habits set
    title = coalesce(nullif(btrim(p->>'title'), ''), title),
    cue_kind = case when p ? 'cue_kind' then nullif(p->>'cue_kind','') else cue_kind end,
    cue_text = case when p ? 'cue_text' then nullif(btrim(p->>'cue_text'),'') else cue_text end,
    cue_time = case when p ? 'cue_time' then nullif(p->>'cue_time','')::time else cue_time end,
    minimum_text = case when p ? 'minimum_text' then nullif(btrim(p->>'minimum_text'),'') else minimum_text end,
    craving_plan = case when p ? 'craving_plan' then nullif(btrim(p->>'craving_plan'),'') else craving_plan end,
    weekly_target = case when p ? 'weekly_target' then nullif(p->>'weekly_target','')::smallint else weekly_target end,
    quantity_target = case when p ? 'quantity_target' then nullif(p->>'quantity_target','')::numeric else quantity_target end,
    quantity_unit = case when p ? 'quantity_unit' then nullif(btrim(p->>'quantity_unit'),'') else quantity_unit end,
    interval_days = case when p ? 'interval_days' then nullif(p->>'interval_days','')::int else interval_days end,
    rest_per_week = case when p ? 'rest_per_week' then (p->>'rest_per_week')::smallint else rest_per_week end,
    days_of_week = new_days,
    started_on = new_start,
    updated_at = now()
  where id = p_id;
  insert into public.hb_habit_revisions (habit_id, user_id, before, after)
  select p_id, uid, to_jsonb(old), to_jsonb(h) from public.hb_habits h where h.id = p_id;
end $$;

-- (2) Registro retroativo: origem 'backfill' vale até 90 dias e recua o início do hábito.
-- Lê a função atual e troca só as duas regras de data, sem reescrever o resto.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'hb_log_as';
  if def not like '%hb_backfill_v1%' then
    def := replace(def,
      E'  if p_date < today - 7 then raise exception ''edit_window_closed'' using errcode = ''22008''; end if;',
      E'  -- hb_backfill_v1\n  if p_date < today - (case when p_source = ''backfill'' then 90 else 7 end) then raise exception ''edit_window_closed'' using errcode = ''22008''; end if;');
    def := replace(def,
      E'  if p_date < h.started_on then raise exception ''before_start'' using errcode = ''22008''; end if;',
      E'  if p_date < h.started_on then\n    if p_source <> ''backfill'' then raise exception ''before_start'' using errcode = ''22008''; end if;\n    update public.hb_habits set started_on = p_date, updated_at = now() where id = p_habit;\n  end if;');
    if def not like '%hb_backfill_v1%' or def not like '%p_source <> ''backfill''%' then
      raise exception 'hb_log_as: padrão não encontrado, nada alterado';
    end if;
    execute def;
  end if;
end $$;
