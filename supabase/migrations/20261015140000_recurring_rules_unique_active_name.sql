-- Impede duas regras ativas com o mesmo nome/tipo para o mesmo usuário (duplicava gasto ao confirmar duas vezes).
create unique index if not exists recurring_rules_unique_active_name
  on public.recurring_rules (user_id, lower(btrim(name)), kind)
  where status = 'active';
