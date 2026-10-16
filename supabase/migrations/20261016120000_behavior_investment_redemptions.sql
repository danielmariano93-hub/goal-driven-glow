-- Patrimônio dizia "você investiu R$ 8.000 em 90 dias" mesmo quando o resgate no período era maior que o aporte.
-- O snapshot passa a trazer também os resgates de 90 dias para o motor falar do saldo líquido.
do $do$
declare d text; fn text;
begin
  foreach fn in array array['public.behavioral_dashboard_snapshot()','public.behavioral_dashboard_snapshot_for_user(uuid)'] loop
    d := pg_get_functiondef(fn::regprocedure);
    if position('redemptions_90d' in d) = 0 then
      d := replace(d,
        '''contributions_90d'', coalesce((select sum(amount) from public.investment_movements where user_id=v_uid and kind in (''application'',''deposit'',''contribution'') and occurred_at >= current_date-89),0),',
        '''contributions_90d'', coalesce((select sum(amount) from public.investment_movements where user_id=v_uid and kind in (''application'',''deposit'',''contribution'') and occurred_at >= current_date-89),0), ''redemptions_90d'', coalesce((select sum(amount) from public.investment_movements where user_id=v_uid and kind in (''redemption'',''withdrawal'') and occurred_at >= current_date-89),0),');
      execute d;
    end if;
  end loop;
end
$do$;
