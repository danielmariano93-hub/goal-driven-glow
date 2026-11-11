-- Nino Hábitos (M1 = F0 + F1): núcleo de dados. Aditiva e atrás de `hb_access` (liberação por usuário).
-- Documento: docs/NINO_HABITOS_REFINAMENTO_TECNICO.md (seções 3, 4 e 9).
-- Prefixo hb_ para não colidir com `habit_*`/`habits_v2_*` (padrões de comportamento financeiro).
-- Leitura: RLS por dono. Escrita: SOMENTE por RPC SECURITY DEFINER (validação, limites e idempotência).

-- ===== Liberação por usuário (mesmo padrão de habits_v2_access / open_finance_access) =====
create table if not exists public.hb_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text
);
alter table public.hb_access enable row level security;
drop policy if exists hb_access_select_own on public.hb_access;
create policy hb_access_select_own on public.hb_access for select to authenticated using (user_id = auth.uid());
revoke all on public.hb_access from anon, public;
grant select on public.hb_access to authenticated;

create or replace function public.hb_enabled()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.hb_access where user_id = auth.uid());
$$;
revoke all on function public.hb_enabled() from public, anon;
grant execute on function public.hb_enabled() to authenticated, service_role;

-- ===== Preferências =====
create table if not exists public.hb_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_mode text not null default 'money' check (last_mode in ('money','habits')),
  consent_sensitive_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hb_preferences enable row level security;
drop policy if exists hb_preferences_select_own on public.hb_preferences;
create policy hb_preferences_select_own on public.hb_preferences for select to authenticated using (user_id = auth.uid());
revoke all on public.hb_preferences from anon, public;
grant select on public.hb_preferences to authenticated;

-- ===== Catálogo de hábitos prontos =====
create table if not exists public.hb_templates (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  version int not null default 1,
  title text not null,
  area text not null check (area in ('body','mind','routine','money','other')),
  kind text not null check (kind in ('do_daily','do_weekly_count','do_quantity','quit')),
  sensitivity text not null default 'normal' check (sensitivity in ('normal','health','substance')),
  cue_suggestion text,
  minimum_suggestion text,
  why_it_works text,
  weekly_target smallint,
  quantity_target numeric,
  quantity_unit text,
  quantity_period text check (quantity_period in ('day','week')),
  sort_order int not null default 100,
  active boolean not null default true
);
alter table public.hb_templates enable row level security;
drop policy if exists hb_templates_select_active on public.hb_templates;
create policy hb_templates_select_active on public.hb_templates for select to authenticated using (active);
revoke all on public.hb_templates from anon, public;
grant select on public.hb_templates to authenticated;

insert into public.hb_templates (slug, title, area, kind, cue_suggestion, minimum_suggestion, why_it_works, weekly_target, quantity_target, quantity_unit, quantity_period, sort_order) values
  ('caminhar-20', 'Caminhar 20 min', 'body', 'do_daily', 'Depois do almoço', 'Caminhar 5 minutos', 'Ligar a caminhada a algo que você já faz todo dia é mais firme do que depender de alarme.', null, null, null, null, 10),
  ('treinar-3x', 'Treinar', 'body', 'do_weekly_count', 'Depois do trabalho', 'Fazer 10 minutos', 'Meta por semana, não por dia, deixa espaço para os dias ruins.', 3, null, null, null, 20),
  ('meditar-5', 'Meditar 5 min', 'mind', 'do_daily', 'Depois de tomar café', '3 respirações', 'Começar pequeno e repetir no mesmo momento do dia é o que faz virar rotina.', null, null, null, null, 30),
  ('ler-10', 'Ler 10 páginas', 'mind', 'do_quantity', 'Antes de dormir', 'Ler 1 página', 'Uma quantidade pequena e fixa é mais fácil de manter do que "ler mais".', null, 10, 'páginas', 'day', 40),
  ('agua-2l', 'Beber 2 L de água', 'body', 'do_quantity', 'Ao longo do dia', 'Mais 1 copo', 'Um número claro no dia evita o "acho que bebi".', null, 2, 'litros', 'day', 50),
  ('dormir-23', 'Dormir antes das 23h', 'routine', 'do_daily', 'Depois de escovar os dentes', 'Deitar 15 minutos mais cedo', 'Começar 15 minutos mais cedo é mais realista do que mudar o horário de uma vez.', null, null, null, null, 60)
on conflict (slug) do nothing;

-- ===== Hábitos =====
create table if not exists public.hb_habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid references public.hb_templates(id) on delete set null,
  kind text not null check (kind in ('do_daily','do_weekly_count','do_quantity','quit')),
  title text not null check (char_length(title) between 2 and 80),
  area text not null check (area in ('body','mind','routine','money','other')),
  sensitivity text not null default 'normal' check (sensitivity in ('normal','health','substance')),
  cue_kind text check (cue_kind in ('after_event','at_time','at_place','free')),
  cue_text text check (char_length(cue_text) <= 120),
  cue_time time,
  minimum_text text check (char_length(minimum_text) <= 120),
  days_of_week smallint[] check (days_of_week is null or days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  weekly_target smallint check (weekly_target is null or weekly_target between 1 and 7),
  quantity_target numeric check (quantity_target is null or quantity_target > 0),
  quantity_unit text check (char_length(quantity_unit) <= 20),
  quantity_period text check (quantity_period in ('day','week')),
  rest_per_week smallint not null default 1 check (rest_per_week between 0 and 3),
  status text not null default 'active' check (status in ('active','paused','archived')),
  started_on date not null,
  paused_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hb_habits_weekly_ck check (kind <> 'do_weekly_count' or weekly_target is not null),
  constraint hb_habits_quantity_ck check (kind <> 'do_quantity' or (quantity_target is not null and quantity_period is not null))
);
create index if not exists hb_habits_user_active_idx on public.hb_habits (user_id) where status = 'active';
alter table public.hb_habits enable row level security;
drop policy if exists hb_habits_select_own on public.hb_habits;
create policy hb_habits_select_own on public.hb_habits for select to authenticated using (user_id = auth.uid());
revoke all on public.hb_habits from anon, public;
grant select on public.hb_habits to authenticated;

-- ===== Registros =====
create table if not exists public.hb_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  local_date date not null,
  status text not null check (status in ('done','minimum','rest','skipped','quantity')),
  quantity numeric check (quantity is null or quantity >= 0),
  source text not null default 'app' check (source in ('app','whatsapp','auto','backfill')),
  note text check (char_length(note) <= 280),
  logged_at timestamptz not null default now(),
  edited_at timestamptz,
  idempotency_key text,
  unique (habit_id, local_date)
);
create unique index if not exists hb_logs_idem_idx on public.hb_logs (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists hb_logs_user_date_idx on public.hb_logs (user_id, local_date);
alter table public.hb_logs enable row level security;
drop policy if exists hb_logs_select_own on public.hb_logs;
create policy hb_logs_select_own on public.hb_logs for select to authenticated using (user_id = auth.uid());
revoke all on public.hb_logs from anon, public;
grant select on public.hb_logs to authenticated;

-- ===== Histórico de alterações de definição (a leitura do passado não muda com edição nova) =====
create table if not exists public.hb_habit_revisions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  changed_at timestamptz not null default now(),
  before jsonb not null,
  after jsonb not null
);
create index if not exists hb_habit_revisions_habit_idx on public.hb_habit_revisions (habit_id, changed_at desc);
alter table public.hb_habit_revisions enable row level security;
drop policy if exists hb_habit_revisions_select_own on public.hb_habit_revisions;
create policy hb_habit_revisions_select_own on public.hb_habit_revisions for select to authenticated using (user_id = auth.uid());
revoke all on public.hb_habit_revisions from anon, public;
grant select on public.hb_habit_revisions to authenticated;

-- ===== Dia local da pessoa (virada às 03:00: registrar "dormi cedo" às 00:30 conta para o dia anterior) =====
create or replace function public.hb_local_today(p_user uuid default auth.uid())
returns date language sql stable security definer set search_path to 'public' as $$
  -- Só lê o fuso do próprio chamador (ou do serviço): outra pessoa cai no padrão, sem revelar o fuso alheio.
  select ((now() at time zone coalesce(
      (select nullif(timezone, '') from public.notification_preferences
        where user_id = p_user and (p_user = auth.uid() or auth.role() = 'service_role')),
      'America/Sao_Paulo')) - interval '3 hours')::date;
$$;
revoke all on function public.hb_local_today(uuid) from public, anon;
grant execute on function public.hb_local_today(uuid) to authenticated, service_role;

-- ===== Modo (Dinheiro | Hábitos) =====
create or replace function public.hb_set_mode(p_mode text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  if p_mode not in ('money','habits') then raise exception 'invalid_mode' using errcode = '22023'; end if;
  insert into public.hb_preferences (user_id, last_mode) values (auth.uid(), p_mode)
  on conflict (user_id) do update set last_mode = excluded.last_mode, updated_at = now();
end $$;
revoke all on function public.hb_set_mode(text) from public, anon;
grant execute on function public.hb_set_mode(text) to authenticated;

-- ===== Criar hábito =====
create or replace function public.hb_create_habit(p jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  v_kind text := p->>'kind';
  v_sens text := coalesce(p->>'sensitivity', 'normal');
  v_id uuid;
  v_days smallint[];
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  if v_kind not in ('do_daily','do_weekly_count','do_quantity') then raise exception 'unsupported_kind' using errcode = '22023'; end if;
  if v_sens <> 'normal' then
    if not exists (select 1 from public.hb_preferences where user_id = uid and consent_sensitive_at is not null) then
      raise exception 'consent_required' using errcode = '42501';
    end if;
  end if;
  if (select count(*) from public.hb_habits where user_id = uid and status = 'active') >= 5 then
    raise exception 'habit_limit_reached' using errcode = '54000';
  end if;
  if p ? 'days_of_week' and jsonb_typeof(p->'days_of_week') = 'array' and jsonb_array_length(p->'days_of_week') > 0 then
    select array_agg(x::smallint order by x::smallint) into v_days from jsonb_array_elements_text(p->'days_of_week') x;
  end if;
  insert into public.hb_habits (
    user_id, template_id, kind, title, area, sensitivity, cue_kind, cue_text, cue_time, minimum_text, days_of_week,
    weekly_target, quantity_target, quantity_unit, quantity_period, rest_per_week, started_on
  ) values (
    uid, nullif(p->>'template_id','')::uuid, v_kind, btrim(p->>'title'), coalesce(p->>'area','other'), v_sens,
    nullif(p->>'cue_kind',''), nullif(btrim(p->>'cue_text'),''), nullif(p->>'cue_time','')::time,
    nullif(btrim(p->>'minimum_text'),''), v_days,
    nullif(p->>'weekly_target','')::smallint, nullif(p->>'quantity_target','')::numeric, nullif(p->>'quantity_unit',''),
    nullif(p->>'quantity_period',''), coalesce(nullif(p->>'rest_per_week','')::smallint, 1),
    case when coalesce((p->>'start_today')::boolean, false) then public.hb_local_today(uid) else public.hb_local_today(uid) + 1 end
  ) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.hb_create_habit(jsonb) from public, anon;
grant execute on function public.hb_create_habit(jsonb) to authenticated;

-- ===== Editar hábito (guarda a revisão) =====
create or replace function public.hb_update_habit(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  old public.hb_habits;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into old from public.hb_habits where id = p_id and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.hb_habits set
    title = coalesce(nullif(btrim(p->>'title'), ''), title),
    cue_kind = case when p ? 'cue_kind' then nullif(p->>'cue_kind','') else cue_kind end,
    cue_text = case when p ? 'cue_text' then nullif(btrim(p->>'cue_text'),'') else cue_text end,
    cue_time = case when p ? 'cue_time' then nullif(p->>'cue_time','')::time else cue_time end,
    minimum_text = case when p ? 'minimum_text' then nullif(btrim(p->>'minimum_text'),'') else minimum_text end,
    weekly_target = case when p ? 'weekly_target' then nullif(p->>'weekly_target','')::smallint else weekly_target end,
    quantity_target = case when p ? 'quantity_target' then nullif(p->>'quantity_target','')::numeric else quantity_target end,
    rest_per_week = case when p ? 'rest_per_week' then (p->>'rest_per_week')::smallint else rest_per_week end,
    updated_at = now()
  where id = p_id;
  insert into public.hb_habit_revisions (habit_id, user_id, before, after)
  select p_id, uid, to_jsonb(old), to_jsonb(h) from public.hb_habits h where h.id = p_id;
end $$;
revoke all on function public.hb_update_habit(uuid, jsonb) from public, anon;
grant execute on function public.hb_update_habit(uuid, jsonb) to authenticated;

-- ===== Pausar, arquivar, reativar =====
create or replace function public.hb_set_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_status not in ('active','paused','archived') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if p_status = 'active' and (select count(*) from public.hb_habits where user_id = uid and status = 'active' and id <> p_id) >= 5 then
    raise exception 'habit_limit_reached' using errcode = '54000';
  end if;
  update public.hb_habits set
    status = p_status,
    paused_at = case when p_status = 'paused' then now() else null end,
    archived_at = case when p_status = 'archived' then now() else null end,
    updated_at = now()
  where id = p_id and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.hb_set_status(uuid, text) from public, anon;
grant execute on function public.hb_set_status(uuid, text) to authenticated;

-- ===== Registrar o dia (idempotente; substitui o estado do dia) =====
create or replace function public.hb_log(
  p_habit uuid, p_date date, p_status text, p_quantity numeric default null, p_note text default null,
  p_source text default 'app', p_idem text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  h public.hb_habits;
  today date;
  wk_start date;
  rests int;
  v_id uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_status not in ('done','minimum','rest','skipped','quantity') then raise exception 'invalid_status' using errcode = '22023'; end if;
  if p_source not in ('app','whatsapp','auto','backfill') then raise exception 'invalid_source' using errcode = '22023'; end if;
  select * into h from public.hb_habits where id = p_habit and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.status <> 'active' then raise exception 'habit_not_active' using errcode = '55000'; end if;
  today := public.hb_local_today(uid);
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
  values (uid, p_habit, p_date, p_status, p_quantity, p_source, nullif(btrim(p_note), ''), nullif(p_idem, ''))
  on conflict (habit_id, local_date) do update set
    status = excluded.status, quantity = excluded.quantity, source = excluded.source,
    note = coalesce(excluded.note, public.hb_logs.note), edited_at = now(),
    idempotency_key = coalesce(excluded.idempotency_key, public.hb_logs.idempotency_key)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  -- mesma chave de idempotência já gravada: devolve o registro existente
  select id into v_id from public.hb_logs where user_id = uid and idempotency_key = p_idem;
  if v_id is null then raise; end if;
  return v_id;
end $$;
revoke all on function public.hb_log(uuid, date, text, numeric, text, text, text) from public, anon;
grant execute on function public.hb_log(uuid, date, text, numeric, text, text, text) to authenticated;

-- ===== Desfazer o registro do dia =====
create or replace function public.hb_unlog(p_habit uuid, p_date date)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_date < public.hb_local_today(uid) - 7 then raise exception 'edit_window_closed' using errcode = '22008'; end if;
  delete from public.hb_logs where habit_id = p_habit and local_date = p_date and user_id = uid;
end $$;
revoke all on function public.hb_unlog(uuid, date) from public, anon;
grant execute on function public.hb_unlog(uuid, date) to authenticated;

-- ===== Fotografia para as telas: hábitos, registros e hoje, em uma chamada =====
create or replace function public.hb_snapshot(p_days int default 180)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  today date;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  today := public.hb_local_today(uid);
  return jsonb_build_object(
    'today', today,
    'mode', coalesce((select last_mode from public.hb_preferences where user_id = uid), 'money'),
    'habits', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at) from public.hb_habits h where h.user_id = uid and h.status <> 'archived'), '[]'::jsonb),
    'logs', coalesce((select jsonb_agg(jsonb_build_object('habit_id', l.habit_id, 'local_date', l.local_date, 'status', l.status, 'quantity', l.quantity, 'source', l.source))
                       from public.hb_logs l where l.user_id = uid and l.local_date >= today - greatest(7, least(p_days, 400))), '[]'::jsonb)
  );
end $$;
revoke all on function public.hb_snapshot(int) from public, anon;
grant execute on function public.hb_snapshot(int) to authenticated;
