-- Clientes reais no painel de qualidade: sem o canal do simulador (o harness do conjunto dourado roda como o dono
-- da conta e gerava centenas de "respostas reais") e com janela curta e fixa.
create or replace function public.admin_real_quality_weekly(p_weeks int default 4)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r jsonb;
begin
  if not public.is_current_user_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(x order by x.semana), '[]'::jsonb) into r from (
    select date_trunc('week', o.created_at)::date as semana,
           count(*)::int as respostas,
           count(*) filter (where o.body ~* 'não consegui concluir|tente novamente|ocorreu um erro|falha t[eé]cnica')::int as falhas,
           count(*) filter (where o.body ~* 'ainda não consigo|não consigo montar|não consegui (fechar|montar|confirmar|encontrar)|não encontrei|prefiro não|não posso')::int as recusas,
           count(*) filter (where o.body ~* 'qual período ou item|quero confirmar só um ponto|não ficou claro|pode me dizer qual')::int as esclarecimentos
      from public.outbound_messages o
      join public.profiles p on p.id = o.user_id and not p.is_test and not p.is_sandbox
     where o.inbound_message_id is not null
       and coalesce(o.channel, '') <> 'simulator'
       and o.created_at >= date_trunc('week', now()) - ((greatest(1, least(p_weeks, 12)) - 1) || ' weeks')::interval
     group by 1
  ) x;
  return r;
end $$;
revoke all on function public.admin_real_quality_weekly(int) from public, anon;
grant execute on function public.admin_real_quality_weekly(int) to authenticated;
