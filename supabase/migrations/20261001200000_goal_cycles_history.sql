-- Histórico permanente das metas de gasto (`goal_history.v2`).
--
-- Causa-raiz: a meta era um único registro reaproveitado. Editar a meta de
-- agosto para valer em setembro (ou excluir uma meta encerrada) apagava o mês
-- que já tinha acontecido. A partir daqui, cada mês de meta que já começou vira
-- um ciclo permanente em `category_spending_goal_cycles`, que sobrevive à
-- edição e à exclusão da meta.
--
-- O gasto do ciclo NÃO é congelado: é sempre recalculado do livro canônico
-- (estornos e recategorizações continuam valendo). O ciclo guarda o que era a
-- meta naquele mês: categoria, período, limite e referência.

alter table public.category_spending_goal_cycles
  add column if not exists category_id uuid references public.categories(id) on delete cascade,
  add column if not exists source text not null default 'snapshot'
    check (source in ('snapshot', 'backfill', 'close'));

alter table public.category_spending_goal_cycles alter column goal_id drop not null;
alter table public.category_spending_goal_cycles drop constraint if exists category_spending_goal_cycles_goal_id_fkey;
alter table public.category_spending_goal_cycles
  add constraint category_spending_goal_cycles_goal_id_fkey
  foreign key (goal_id) references public.category_spending_goals(id) on delete set null;

update public.category_spending_goal_cycles y
   set category_id = g.category_id
  from public.category_spending_goals g
 where y.goal_id = g.id and y.category_id is null;

-- A identidade do ciclo passa a ser (usuário, categoria, início): a meta pode
-- ter sido editada para outra categoria ou excluída.
alter table public.category_spending_goal_cycles drop constraint if exists category_spending_goal_cycles_goal_id_start_date_key;

-- Uma meta por categoria e mês de início no histórico.
create unique index if not exists uq_csgc_user_category_start
  on public.category_spending_goal_cycles(user_id, category_id, start_date)
  where category_id is not null;

-- Guarda os meses já iniciados de uma meta (antes de editar o período ou excluir).
create or replace function public.csg_snapshot_cycles(g public.category_spending_goals)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month date;
  v_last date;
  v_end date;
begin
  if g.computed_limit is null or g.computed_limit <= 0 then return; end if;
  if coalesce(g.period_type, case when g.end_date is null then 'monthly_recurring' else 'custom' end) = 'monthly_recurring' then
    v_month := date_trunc('month', g.start_date)::date;
    v_last := date_trunc('month', least(v_today, coalesce(g.recurrence_end_date, v_today)))::date;
    while v_month <= v_last loop
      insert into public.category_spending_goal_cycles(goal_id, user_id, category_id, start_date, end_date, baseline_snapshot, target_snapshot, source)
      values (g.id, g.user_id, g.category_id, v_month, (v_month + interval '1 month - 1 day')::date, g.baseline_value, g.computed_limit, 'snapshot')
      on conflict (user_id, category_id, start_date) where category_id is not null do nothing;
      v_month := (v_month + interval '1 month')::date;
    end loop;
  else
    if g.start_date > v_today then return; end if;
    v_end := coalesce(g.end_date, g.start_date);
    insert into public.category_spending_goal_cycles(goal_id, user_id, category_id, start_date, end_date, baseline_snapshot, target_snapshot, source)
    values (g.id, g.user_id, g.category_id, g.start_date, v_end, g.baseline_value, g.computed_limit, 'snapshot')
    on conflict (user_id, category_id, start_date) where category_id is not null
    do update set target_snapshot = excluded.target_snapshot,
                  baseline_snapshot = coalesce(excluded.baseline_snapshot, public.category_spending_goal_cycles.baseline_snapshot),
                  end_date = excluded.end_date,
                  updated_at = now();
  end if;
end;
$$;

create or replace function public.csg_preserve_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Exclusão em cascata (ex.: conta apagada) não gera histórico.
    if pg_trigger_depth() > 1 then return old; end if;
    perform public.csg_snapshot_cycles(old);
    return old;
  end if;
  -- Edição que leva a meta para outro período (ou outra categoria): o período
  -- antigo vira histórico. Ajuste de limite dentro do mesmo período não gera ciclo.
  if new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or new.category_id is distinct from old.category_id
     or new.period_type is distinct from old.period_type then
    perform public.csg_snapshot_cycles(old);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_csg_preserve_history on public.category_spending_goals;
create trigger trg_csg_preserve_history
  before update or delete on public.category_spending_goals
  for each row execute function public.csg_preserve_history();
