-- Nino Hábitos M3 (F3 + F4): largar, vontade, recaída sem culpa, estimativa de dinheiro, automaticidade, manutenção, pausa e consentimento.
-- Aditiva. Depende de 20261111150000_habitos_nucleo.sql e 20261111210000_habitos_f2_whatsapp_lembretes.sql.
-- Documento: docs/NINO_HABITOS_REFINAMENTO_TECNICO.md (seções 3, 4, 6.2, 6.1 e 11; apêndice H).

-- ===== Colunas novas =====
alter table public.hb_habits add column if not exists craving_plan text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hb_habits_craving_plan_ck') then
    alter table public.hb_habits add constraint hb_habits_craving_plan_ck check (craving_plan is null or char_length(craving_plan) <= 160);
  end if;
end $$;
alter table public.hb_templates add column if not exists craving_suggestion text;

-- ===== Pausas (os dias pausados não contam como falha) =====
create table if not exists public.hb_pauses (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_date date not null,
  to_date date,
  created_at timestamptz not null default now()
);
create unique index if not exists hb_pauses_open_idx on public.hb_pauses (habit_id) where to_date is null;
create index if not exists hb_pauses_user_idx on public.hb_pauses (user_id);

-- ===== Largar: ciclos, vontades, recaídas =====
create table if not exists public.hb_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  started_on date not null,
  ended_on date,
  end_reason text check (end_reason in ('relapse','manual_reset','archived')),
  baseline_daily_cost numeric check (baseline_daily_cost is null or baseline_daily_cost >= 0),
  baseline_source text check (baseline_source in ('nino_data','user_informed')),
  baseline_n_days int,
  trigger_tags text[],
  created_at timestamptz not null default now()
);
create unique index if not exists hb_cycles_open_idx on public.hb_cycles (habit_id) where ended_on is null;
create index if not exists hb_cycles_user_idx on public.hb_cycles (user_id, habit_id);

create table if not exists public.hb_cravings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  local_date date not null,
  handled boolean,
  context_tags text[]
);
create index if not exists hb_cravings_user_idx on public.hb_cravings (user_id, habit_id, occurred_at desc);

create table if not exists public.hb_slips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  cycle_id uuid references public.hb_cycles(id) on delete set null,
  local_date date not null,
  reset boolean not null,
  tags text[],
  created_at timestamptz not null default now()
);
create index if not exists hb_slips_user_idx on public.hb_slips (user_id, habit_id, local_date desc);

-- ===== Ligação com o dinheiro (categoria) =====
create table if not exists public.hb_money_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  ref_label text,
  unique (habit_id)
);

-- ===== Automaticidade (autorrelato de 1 a 7) =====
create table if not exists public.hb_automaticity_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  answered_on date not null,
  answered_at timestamptz not null default now(),
  score smallint check (score between 1 and 7),
  skipped boolean not null default false,
  unique (habit_id, answered_on),
  constraint hb_auto_score_or_skip_ck check (skipped or score is not null)
);
create index if not exists hb_auto_user_idx on public.hb_automaticity_checkins (user_id, habit_id, answered_on desc);

-- ===== RLS: leitura só do dono; escrita só por RPC =====
do $$
declare t text;
begin
  foreach t in array array['hb_pauses','hb_cycles','hb_cravings','hb_slips','hb_money_links','hb_automaticity_checkins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())', t || '_select_own', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ===== Consentimento para hábitos de saúde e substâncias =====
create or replace function public.hb_grant_consent()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  insert into public.hb_preferences (user_id, consent_sensitive_at) values (auth.uid(), now())
  on conflict (user_id) do update set consent_sensitive_at = coalesce(public.hb_preferences.consent_sensitive_at, now()), updated_at = now();
end $$;
revoke all on function public.hb_grant_consent() from public, anon;
grant execute on function public.hb_grant_consent() to authenticated;

create or replace function public.hb_revoke_consent()
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.hb_preferences set consent_sensitive_at = null, updated_at = now() where user_id = auth.uid();
end $$;
revoke all on function public.hb_revoke_consent() from public, anon;
grant execute on function public.hb_revoke_consent() to authenticated;

-- ===== Dinheiro: consumo real de uma categoria (mesmo filtro do motor financeiro: confirmado, despesa, sem transferência,
-- sem pagamento de fatura, sem substituído e sem parcela 2+ de compra parcelada) =====
create or replace function public.hb_category_spend(p_user uuid, p_category uuid, p_from date, p_to date)
returns numeric language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_user is distinct from auth.uid() and coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select sum(t.amount) from public.transactions t
    where t.user_id = p_user and t.category_id = p_category and t.status = 'confirmed' and t.type = 'expense'
      and t.transfer_group_id is null and coalesce(t.movement_kind, 'transaction') = 'transaction'
      and t.settles_card_id is null and t.superseded_by is null
      and not (coalesce(t.installment_number, 1) > 1 and coalesce(t.installments_total, 0) > 1 and (t.credit_card_id is not null or t.payment_method = 'credit_card'))
      and t.occurred_at >= p_from and t.occurred_at <= p_to
  ), 0);
end $$;
revoke all on function public.hb_category_spend(uuid, uuid, date, date) from public, anon;
grant execute on function public.hb_category_spend(uuid, uuid, date, date) to authenticated, service_role;

-- Média diária dos 90 dias ANTES de `p_before` (com corte no percentil 95 dos dias, para um dia atípico não inflar).
create or replace function public.hb_category_baseline(p_user uuid, p_category uuid, p_before date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  d0 date := p_before - 90;
  p95 numeric; avg_cost numeric; n_tx int; first_on date;
begin
  if p_user is distinct from auth.uid() and coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  with tx as (
    select t.occurred_at as d, t.amount from public.transactions t
    where t.user_id = p_user and t.category_id = p_category and t.status = 'confirmed' and t.type = 'expense'
      and t.transfer_group_id is null and coalesce(t.movement_kind, 'transaction') = 'transaction'
      and t.settles_card_id is null and t.superseded_by is null
      and not (coalesce(t.installment_number, 1) > 1 and coalesce(t.installments_total, 0) > 1 and (t.credit_card_id is not null or t.payment_method = 'credit_card'))
      and t.occurred_at >= d0 and t.occurred_at < p_before
  ), days as (
    select gs::date as d from generate_series(d0, p_before - 1, interval '1 day') gs
  ), daily as (
    select days.d, coalesce(sum(tx.amount), 0) as s from days left join tx on tx.d = days.d group by days.d
  )
  select (select percentile_cont(0.95) within group (order by s) from daily),
         (select avg(least(s, (select percentile_cont(0.95) within group (order by s) from daily))) from daily),
         (select count(*) from tx), (select min(d) from tx)
    into p95, avg_cost, n_tx, first_on;
  return jsonb_build_object(
    'daily_cost', round(coalesce(avg_cost, 0), 2), 'n_tx', coalesce(n_tx, 0), 'first_tx_on', first_on, 'window_days', 90,
    'enough', coalesce(n_tx, 0) >= 3 and first_on is not null and (p_before - first_on) >= 28
  );
end $$;
revoke all on function public.hb_category_baseline(uuid, uuid, date) from public, anon;
grant execute on function public.hb_category_baseline(uuid, uuid, date) to authenticated, service_role;

-- ===== Criar hábito (agora também "largar") =====
create or replace function public.hb_create_habit(p jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  v_kind text := p->>'kind';
  v_sens text := coalesce(p->>'sensitivity', 'normal');
  v_id uuid;
  v_days smallint[];
  v_today date;
  v_cat uuid := nullif(p->>'money_category_id', '')::uuid;
  v_informed numeric := nullif(p->>'daily_cost', '')::numeric;
  v_base jsonb;
  v_cost numeric; v_src text; v_n int;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  if v_kind not in ('do_daily','do_weekly_count','do_quantity','quit') then raise exception 'unsupported_kind' using errcode = '22023'; end if;
  if v_sens <> 'normal' then
    if not exists (select 1 from public.hb_preferences where user_id = uid and consent_sensitive_at is not null) then
      raise exception 'consent_required' using errcode = '42501';
    end if;
  end if;
  if (select count(*) from public.hb_habits where user_id = uid and status = 'active') >= 5 then
    raise exception 'habit_limit_reached' using errcode = '54000';
  end if;
  v_today := public.hb_local_today(uid);
  if p ? 'days_of_week' and jsonb_typeof(p->'days_of_week') = 'array' and jsonb_array_length(p->'days_of_week') > 0 then
    select array_agg(x::smallint order by x::smallint) into v_days from jsonb_array_elements_text(p->'days_of_week') x;
  end if;
  insert into public.hb_habits (
    user_id, template_id, kind, title, area, sensitivity, cue_kind, cue_text, cue_time, minimum_text, days_of_week,
    weekly_target, quantity_target, quantity_unit, quantity_period, rest_per_week, craving_plan, started_on
  ) values (
    uid, nullif(p->>'template_id','')::uuid, v_kind, btrim(p->>'title'), coalesce(p->>'area','other'), v_sens,
    nullif(p->>'cue_kind',''), nullif(btrim(p->>'cue_text'),''), nullif(p->>'cue_time','')::time,
    nullif(btrim(p->>'minimum_text'),''), v_days,
    nullif(p->>'weekly_target','')::smallint, nullif(p->>'quantity_target','')::numeric, nullif(p->>'quantity_unit',''),
    nullif(p->>'quantity_period',''), coalesce(nullif(p->>'rest_per_week','')::smallint, 1),
    nullif(btrim(p->>'craving_plan'), ''),
    case when v_kind = 'quit' then v_today
         when coalesce((p->>'start_today')::boolean, false) then v_today else v_today + 1 end
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
  return v_id;
end $$;

-- ===== Editar hábito (agora inclui o plano da vontade) =====
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
    craving_plan = case when p ? 'craving_plan' then nullif(btrim(p->>'craving_plan'),'') else craving_plan end,
    weekly_target = case when p ? 'weekly_target' then nullif(p->>'weekly_target','')::smallint else weekly_target end,
    quantity_target = case when p ? 'quantity_target' then nullif(p->>'quantity_target','')::numeric else quantity_target end,
    rest_per_week = case when p ? 'rest_per_week' then (p->>'rest_per_week')::smallint else rest_per_week end,
    updated_at = now()
  where id = p_id;
  insert into public.hb_habit_revisions (habit_id, user_id, before, after)
  select p_id, uid, to_jsonb(old), to_jsonb(h) from public.hb_habits h where h.id = p_id;
end $$;

-- ===== Pausar, retomar, arquivar (com registro dos períodos de pausa) =====
create or replace function public.hb_set_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  uid uuid := auth.uid();
  h public.hb_habits;
  v_today date;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_status not in ('active','paused','archived') then raise exception 'invalid_status' using errcode = '22023'; end if;
  select * into h from public.hb_habits where id = p_id and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_status = 'paused' and h.kind = 'quit' then raise exception 'quit_cannot_pause' using errcode = '22023'; end if;
  if p_status = 'active' and h.status <> 'active' and (select count(*) from public.hb_habits where user_id = uid and status = 'active' and id <> p_id) >= 5 then
    raise exception 'habit_limit_reached' using errcode = '54000';
  end if;
  v_today := public.hb_local_today(uid);
  if p_status = 'paused' and h.status = 'active' then
    insert into public.hb_pauses (habit_id, user_id, from_date) values (p_id, uid, v_today) on conflict do nothing;
  elsif p_status in ('active', 'archived') then
    -- fecha a pausa aberta: pausa que começou hoje some; as demais terminam ontem
    delete from public.hb_pauses where habit_id = p_id and to_date is null and from_date >= v_today;
    update public.hb_pauses set to_date = v_today - 1 where habit_id = p_id and to_date is null;
  end if;
  if p_status = 'archived' and h.kind = 'quit' then
    update public.hb_cycles set ended_on = v_today, end_reason = 'archived' where habit_id = p_id and ended_on is null;
  end if;
  update public.hb_habits set
    status = p_status,
    paused_at = case when p_status = 'paused' then now() else null end,
    archived_at = case when p_status = 'archived' then now() else null end,
    updated_at = now()
  where id = p_id;
end $$;

-- ===== Vontade e recaída (versões de serviço; as do app delegam) =====
create or replace function public.hb_craving_as(p_user uuid, p_habit uuid, p_tags text[] default '{}')
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare h public.hb_habits; v_id uuid;
begin
  if p_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into h from public.hb_habits where id = p_habit and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.kind <> 'quit' then raise exception 'not_a_quit_habit' using errcode = '22023'; end if;
  if h.status <> 'active' then raise exception 'habit_not_active' using errcode = '55000'; end if;
  insert into public.hb_cravings (user_id, habit_id, local_date, context_tags) values (p_user, p_habit, public.hb_local_today(p_user), p_tags)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.hb_craving_as(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.hb_craving_as(uuid, uuid, text[]) to service_role;

create or replace function public.hb_craving(p_habit uuid, p_tags text[] default '{}')
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return public.hb_craving_as(auth.uid(), p_habit, p_tags);
end $$;
revoke all on function public.hb_craving(uuid, text[]) from public, anon;
grant execute on function public.hb_craving(uuid, text[]) to authenticated;

create or replace function public.hb_craving_answer_as(p_user uuid, p_craving uuid, p_handled boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  update public.hb_cravings set handled = p_handled where id = p_craving and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.hb_craving_answer_as(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.hb_craving_answer_as(uuid, uuid, boolean) to service_role;

create or replace function public.hb_craving_answer(p_craving uuid, p_handled boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform public.hb_craving_answer_as(auth.uid(), p_craving, p_handled);
end $$;
revoke all on function public.hb_craving_answer(uuid, boolean) from public, anon;
grant execute on function public.hb_craving_answer(uuid, boolean) to authenticated;

-- Recaída: registra o escorregão e, se `p_reset`, encerra o ciclo e abre outro NA DATA do escorregão (dias sem = dias desde a última ocorrência).
-- O recorde, o total de dias sem e o histórico ficam. Sem `p_reset`, só anota (a contagem continua).
create or replace function public.hb_relapse_as(p_user uuid, p_habit uuid, p_reset boolean, p_tags text[] default '{}', p_date date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  h public.hb_habits; c public.hb_cycles; v_today date; v_date date; v_new uuid;
begin
  if p_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into h from public.hb_habits where id = p_habit and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.kind <> 'quit' then raise exception 'not_a_quit_habit' using errcode = '22023'; end if;
  if h.status <> 'active' then raise exception 'habit_not_active' using errcode = '55000'; end if;
  select * into c from public.hb_cycles where habit_id = p_habit and ended_on is null;
  if not found then raise exception 'no_open_cycle' using errcode = 'P0002'; end if;
  v_today := public.hb_local_today(p_user);
  v_date := coalesce(p_date, v_today);
  if v_date > v_today then raise exception 'future_date' using errcode = '22008'; end if;
  if v_date < v_today - 7 then raise exception 'edit_window_closed' using errcode = '22008'; end if;
  if v_date < c.started_on then v_date := c.started_on; end if;
  insert into public.hb_slips (user_id, habit_id, cycle_id, local_date, reset, tags) values (p_user, p_habit, c.id, v_date, p_reset, p_tags);
  if p_reset then
    update public.hb_cycles set ended_on = v_date, end_reason = 'relapse', trigger_tags = p_tags where id = c.id;
    insert into public.hb_cycles (user_id, habit_id, started_on, baseline_daily_cost, baseline_source, baseline_n_days)
    values (p_user, p_habit, v_date, c.baseline_daily_cost, c.baseline_source, c.baseline_n_days) returning id into v_new;
    return jsonb_build_object('reset', true, 'cycle_id', v_new, 'started_on', v_date);
  end if;
  return jsonb_build_object('reset', false, 'cycle_id', c.id, 'started_on', c.started_on);
end $$;
revoke all on function public.hb_relapse_as(uuid, uuid, boolean, text[], date) from public, anon, authenticated;
grant execute on function public.hb_relapse_as(uuid, uuid, boolean, text[], date) to service_role;

create or replace function public.hb_relapse(p_habit uuid, p_reset boolean, p_tags text[] default '{}', p_date date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return public.hb_relapse_as(auth.uid(), p_habit, p_reset, p_tags, p_date);
end $$;
revoke all on function public.hb_relapse(uuid, boolean, text[], date) from public, anon;
grant execute on function public.hb_relapse(uuid, boolean, text[], date) to authenticated;

-- ===== Dinheiro que ficou com a pessoa (ESTIMATIVA) =====
-- Com categoria: max(0, média diária anterior × dias sem − gasto real na categoria durante o ciclo). Só com valor informado: média × dias.
create or replace function public.hb_quit_money_as(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  c record; v_today date; v_days int; v_spent numeric; v_cat uuid; out jsonb := '{}'::jsonb; est numeric;
begin
  if p_user is distinct from auth.uid() and coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  v_today := public.hb_local_today(p_user);
  for c in
    select cy.habit_id, cy.started_on, cy.baseline_daily_cost, cy.baseline_source
    from public.hb_cycles cy join public.hb_habits h on h.id = cy.habit_id
    where cy.user_id = p_user and cy.ended_on is null and h.status = 'active'
  loop
    v_days := greatest(0, v_today - c.started_on);
    if c.baseline_daily_cost is null then
      out := out || jsonb_build_object(c.habit_id::text, jsonb_build_object('estimate', null, 'reason', 'no_baseline', 'days', v_days));
    else
      select category_id into v_cat from public.hb_money_links where habit_id = c.habit_id;
      v_spent := case when v_cat is not null and c.baseline_source = 'nino_data'
                      then public.hb_category_spend(p_user, v_cat, c.started_on, v_today) else null end;
      est := greatest(0, c.baseline_daily_cost * v_days - coalesce(v_spent, 0));
      out := out || jsonb_build_object(c.habit_id::text, jsonb_build_object(
        'estimate', round(est, 2), 'baseline_daily_cost', c.baseline_daily_cost, 'days', v_days, 'spent', v_spent, 'source', c.baseline_source));
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.hb_quit_money_as(uuid) from public, anon;
grant execute on function public.hb_quit_money_as(uuid) to authenticated, service_role;

create or replace function public.hb_quit_money()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  return public.hb_quit_money_as(auth.uid());
end $$;
revoke all on function public.hb_quit_money() from public, anon;
grant execute on function public.hb_quit_money() to authenticated;

-- ===== Automaticidade (1 a 7). Uma resposta por hábito por dia; "agora não" também fica registrado (volta a perguntar em 7 dias). =====
create or replace function public.hb_automaticity_as(p_user uuid, p_habit uuid, p_score smallint default null, p_skipped boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $$
declare h public.hb_habits;
begin
  if p_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into h from public.hb_habits where id = p_habit and user_id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.kind = 'quit' then raise exception 'quit_has_no_automaticity' using errcode = '22023'; end if;
  if h.status <> 'active' then raise exception 'habit_not_active' using errcode = '55000'; end if;
  if not p_skipped and (p_score is null or p_score < 1 or p_score > 7) then raise exception 'invalid_score' using errcode = '22023'; end if;
  insert into public.hb_automaticity_checkins (user_id, habit_id, answered_on, score, skipped)
  values (p_user, p_habit, public.hb_local_today(p_user), case when p_skipped then null else p_score end, p_skipped)
  on conflict (habit_id, answered_on) do update set score = excluded.score, skipped = excluded.skipped, answered_at = now();
end $$;
revoke all on function public.hb_automaticity_as(uuid, uuid, smallint, boolean) from public, anon, authenticated;
grant execute on function public.hb_automaticity_as(uuid, uuid, smallint, boolean) to service_role;

create or replace function public.hb_answer_automaticity(p_habit uuid, p_score smallint default null, p_skipped boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform public.hb_automaticity_as(auth.uid(), p_habit, p_score, p_skipped);
end $$;
revoke all on function public.hb_answer_automaticity(uuid, smallint, boolean) from public, anon;
grant execute on function public.hb_answer_automaticity(uuid, smallint, boolean) to authenticated;

-- ===== Fotografias ampliadas (pausas, ciclos, vontades, recaídas, automaticidade, consentimento) =====
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
    'consent_sensitive', prefs.consent_sensitive_at is not null,
    'nudges_enabled', coalesce(prefs.nudges_enabled, true),
    'max_nudges_per_day', coalesce(prefs.max_nudges_per_day, 2),
    'habits', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at) from public.hb_habits h where h.user_id = p_user and h.status = 'active'), '[]'::jsonb),
    'logs', coalesce((select jsonb_agg(jsonb_build_object('habit_id', l.habit_id, 'local_date', l.local_date, 'status', l.status, 'quantity', l.quantity, 'source', l.source, 'logged_at', l.logged_at))
                       from public.hb_logs l where l.user_id = p_user and l.local_date >= today - greatest(7, least(p_days, 400))), '[]'::jsonb),
    'pauses', coalesce((select jsonb_agg(jsonb_build_object('habit_id', p.habit_id, 'from', p.from_date, 'to', p.to_date)) from public.hb_pauses p where p.user_id = p_user), '[]'::jsonb),
    'cycles', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'habit_id', c.habit_id, 'started_on', c.started_on, 'ended_on', c.ended_on, 'end_reason', c.end_reason,
                         'baseline_daily_cost', c.baseline_daily_cost, 'baseline_source', c.baseline_source) order by c.started_on)
                       from public.hb_cycles c where c.user_id = p_user), '[]'::jsonb),
    'cravings', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'habit_id', v.habit_id, 'occurred_at', v.occurred_at, 'local_date', v.local_date, 'handled', v.handled) order by v.occurred_at)
                       from public.hb_cravings v where v.user_id = p_user and v.local_date >= today - 90), '[]'::jsonb),
    'slips', coalesce((select jsonb_agg(jsonb_build_object('habit_id', s.habit_id, 'local_date', s.local_date, 'reset', s.reset, 'created_at', s.created_at) order by s.created_at)
                       from public.hb_slips s where s.user_id = p_user and s.local_date >= today - 90), '[]'::jsonb),
    'automaticity', coalesce((select jsonb_agg(jsonb_build_object('habit_id', a.habit_id, 'answered_on', a.answered_on, 'score', a.score, 'skipped', a.skipped) order by a.answered_on)
                       from public.hb_automaticity_checkins a where a.user_id = p_user), '[]'::jsonb),
    -- Pergunta de automaticidade enviada pelo WhatsApp nas últimas 24 h (um "5" solto só vale como resposta nesse caso).
    'auto_prompt', (select jsonb_build_object('habit_id', d.evidence->>'habit_id', 'sent_at', d.created_at)
                    from public.communication_deliveries d
                    where d.user_id = p_user and d.kind = 'hb_automaticity_due' and d.channel = 'whatsapp'
                      and d.status in ('queued','sent','delivered','acted') and d.created_at >= now() - interval '24 hours'
                    order by d.created_at desc limit 1)
  );
end $$;

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
    'consent_sensitive', prefs.consent_sensitive_at is not null,
    'habits', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at) from public.hb_habits h where h.user_id = uid and h.status <> 'archived'), '[]'::jsonb),
    'logs', coalesce((select jsonb_agg(jsonb_build_object('habit_id', l.habit_id, 'local_date', l.local_date, 'status', l.status, 'quantity', l.quantity, 'source', l.source))
                       from public.hb_logs l where l.user_id = uid and l.local_date >= today - greatest(7, least(p_days, 400))), '[]'::jsonb),
    'pauses', coalesce((select jsonb_agg(jsonb_build_object('habit_id', p.habit_id, 'from', p.from_date, 'to', p.to_date)) from public.hb_pauses p where p.user_id = uid), '[]'::jsonb),
    'cycles', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'habit_id', c.habit_id, 'started_on', c.started_on, 'ended_on', c.ended_on, 'end_reason', c.end_reason,
                         'baseline_daily_cost', c.baseline_daily_cost, 'baseline_source', c.baseline_source) order by c.started_on)
                       from public.hb_cycles c where c.user_id = uid), '[]'::jsonb),
    'cravings', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'habit_id', v.habit_id, 'occurred_at', v.occurred_at, 'local_date', v.local_date, 'handled', v.handled) order by v.occurred_at)
                       from public.hb_cravings v where v.user_id = uid and v.local_date >= today - 90), '[]'::jsonb),
    'slips', coalesce((select jsonb_agg(jsonb_build_object('habit_id', s.habit_id, 'local_date', s.local_date, 'reset', s.reset, 'created_at', s.created_at) order by s.created_at)
                       from public.hb_slips s where s.user_id = uid and s.local_date >= today - 90), '[]'::jsonb),
    'automaticity', coalesce((select jsonb_agg(jsonb_build_object('habit_id', a.habit_id, 'answered_on', a.answered_on, 'score', a.score, 'skipped', a.skipped) order by a.answered_on)
                       from public.hb_automaticity_checkins a where a.user_id = uid), '[]'::jsonb)
  );
end $$;

-- ===== Modelos de "largar" =====
insert into public.hb_templates (slug, title, area, kind, sensitivity, cue_suggestion, minimum_suggestion, why_it_works, craving_suggestion, sort_order) values
  ('delivery-impulso', 'Delivery por impulso', 'money', 'quit', 'normal', null, null, 'Esperar alguns minutos antes de pedir costuma bastar para a vontade passar.', 'beber um copo d''água e esperar 10 minutos antes de decidir', 110),
  ('redes-noite', 'Redes sociais antes de dormir', 'mind', 'quit', 'normal', null, null, 'Tirar a tela do quarto remove o gatilho em vez de depender de força de vontade.', 'deixar o celular carregando fora da cama', 120),
  ('cigarro', 'Cigarro', 'body', 'quit', 'substance', null, null, 'Trocar a hora do cigarro por uma ação curta ajuda a atravessar a vontade.', 'beber água, respirar fundo e esperar 10 minutos', 130),
  ('bebida', 'Bebida alcoólica', 'body', 'quit', 'substance', null, null, 'Ter um plano para a hora da vontade funciona melhor do que decidir na hora.', 'avisar alguém de confiança e sair para uma caminhada curta', 140)
on conflict (slug) do nothing;

-- ===== Catálogo de comunicação (novos tipos de Hábitos) =====
insert into public.communication_catalog
  (kind, label, family, description, base_priority, allowed_channels, default_channels, cooldown_hours, max_per_day, content_mode,
   sensitivity, fallback_policy, min_severity_for_whatsapp, stale_policy, default_window_hours, min_utility_score,
   whatsapp_min_confidence, whatsapp_min_absolute_impact, requires_manual_approval, same_pattern_cooldown_days, active)
values
  ('hb_automaticity_due', 'Check-in de automaticidade do hábito', 'habitos',
   'A cada 14 dias: o quanto o hábito já está automático (1 a 7). Define fase e redução de lembretes.',
   25, array['app','whatsapp']::text[], array['app','whatsapp']::text[], 24, 1, 'deterministic',
   'normal', 'app_only', 'info', 'drop_after_window', 24, 0.5, 0.7, 0, false, 0, true),
  ('hb_streak_milestone', 'Marco de sequência', 'habitos',
   'Reconhecimento (sem prêmio) em 7, 14, 30, 60 e 100 dias seguidos, ou nos marcos de dias sem de um hábito de largar.',
   15, array['app']::text[], array['app']::text[], 1, 2, 'deterministic',
   'normal', 'app_only', 'info', 'drop_after_window', 48, 0.5, 0.7, 0, false, 0, true)
on conflict (kind) do update set
  label = excluded.label, description = excluded.description, allowed_channels = excluded.allowed_channels,
  default_channels = excluded.default_channels, cooldown_hours = excluded.cooldown_hours, max_per_day = excluded.max_per_day,
  content_mode = excluded.content_mode, stale_policy = excluded.stale_policy, default_window_hours = excluded.default_window_hours, active = true;
