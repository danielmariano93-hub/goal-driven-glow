-- Nino Hábitos M4 (F5 Dinheiro): hábitos medidos pelo Nino (regra sobre as transações), gasto semanal por categoria e concordância
-- da regra com o que a pessoa marcou. Aditiva. Depende das migrações 1, 2 e 3 (hb_snapshot ampliado na 3).
-- Documento: docs/NINO_HABITOS_REFINAMENTO_TECNICO.md (seção 6.4 e apêndice I).

create table if not exists public.hb_auto_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null references public.hb_habits(id) on delete cascade,
  rule_type text not null check (rule_type in ('no_spend_category','spend_under_limit')),
  category_id uuid not null references public.categories(id) on delete cascade,
  limit_amount numeric check (limit_amount is null or limit_amount >= 0),
  created_at timestamptz not null default now(),
  unique (habit_id),
  constraint hb_auto_rules_limit_ck check (rule_type <> 'spend_under_limit' or limit_amount is not null)
);
create index if not exists hb_auto_rules_user_idx on public.hb_auto_rules (user_id);
alter table public.hb_auto_rules enable row level security;
drop policy if exists hb_auto_rules_select_own on public.hb_auto_rules;
create policy hb_auto_rules_select_own on public.hb_auto_rules for select to authenticated using (user_id = auth.uid());
revoke all on public.hb_auto_rules from anon, public;
grant select on public.hb_auto_rules to authenticated;

create or replace function public.hb_set_auto_rule(p_habit uuid, p_type text, p_category uuid, p_limit numeric default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); h public.hb_habits;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  select * into h from public.hb_habits where id = p_habit and user_id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if h.kind <> 'do_daily' then raise exception 'rule_needs_daily_habit' using errcode = '22023'; end if;
  if p_type not in ('no_spend_category','spend_under_limit') then raise exception 'invalid_rule' using errcode = '22023'; end if;
  if not exists (select 1 from public.categories c where c.id = p_category and c.user_id = uid) then raise exception 'category_not_found' using errcode = 'P0002'; end if;
  insert into public.hb_auto_rules (user_id, habit_id, rule_type, category_id, limit_amount)
  values (uid, p_habit, p_type, p_category, case when p_type = 'spend_under_limit' then p_limit end)
  on conflict (habit_id) do update set rule_type = excluded.rule_type, category_id = excluded.category_id, limit_amount = excluded.limit_amount;
end $$;
revoke all on function public.hb_set_auto_rule(uuid, text, uuid, numeric) from public, anon;
grant execute on function public.hb_set_auto_rule(uuid, text, uuid, numeric) to authenticated;

create or replace function public.hb_clear_auto_rule(p_habit uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  delete from public.hb_auto_rules where habit_id = p_habit and user_id = auth.uid();
end $$;
revoke all on function public.hb_clear_auto_rule(uuid) from public, anon;
grant execute on function public.hb_clear_auto_rule(uuid) to authenticated;

-- Dias fechados (até ontem) em que a regra foi cumprida ou não, calculados das transações (mesmo filtro de consumo real do motor financeiro).
create or replace function public.hb_rule_days(p_user uuid, p_from date, p_to date)
returns table (habit_id uuid, local_date date, met boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_today date;
begin
  if p_user is distinct from auth.uid() and coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  v_today := public.hb_local_today(p_user);
  return query
  with rules as (
    select r.habit_id, r.rule_type, r.category_id, r.limit_amount, h.started_on, h.days_of_week
    from public.hb_auto_rules r join public.hb_habits h on h.id = r.habit_id
    where r.user_id = p_user and h.status = 'active' and h.kind = 'do_daily'
  ), days as (
    select r.habit_id, r.rule_type, r.category_id, r.limit_amount, d::date as d
    from rules r, generate_series(greatest(p_from, r.started_on), least(p_to, v_today - 1), interval '1 day') d
    where r.days_of_week is null or extract(dow from d)::smallint = any (r.days_of_week)
  ), spend as (
    select x.habit_id, x.d,
      coalesce((select sum(t.amount) from public.transactions t
        where t.user_id = p_user and t.category_id = x.category_id and t.status = 'confirmed' and t.type = 'expense'
          and t.transfer_group_id is null and coalesce(t.movement_kind, 'transaction') = 'transaction'
          and t.settles_card_id is null and t.superseded_by is null
          and not (coalesce(t.installment_number, 1) > 1 and coalesce(t.installments_total, 0) > 1 and (t.credit_card_id is not null or t.payment_method = 'credit_card'))
          and t.occurred_at = x.d), 0) as s,
      x.rule_type, x.limit_amount
    from days x
  )
  select s.habit_id, s.d, case when s.rule_type = 'no_spend_category' then s.s = 0 else s.s <= s.limit_amount end
  from spend s;
end $$;
revoke all on function public.hb_rule_days(uuid, date, date) from public, anon;
grant execute on function public.hb_rule_days(uuid, date, date) to authenticated, service_role;

-- Marcações virtuais: só em dias sem marcação manual (a marcação da pessoa sempre vale mais).
create or replace function public.hb_auto_logs_as(p_user uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_user is distinct from auth.uid() and coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('habit_id', d.habit_id, 'local_date', d.local_date, 'status', case when d.met then 'done' else 'skipped' end, 'quantity', null, 'source', 'auto'))
    from public.hb_rule_days(p_user, p_from, p_to) d
    where not exists (select 1 from public.hb_logs l where l.habit_id = d.habit_id and l.local_date = d.local_date)
  ), '[]'::jsonb);
end $$;
revoke all on function public.hb_auto_logs_as(uuid, date, date) from public, anon;
grant execute on function public.hb_auto_logs_as(uuid, date, date) to authenticated, service_role;

-- Concordância da regra com a marcação manual, por hábito (critério de aceite: ≥ 95%).
create or replace function public.hb_rule_agreement_as(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_today date;
begin
  if p_user is distinct from auth.uid() and coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  v_today := public.hb_local_today(p_user);
  return coalesce((
    select jsonb_object_agg(x.habit_id::text, jsonb_build_object('days', x.n, 'agree', x.a))
    from (
      select d.habit_id, count(*) as n, count(*) filter (where d.met = (l.status in ('done','minimum','quantity'))) as a
      from public.hb_rule_days(p_user, v_today - 90, v_today - 1) d
      join public.hb_logs l on l.habit_id = d.habit_id and l.local_date = d.local_date and l.status in ('done','minimum','quantity','skipped')
      group by d.habit_id
    ) x
  ), '{}'::jsonb);
end $$;
revoke all on function public.hb_rule_agreement_as(uuid) from public, anon;
grant execute on function public.hb_rule_agreement_as(uuid) to authenticated, service_role;

create or replace function public.hb_rule_agreement()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  return public.hb_rule_agreement_as(auth.uid());
end $$;
revoke all on function public.hb_rule_agreement() from public, anon;
grant execute on function public.hb_rule_agreement() to authenticated;

-- Gasto semanal (segunda a domingo) de uma categoria, das `p_weeks` semanas fechadas mais recentes. Insumo da régua de insights.
create or replace function public.hb_weekly_category_spend(p_category uuid, p_weeks int default 12)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare uid uuid := auth.uid(); v_today date; v_week0 date;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.hb_enabled() then raise exception 'not_enabled' using errcode = '42501'; end if;
  v_today := public.hb_local_today(uid);
  v_week0 := date_trunc('week', v_today)::date;
  return coalesce((
    select jsonb_agg(jsonb_build_object('week_start', w.ws, 'spent', coalesce((
      select sum(t.amount) from public.transactions t
      where t.user_id = uid and t.category_id = p_category and t.status = 'confirmed' and t.type = 'expense'
        and t.transfer_group_id is null and coalesce(t.movement_kind, 'transaction') = 'transaction'
        and t.settles_card_id is null and t.superseded_by is null
        and not (coalesce(t.installment_number, 1) > 1 and coalesce(t.installments_total, 0) > 1 and (t.credit_card_id is not null or t.payment_method = 'credit_card'))
        and t.occurred_at >= w.ws and t.occurred_at < w.ws + 7), 0)) order by w.ws)
    from (select (v_week0 - 7 * g)::date as ws from generate_series(1, greatest(1, least(p_weeks, 26))) g) w
  ), '[]'::jsonb);
end $$;
revoke all on function public.hb_weekly_category_spend(uuid, int) from public, anon;
grant execute on function public.hb_weekly_category_spend(uuid, int) to authenticated;

-- Fotografias: regras e marcações medidas. As versões da migração 3 viram `_v3` (uma só vez) e as novas acrescentam os campos.
do $$ begin
  -- Idempotente e à prova de ordem: renomeia a versão "pura" (a que NÃO chama a _v3) para _v3. Se a migração 3 for aplicada depois da 4,
  -- ela recria a versão pura; rodar esta migração de novo troca a _v3 antiga pela nova.
  if position('hb_snapshot_as_v3' in pg_get_functiondef('public.hb_snapshot_as(uuid,int)'::regprocedure)) = 0 then
    drop function if exists public.hb_snapshot_as_v3(uuid, int);
    alter function public.hb_snapshot_as(uuid, int) rename to hb_snapshot_as_v3;
  end if;
  if position('hb_snapshot_v3' in pg_get_functiondef('public.hb_snapshot(int)'::regprocedure)) = 0 then
    drop function if exists public.hb_snapshot_v3(int);
    alter function public.hb_snapshot(int) rename to hb_snapshot_v3;
  end if;
end $$;
revoke all on function public.hb_snapshot_as_v3(uuid, int) from public, anon, authenticated;
revoke all on function public.hb_snapshot_v3(int) from public, anon, authenticated;
grant execute on function public.hb_snapshot_as_v3(uuid, int) to service_role;

create or replace function public.hb_snapshot_as(p_user uuid, p_days int default 120)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare base jsonb; today date; n int := greatest(7, least(p_days, 400));
begin
  base := public.hb_snapshot_as_v3(p_user, p_days);
  if base is null then return null; end if;
  today := (base->>'today')::date;
  return base || jsonb_build_object(
    'auto_rules', coalesce((select jsonb_agg(jsonb_build_object('habit_id', r.habit_id, 'rule_type', r.rule_type, 'category_id', r.category_id, 'limit_amount', r.limit_amount)) from public.hb_auto_rules r where r.user_id = p_user), '[]'::jsonb),
    'auto_logs', public.hb_auto_logs_as(p_user, today - n, today - 1)
  );
end $$;
revoke all on function public.hb_snapshot_as(uuid, int) from public, anon, authenticated;
grant execute on function public.hb_snapshot_as(uuid, int) to service_role;

create or replace function public.hb_snapshot(p_days int default 180)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare base jsonb; today date; n int := greatest(7, least(p_days, 400)); uid uuid := auth.uid();
begin
  base := public.hb_snapshot_v3(p_days);
  today := (base->>'today')::date;
  return base || jsonb_build_object(
    'auto_rules', coalesce((select jsonb_agg(jsonb_build_object('habit_id', r.habit_id, 'rule_type', r.rule_type, 'category_id', r.category_id, 'limit_amount', r.limit_amount)) from public.hb_auto_rules r where r.user_id = uid), '[]'::jsonb),
    'auto_logs', public.hb_auto_logs_as(uid, today - n, today - 1)
  );
end $$;
revoke all on function public.hb_snapshot(int) from public, anon;
grant execute on function public.hb_snapshot(int) to authenticated;

-- Catálogo: revisão semanal (texto fixo, calculado do que a pessoa marcou).
insert into public.communication_catalog
  (kind, label, family, description, base_priority, allowed_channels, default_channels, cooldown_hours, max_per_day, content_mode,
   sensitivity, fallback_policy, min_severity_for_whatsapp, stale_policy, default_window_hours, min_utility_score,
   whatsapp_min_confidence, whatsapp_min_absolute_impact, requires_manual_approval, same_pattern_cooldown_days, active)
values
  ('hb_weekly_review', 'Revisão semanal dos hábitos', 'habitos',
   'Domingo à noite: como foi a semana de cada hábito, com os números que a pessoa marcou. Sem pontos e sem culpa.',
   20, array['app','whatsapp']::text[], array['app','whatsapp']::text[], 24, 1, 'deterministic',
   'normal', 'app_only', 'info', 'drop_after_window', 24, 0.5, 0.7, 0, false, 0, true)
on conflict (kind) do update set
  label = excluded.label, description = excluded.description, allowed_channels = excluded.allowed_channels, default_channels = excluded.default_channels,
  cooldown_hours = excluded.cooldown_hours, max_per_day = excluded.max_per_day, content_mode = excluded.content_mode,
  stale_policy = excluded.stale_policy, default_window_hours = excluded.default_window_hours, active = true;
