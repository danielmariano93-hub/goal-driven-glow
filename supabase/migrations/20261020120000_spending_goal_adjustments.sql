-- Ajuste de meta com memória: toda vez que o limite ou a forma de medir de uma
-- meta de categoria muda, registramos o antes e o depois. Com isso o Nino
-- consegue avaliar, quando o período fecha, se o ajuste fez sentido.
create table if not exists public.spending_goal_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references public.category_spending_goals(id) on delete set null,
  category_id uuid not null,
  adjusted_at timestamptz not null default now(),
  adjusted_on date not null,
  period_type text,
  period_start date not null,
  period_end date not null,
  old_limit numeric(14,2) not null,
  new_limit numeric(14,2) not null,
  old_mode text,
  new_mode text,
  old_baseline_kind text,
  new_baseline_kind text,
  old_reduction_pct numeric(5,2),
  new_reduction_pct numeric(5,2),
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists idx_sga_user_category on public.spending_goal_adjustments(user_id, category_id, adjusted_on desc);
create index if not exists idx_sga_goal on public.spending_goal_adjustments(goal_id);

alter table public.spending_goal_adjustments enable row level security;
drop policy if exists sga_owner_select on public.spending_goal_adjustments;
create policy sga_owner_select on public.spending_goal_adjustments for select using (auth.uid() = user_id);
drop policy if exists sga_owner_update on public.spending_goal_adjustments;
create policy sga_owner_update on public.spending_goal_adjustments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.spending_goal_adjustments from anon, authenticated;
grant select on public.spending_goal_adjustments to authenticated;
-- A pessoa só pode escrever o motivo; o registro em si nasce do gatilho.
grant update (reason) on public.spending_goal_adjustments to authenticated;
grant all on public.spending_goal_adjustments to service_role;

create or replace function public.csg_record_adjustment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on date := (now() at time zone 'America/Sao_Paulo')::date;
  v_start date;
  v_end date;
  v_prev public.spending_goal_adjustments;
begin
  if new.category_id is distinct from old.category_id then return new; end if;
  if new.computed_limit is not distinct from old.computed_limit
     and new.mode is not distinct from old.mode
     and new.baseline_kind is not distinct from old.baseline_kind
     and new.reduction_pct is not distinct from old.reduction_pct then
    return new;
  end if;
  if coalesce(old.computed_limit, 0) <= 0 or coalesce(new.computed_limit, 0) <= 0 then return new; end if;
  -- Troca de período não é ajuste de meta: é outra meta começando.
  if new.start_date is distinct from old.start_date
     or new.end_date is distinct from old.end_date
     or new.period_type is distinct from old.period_type then
    return new;
  end if;

  if coalesce(new.period_type, '') = 'monthly_recurring' or new.end_date is null then
    v_start := date_trunc('month', v_on)::date;
    v_end := (v_start + interval '1 month - 1 day')::date;
  else
    v_start := new.start_date;
    v_end := coalesce(new.end_date, new.start_date);
  end if;

  -- Mexidas seguidas no mesmo dia viram um único ajuste (do primeiro "antes" ao último "depois").
  select * into v_prev from public.spending_goal_adjustments
   where goal_id = new.id and adjusted_on = v_on and period_start = v_start
   order by adjusted_at desc limit 1;
  if found then
    if v_prev.old_limit = new.computed_limit and v_prev.old_mode is not distinct from new.mode
       and v_prev.old_baseline_kind is not distinct from new.baseline_kind then
      delete from public.spending_goal_adjustments where id = v_prev.id;
    else
      update public.spending_goal_adjustments
         set new_limit = new.computed_limit, new_mode = new.mode,
             new_baseline_kind = new.baseline_kind, new_reduction_pct = new.reduction_pct, adjusted_at = now()
       where id = v_prev.id;
    end if;
    return new;
  end if;

  insert into public.spending_goal_adjustments(
    user_id, goal_id, category_id, adjusted_on, period_type, period_start, period_end,
    old_limit, new_limit, old_mode, new_mode, old_baseline_kind, new_baseline_kind, old_reduction_pct, new_reduction_pct)
  values (
    new.user_id, new.id, new.category_id, v_on, new.period_type, v_start, v_end,
    old.computed_limit, new.computed_limit, old.mode, new.mode, old.baseline_kind, new.baseline_kind, old.reduction_pct, new.reduction_pct);
  return new;
end;
$$;

drop trigger if exists trg_csg_record_adjustment on public.category_spending_goals;
create trigger trg_csg_record_adjustment
  after update on public.category_spending_goals
  for each row execute function public.csg_record_adjustment();
