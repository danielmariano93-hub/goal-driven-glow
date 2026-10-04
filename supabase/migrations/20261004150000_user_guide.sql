-- Guia de primeiros passos e tutoriais de novidades.
-- user_guide_state: o que cada pessoa já viu/concluiu/dispensou (sincroniza entre dispositivos).
-- guide_setup_status(): o que a pessoa já fez de verdade, derivado dos dados reais
-- (nada de "marcar como feito" manual para os passos essenciais).
create table if not exists public.user_guide_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 80),
  status text not null check (status in ('seen', 'completed', 'dismissed')),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

alter table public.user_guide_state enable row level security;

create policy "guide_state_select_own" on public.user_guide_state
  for select to authenticated using (user_id = auth.uid());
create policy "guide_state_insert_own" on public.user_guide_state
  for insert to authenticated with check (user_id = auth.uid());
create policy "guide_state_update_own" on public.user_guide_state
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "guide_state_delete_own" on public.user_guide_state
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.user_guide_state from anon, public;
grant select, insert, update, delete on public.user_guide_state to authenticated;

create or replace function public.guide_setup_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'account', exists (select 1 from public.accounts where user_id = v_uid),
    'transaction', exists (select 1 from public.transactions where user_id = v_uid),
    'whatsapp', exists (select 1 from public.whatsapp_links where user_id = v_uid and status = 'active'),
    'goal', exists (select 1 from public.goals where user_id = v_uid),
    'category_goal', exists (select 1 from public.category_spending_goals where user_id = v_uid),
    'card', exists (select 1 from public.credit_cards where user_id = v_uid),
    'recurring', exists (select 1 from public.recurring_rules where user_id = v_uid),
    'split', exists (select 1 from public.shared_expenses where owner_user_id = v_uid and deleted_at is null)
  );
end;
$function$;

revoke all on function public.guide_setup_status() from public, anon;
grant execute on function public.guide_setup_status() to authenticated, service_role;
