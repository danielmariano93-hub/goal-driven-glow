-- Meta de doação: cada mês é um compromisso confirmado por lançamentos reais.
--   goals.donation_category_id        → despesas confirmadas nesta categoria contam no mês (vínculo automático)
--   transactions.donation_goal_id     → vínculo manual de um lançamento a uma meta de doação
-- Nada é duplicado: o lançamento continua sendo a despesa normal; a meta só mede.
alter table public.goals add column if not exists donation_category_id uuid references public.categories(id) on delete set null;
alter table public.transactions add column if not exists donation_goal_id uuid references public.goals(id) on delete set null;
create index if not exists idx_transactions_donation_goal on public.transactions(donation_goal_id) where donation_goal_id is not null;

create or replace function public.guard_donation_goal_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.donation_goal_id is null then return new; end if;
  if not exists (
    select 1 from public.goals g
     where g.id = new.donation_goal_id and g.user_id = new.user_id and g.kind = 'donation'
  ) then
    raise exception 'Meta de doação inválida para este lançamento';
  end if;
  return new;
end
$$;

create or replace trigger trg_guard_donation_goal_link
  before insert or update of donation_goal_id on public.transactions
  for each row when (new.donation_goal_id is not null)
  execute function public.guard_donation_goal_link();
