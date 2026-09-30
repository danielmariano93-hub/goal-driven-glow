-- Aposenta os detectores de "ritmo" e "mudança de categoria" do motor SQL.
-- Eles comparavam o dia 1..N do mês com o dia 1..N do anterior por occurred_at:
-- um aluguel pago no dia 31 virou "Moradia foi de R$ 0,00 para R$ 3.340,75"
-- (real: R$ 4.977 em agosto, R$ 3.412 em setembro). A leitura de ritmo, causa
-- e mudanças passou para o motor executivo (nino_executive_insights.v1), que usa
-- competência canônica e mediana de 6 meses.
do $mig$
declare
  d text := pg_get_functiondef('public.nino_evaluate_financial_situations'::regproc);
  pace text := 'if abs(v_delta) >= 100 and (abs(v_pct) >= 15 or v_previous_expense=0) then';
  shift text := 'if v_cat.category_name is not null and abs(coalesce(v_cat.delta,0)) >= 100 and v_cat_contribution >= 35 then';
begin
  if position(pace in d) = 0 or position(shift in d) = 0 then
    raise notice 'nino_evaluate_financial_situations: detectores já aposentados ou alterados';
    return;
  end if;
  d := replace(d, pace, 'if false and (' || substring(pace from 4 for length(pace) - 8) || ') then');
  d := replace(d, shift, 'if false and (' || substring(shift from 4 for length(shift) - 8) || ') then');
  execute d;
end
$mig$;

update public.financial_situations
   set status = 'expired', valid_until = now(), updated_at = now()
 where situation_type in ('spending_pace_change', 'category_shift')
   and status not in ('expired', 'resolved', 'suppressed');
