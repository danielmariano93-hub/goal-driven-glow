-- Nino Hábitos F2: WhatsApp e lembretes. Aditiva. Depende de 20261111150000_habitos_nucleo.sql.
-- Documento: docs/NINO_HABITOS_REFINAMENTO_TECNICO.md (seções 7, 8 e 9; apêndice F).
--  1) preferências de lembrete e de marcar pelo WhatsApp;
--  2) versões "_as" das RPCs de escrita/leitura, só para o serviço (webhook e lembretes), com a MESMA regra das do app;
--  3) catálogo de comunicação dos dois primeiros tipos (hb_cue_reminder e hb_daily_recap).

-- ===== 1) Preferências =====
alter table public.hb_preferences add column if not exists nudges_enabled boolean not null default true;
alter table public.hb_preferences add column if not exists whatsapp_logging boolean not null default true;
alter table public.hb_preferences add column if not exists max_nudges_per_day smallint not null default 2;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hb_preferences_max_nudges_ck') then
    alter table public.hb_preferences add constraint hb_preferences_max_nudges_ck check (max_nudges_per_day between 0 and 3);
  end if;
end $$;

create or replace function public.hb_set_prefs(p jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  insert into public.hb_preferences (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update public.hb_preferences set
    nudges_enabled = case when p ? 'nudges_enabled' then (p->>'nudges_enabled')::boolean else nudges_enabled end,
    whatsapp_logging = case when p ? 'whatsapp_logging' then (p->>'whatsapp_logging')::boolean else whatsapp_logging end,
    max_nudges_per_day = case when p ? 'max_nudges_per_day' then least(3, greatest(0, (p->>'max_nudges_per_day')::int))::smallint else max_nudges_per_day end,
    updated_at = now()
  where user_id = auth.uid();
end $$;
revoke all on function public.hb_set_prefs(jsonb) from public, anon;
grant execute on function public.hb_set_prefs(jsonb) to authenticated;

-- ===== 2) Escrita e leitura como serviço =====
-- hb_log_as: a regra única de registro. A hb_log do app passa a delegar para ela (mesmo comportamento).
create or replace function public.hb_log_as(
  p_user uuid, p_habit uuid, p_date date, p_status text, p_quantity numeric default null, p_note text default null,
  p_source text default 'app', p_idem text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  h public.hb_habits;
  today date;
  wk_start date;
  rests int;
  v_id uuid;
begin
  if p_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_status not in ('done','minimum','rest','skipped','quantity') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if p_source not in ('app','whatsapp','auto','backfill') then raise exception 'invalid_source' using errcode = '22023'; end if;
  select * into h from public.hb_habits where id = p_habit and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.status <> 'active' then raise exception 'habit_not_active' using errcode = '55000'; end if;
  today := public.hb_local_today(p_user);
  if p_date > today then raise exception 'future_date' using errcode = '22008'; end if;
  if p_date < today - 7 then raise exception 'edit_window_closed' using errcode = '22008'; end if;
  if p_date < h.started_on then raise exception 'before_start' using errcode = '22008'; end if;
  if p_status = 'quantity' and h.kind <> 'do_quantity' then raise exception 'quantity_not_supported' using errcode = '22023'; end if;
  if p_status = 'rest' then
    wk_start := p_date - ((extract(isodow from p_date)::int) - 1);
    select count(*) into rests from public.hb_logs
      where habit_id = p_habit and status = 'rest' and local_date between wk_start and wk_start + 6 and local_date <> p_date;
    if rests >= h.rest_per_week then raise exception 'rest_budget_exhausted' using errcode = '54000'; end if;
  end if;
  insert into public.hb_logs (user_id, habit_id, local_date, status, quantity, source, note, idempotency_key)
  values (p_user, p_habit, p_date, p_status, p_quantity, p_source, nullif(btrim(p_note), ''), nullif(p_idem, ''))
  on conflict (habit_id, local_date) do update set
    status = excluded.status, quantity = excluded.quantity, source = excluded.source,
    note = coalesce(excluded.note, public.hb_logs.note), edited_at = now(),
    idempotency_key = coalesce(excluded.idempotency_key, public.hb_logs.idempotency_key)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  select id into v_id from public.hb_logs where user_id = p_user and idempotency_key = p_idem;
  if v_id is null then raise; end if;
  return v_id;
end $$;
revoke all on function public.hb_log_as(uuid, uuid, date, text, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.hb_log_as(uuid, uuid, date, text, numeric, text, text, text) to service_role;

create or replace function public.hb_log(
  p_habit uuid, p_date date, p_status text, p_quantity numeric default null, p_note text default null,
  p_source text default 'app', p_idem text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return public.hb_log_as(auth.uid(), p_habit, p_date, p_status, p_quantity, p_note, p_source, p_idem);
end $$;

create or replace function public.hb_unlog_as(p_user uuid, p_habit uuid, p_date date)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_date < public.hb_local_today(p_user) - 7 then raise exception 'edit_window_closed' using errcode = '22008'; end if;
  delete from public.hb_logs where habit_id = p_habit and local_date = p_date and user_id = p_user;
end $$;
revoke all on function public.hb_unlog_as(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.hb_unlog_as(uuid, uuid, date) to service_role;

create or replace function public.hb_unlog(p_habit uuid, p_date date)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform public.hb_unlog_as(auth.uid(), p_habit, p_date);
end $$;

-- Fotografia para o serviço. Devolve NULL se a pessoa não tem Hábitos liberado (serve de portão para o webhook e os lembretes).
create or replace function public.hb_snapshot_as(p_user uuid, p_days int default 120)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  today date;
  prefs public.hb_preferences;
  tz text;
begin
  if p_user is null or not exists (select 1 from public.hb_access where user_id = p_user) then return null; end if;
  select * into prefs from public.hb_preferences where user_id = p_user;
  select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into tz from public.notification_preferences where user_id = p_user;
  today := public.hb_local_today(p_user);
  return jsonb_build_object(
    'today', today,
    'timezone', coalesce(tz, 'America/Sao_Paulo'),
    'whatsapp_logging', coalesce(prefs.whatsapp_logging, true),
    'nudges_enabled', coalesce(prefs.nudges_enabled, true),
    'max_nudges_per_day', coalesce(prefs.max_nudges_per_day, 2),
    'habits', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at) from public.hb_habits h where h.user_id = p_user and h.status = 'active'), '[]'::jsonb),
    'logs', coalesce((select jsonb_agg(jsonb_build_object('habit_id', l.habit_id, 'local_date', l.local_date, 'status', l.status, 'quantity', l.quantity, 'source', l.source, 'logged_at', l.logged_at))
                       from public.hb_logs l where l.user_id = p_user and l.local_date >= today - greatest(7, least(p_days, 400))), '[]'::jsonb)
  );
end $$;
revoke all on function public.hb_snapshot_as(uuid, int) from public, anon, authenticated;
grant execute on function public.hb_snapshot_as(uuid, int) to service_role;

-- A snapshot do app também devolve as preferências (a tela Mais precisa delas).
create or replace function public.hb_snapshot(p_days int default 180)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  today date;
  prefs public.hb_preferences;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  today := public.hb_local_today(uid);
  select * into prefs from public.hb_preferences where user_id = uid;
  return jsonb_build_object(
    'today', today,
    'mode', coalesce(prefs.last_mode, 'money'),
    'whatsapp_logging', coalesce(prefs.whatsapp_logging, true),
    'nudges_enabled', coalesce(prefs.nudges_enabled, true),
    'max_nudges_per_day', coalesce(prefs.max_nudges_per_day, 2),
    'habits', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at) from public.hb_habits h where h.user_id = uid and h.status <> 'archived'), '[]'::jsonb),
    'logs', coalesce((select jsonb_agg(jsonb_build_object('habit_id', l.habit_id, 'local_date', l.local_date, 'status', l.status, 'quantity', l.quantity, 'source', l.source))
                       from public.hb_logs l where l.user_id = uid and l.local_date >= today - greatest(7, least(p_days, 400))), '[]'::jsonb)
  );
end $$;

-- ===== 3) Catálogo de comunicação (conteúdo determinístico: o texto vem do próprio lembrete) =====
insert into public.communication_catalog
  (kind, label, family, description, base_priority, allowed_channels, default_channels, cooldown_hours, max_per_day, content_mode,
   sensitivity, fallback_policy, min_severity_for_whatsapp, stale_policy, default_window_hours, min_utility_score,
   whatsapp_min_confidence, whatsapp_min_absolute_impact, requires_manual_approval, same_pattern_cooldown_days, active)
values
  ('hb_cue_reminder', 'Lembrete do gatilho do hábito', 'habitos',
   'Reforço do gatilho: só sai se o hábito ainda não foi registrado até 90 min depois do horário combinado.',
   30, array['app','whatsapp']::text[], array['app','whatsapp']::text[], 6, 2, 'deterministic',
   'normal', 'app_only', 'info', 'drop_after_window', 10, 0.5, 0.7, 0, false, 0, true),
  ('hb_daily_recap', 'Resumo do dia dos hábitos', 'habitos',
   'Fim do dia: o que ficou pendente nos hábitos. Só sai se houver pendência.',
   20, array['app','whatsapp']::text[], array['app','whatsapp']::text[], 20, 1, 'deterministic',
   'normal', 'app_only', 'info', 'drop_after_window', 3, 0.5, 0.7, 0, false, 0, true)
on conflict (kind) do update set
  label = excluded.label, description = excluded.description, allowed_channels = excluded.allowed_channels,
  default_channels = excluded.default_channels, cooldown_hours = excluded.cooldown_hours, max_per_day = excluded.max_per_day,
  content_mode = excluded.content_mode, min_severity_for_whatsapp = excluded.min_severity_for_whatsapp,
  stale_policy = excluded.stale_policy, default_window_hours = excluded.default_window_hours, active = true;
