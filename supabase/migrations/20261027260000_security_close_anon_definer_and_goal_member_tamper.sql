-- Auditoria de segurança (isolamento entre usuários).
-- 1) behavioral_finished_cycles(p_uid, …) era SECURITY DEFINER, executável por
--    anon e sem checar o dono: qualquer pessoa com o UUID lia metas/gasto real
--    por categoria de outra conta. Agora só o próprio usuário (ou cron/serviço,
--    sem JWT de cliente) obtém linhas, e anon/public perdem o EXECUTE.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.behavioral_finished_cycles(uuid,date)'::regprocedure);
  d := replace(d, 'where c.user_id = p_uid and',
    'where c.user_id = p_uid'
    || ' and (p_uid = auth.uid() or (auth.uid() is null and coalesce(auth.role(), '''') <> ''anon'' and coalesce(auth.role(), '''') <> ''authenticated''))'
    || ' and');
  if d not like '%auth.role()%' then raise exception 'patch_not_applied: behavioral_finished_cycles'; end if;
  execute d;
end $$;
revoke all on function public.behavioral_finished_cycles(uuid, date) from public, anon;
grant execute on function public.behavioral_finished_cycles(uuid, date) to authenticated, service_role;

-- 2) Funções internas (cron/gatilho) que estavam executáveis por anon em produção
--    (as migrations originais já mandavam revogar: houve deriva de permissões).
revoke all on function public.refresh_installment_anticipation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.financial_report_schedules_enroll() from public, anon, authenticated;
revoke all on function public.csg_record_adjustment() from public, anon, authenticated;
revoke all on function public.tg_refresh_installment_anticipation() from public, anon, authenticated;
grant execute on function public.refresh_installment_anticipation(uuid, uuid) to service_role;
grant execute on function public.financial_report_schedules_enroll() to service_role;

-- 3) Metas compartilhadas: `sgm_self_leave` deixava o membro editar a própria
--    linha inteira (papel, valor contribuído, status). Edições vindas do cliente
--    (current_user = authenticated/anon) não podem mexer nesses campos; os
--    fluxos legítimos (aceitar, recusar, contribuir) rodam em RPC SECURITY DEFINER.
create or replace function public.tg_shared_goal_members_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.goal_id is distinct from old.goal_id
       or new.user_id is distinct from old.user_id
       or new.phone_e164 is distinct from old.phone_e164
       or new.role is distinct from old.role
       or new.contribution_total is distinct from old.contribution_total
       or new.joined_at is distinct from old.joined_at then
      raise exception 'campo protegido da membership' using errcode = '42501';
    end if;
    if new.invite_status is distinct from old.invite_status and new.invite_status = 'accepted' then
      raise exception 'aceite só pelo convite' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists shared_goal_members_guard on public.shared_goal_members;
create trigger shared_goal_members_guard before update on public.shared_goal_members
  for each row execute function public.tg_shared_goal_members_guard();
