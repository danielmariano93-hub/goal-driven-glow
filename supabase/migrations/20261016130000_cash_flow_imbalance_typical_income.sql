-- "Seus gastos superam a renda" disparava em mês incompleto, com renda irregular (a renda do mês ainda não entrou),
-- e o texto falava em "saldo médio zerado". Agora:
--  * só alerta se a renda típica (média dos últimos 90 dias) não cobriria o gasto, ou se o mês já está no fim;
--  * o título diz o que aconteceu ("Neste mês você gastou R$ X a mais do que recebeu");
--  * a evidência não leva mais `average_monthly_surplus_90d` (levava o modelo a escrever "saldo médio zerado").
do $do$
declare d text; fn text := 'public.nino_evaluate_financial_situations(uuid,date,text,text)';
begin
  d := pg_get_functiondef(fn::regprocedure);
  if position('Neste mês você gastou ' in d) = 0 then
    d := replace(d,
      'if (v_days_elapsed>=7 or v_current_income>0)
     and v_gap > greatest(300, v_current_income*0.10) then',
      'if (v_days_elapsed>=7 or v_current_income>0)
     and v_gap > greatest(300, v_current_income*0.10)
     and (v_avg_income < v_current_expense * 1.2 or v_days_elapsed >= 25) then');
    d := replace(d,
      '''Seus gastos de consumo superam a renda em '' || public.nino_diag_brl(v_gap),',
      '''Neste mês você gastou '' || public.nino_diag_brl(v_gap) || '' a mais do que recebeu'',');
    d := regexp_replace(d, ',\s*''average_monthly_surplus_90d'',\s*v_monthly_surplus', '');
    execute d;
  end if;
end
$do$;
