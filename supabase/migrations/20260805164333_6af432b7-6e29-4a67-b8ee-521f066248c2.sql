create or replace function public.nino_diag_select_action(
  _situation_type text,
  _status text,
  _evaluation jsonb default '{}'::jsonb,
  _impact numeric default null
) returns jsonb
language sql
stable
set search_path=public
as $$
select case
 when _status in ('resolved','expired','suppressed') then '{}'::jsonb
 when _situation_type='behavioral_pattern' and _status='observed' then jsonb_build_object('key','understand_pattern','type','learn','title','Entender o padrão','route','/app/nino?section=aprendizados','explanation','Veja as evidências antes de tratar o padrão como confirmado','priority',55)
 when _situation_type='behavioral_pattern' then jsonb_build_object('key','review_pattern_spend','type','review','title','Ver os gastos do padrão','route','/app/lancamentos','explanation','Confira os lançamentos que sustentam este padrão','priority',60)
 when _situation_type='data_quality_issue' then jsonb_build_object('key','classify_transactions','type','classify','title','Classificar lançamentos','route','/app/lancamentos?filtro=sem-categoria','explanation','Melhorar a classificação aumenta a confiança das leituras','priority',85)
 when _situation_type='duplicate_review' then jsonb_build_object('key','review_duplicates','type','review','title','Revisar duplicidades','route','/app/lancamentos','explanation','Confirme quais lançamentos representam a mesma compra','priority',90)
 when _situation_type='goal_feasibility' then jsonb_build_object('key','recalibrate_goal','type','plan','title','Recalibrar meta','route',coalesce('/app/metas/'||nullif(_evaluation->>'goal_id',''),'/app/metas'),'explanation','Ajuste prazo ou aporte para tornar a meta viável','estimated_impact',_impact,'priority',80)
 when _situation_type='card_cycle_pressure' or _evaluation->>'future_kind' in ('bill','installment') then jsonb_build_object('key','review_card','type','review','title','Revisar fatura e parcelas','route',coalesce('/app/cartoes/'||nullif(_evaluation->>'card_id',''),'/app/cartoes'),'explanation','Antecipe o impacto antes do vencimento','estimated_impact',_impact,'priority',85)
 when _situation_type='cash_flow_imbalance' then jsonb_build_object('key','review_month_pressure','type','review','title','Revisar os gastos que pressionaram o mês','route','/app/relatorios?foco=categorias&periodo=atual','explanation','Veja quais categorias e lançamentos mais contribuíram para a diferença entre receitas e despesas.','estimated_impact',_impact,'priority',80)
 when _situation_type='anticipation' then jsonb_build_object('key','plan_ahead','type','plan','title','Planejar agora','route','/app/planejamento','explanation','Organize o caixa antes da data prevista','estimated_impact',_impact,'priority',80)
 when _situation_type='spending_pace_change' and _status='improving' then jsonb_build_object('key','review_improvement','type','review','title','Ver o que melhorou','route','/app/relatorios','explanation','Entenda o comportamento que ajudou o período','priority',45)
 else jsonb_build_object('key','review_details','type','review','title','Ver detalhes','route','/app/relatorios','explanation','Confira os fatos usados nesta leitura','estimated_impact',_impact,'priority',60)
end
$$;

create or replace function public.normalize_nino_financial_action()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_type text;
begin
  if new.status not in ('proposed','accepted','in_progress') then
    return new;
  end if;

  select situation_type into v_type
  from public.financial_situations
  where id = new.situation_id;

  if v_type = 'cash_flow_imbalance'
     and (new.title in ('Revisar a formação do saldo','Ver o que pressionou o mês','Revisar os gastos que pressionaram o mês')) then
    new.title := 'Revisar os gastos que pressionaram o mês';
    new.explanation := 'Veja quais categorias e lançamentos mais contribuíram para a diferença entre receitas e despesas.';
    new.route := '/app/relatorios?foco=categorias&periodo=atual';
  end if;

  return new;
end
$$;

revoke all on function public.normalize_nino_financial_action() from public, anon, authenticated;
grant execute on function public.normalize_nino_financial_action() to service_role;

drop trigger if exists trg_normalize_nino_financial_action on public.financial_situation_actions;
create trigger trg_normalize_nino_financial_action
before insert or update of title, explanation, route, status
on public.financial_situation_actions
for each row execute function public.normalize_nino_financial_action();